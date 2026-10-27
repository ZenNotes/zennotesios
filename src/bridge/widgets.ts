/**
 * Widget publisher: keeps the App Group snapshot the WidgetKit extension
 * renders (widget-snapshot.ts is the contract) in step with the store.
 *
 * Sources of change are the note index (every rescan and vault mutation
 * replaces `notes`), the shared task cache, the drawer's pins, the active
 * vault, and the theme. Each publish is a WidgetKit reload, so the first
 * change after a quiet spell goes out almost at once and edits that keep
 * landing (every autosave bumps a note's updatedAt) are coalesced to one
 * publish per interval; backgrounding flushes whatever is pending so the
 * Home Screen is current the moment the user leaves.
 *
 * Task freshness is this module's job too: app-core rescans a note's tasks
 * on change only while a tasks surface is on screen (store.ts,
 * `tasksSurfaceVisible`), which on the phone is rarely the case while
 * editing. Notes whose updatedAt moved get a per-note rescan; a vault switch
 * (or a big batch, e.g. iCloud landing many files) gets one full scan.
 *
 * The Calendar widget's checkbox taps come back through here too: the
 * native side logs each one (widget-calendar.ts), this applies the log at
 * launch and on every return to the foreground, and the next snapshot's
 * `actionsAck` tells the widget which taps it may forget.
 */
import { App as CapApp } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { getShellSnapshot, subscribeShell, type ShellSnapshot } from '@zennotes/app-core/shell'
import { getTasksSnapshot, subscribeTasks, refreshTasks, getTodayTasks, setTaskChecked, type TasksSnapshot } from '@zennotes/app-core/tasks'
import { getCalendarWidgetData } from '@zennotes/app-core/calendar'
import { subscribeSettings } from '@zennotes/app-core/settings'
import { toIsoDateLocal } from '@zennotes/shared-domain/tasks'
import { activeVaultNativeRoot, activeVaultStateKey, isMobileNoteIndexReady } from './mobile-bridge'
import { getPinnedNotes, subscribePins } from '../ui-mobile/pins'
import {
  WIDGET_SNAPSHOT_VERSION,
  selectWidgetNotes,
  selectWidgetTasks,
  themeFromTokens,
  type WidgetSnapshot,
  type WidgetTheme
} from './widget-snapshot'
import { parseWidgetActions, seenLine, type WidgetCalendar } from './widget-calendar'

interface ZenWidgetsPlugin {
  update(options: { snapshot: string }): Promise<void>
  clear(): Promise<void>
  /** The newest `zennotes://` link that launched or woke this process, once
   *  (deep-links.ts). Null when the app was opened normally. */
  consumeLaunchLink(): Promise<{ url: string | null }>
  /** The Calendar widget's logged checkbox taps, oldest first. Reading
   *  leaves them in place; a snapshot whose `calendar.actionsAck` covers a
   *  tap is what clears it. */
  readActions(): Promise<{ actions: unknown }>
}

export const ZenWidgets = registerPlugin<ZenWidgetsPlugin>('ZenWidgets')

const PUBLISH_DEBOUNCE_MS = 400
const PUBLISH_MIN_INTERVAL_MS = 8000
/** Past this many changed notes one full scan beats per-note rescans. */
const RESCAN_BATCH_LIMIT = 8

type StoreState = ShellSnapshot

let timer = 0
let lastPublishedAt = 0
let lastPayload = ''
let taskVaultKey: string | null = null
let tasksSettled = false
let knownUpdatedAt = new Map<string, number>()
let inFlight: Promise<void> | null = null
let publishAgain = false
let actionsAck = 0
let actionsWanted = true
let applyingActions = false
let actionsRetryTimer = 0
let actionsRetries = 0
/** A tap that cannot be applied yet (its note open with a buffer the
 *  foreground resync has yet to reload, a write that failed) is tried again
 *  after this, a few times, then on the next return to the foreground. */
const ACTIONS_RETRY_MS = 4000
const ACTIONS_MAX_RETRIES = 5

function themeMode(): WidgetTheme['mode'] {
  return document.documentElement.dataset.themeMode === 'light' ? 'light' : 'dark'
}

/** The Calendar widget's block; null when core could not build it (a note
 *  read failed mid-switch), which the widget shows as "open the app". */
async function buildCalendar(state: StoreState, now: Date): Promise<WidgetCalendar | null> {
  const vaultKey = state.vault?.root
  if (!vaultKey) return null
  // Taken before the data is read: a tap applied while it is being built
  // must not be acked by a snapshot that predates it, or the widget would
  // forget the tap and draw the box empty again.
  const ack = actionsAck
  try {
    return {
      ...(await getCalendarWidgetData(now)),
      vaultKey,
      vaultRoot: Capacitor.getPlatform() === 'android' ? activeVaultNativeRoot() : null,
      actionsAck: ack
    }
  } catch (err) {
    console.error('calendar widget data failed', err)
    return null
  }
}

async function buildSnapshot(state: StoreState, now: Date): Promise<Omit<WidgetSnapshot, 'generatedAt'>> {
  const style = getComputedStyle(document.documentElement)
  const today = getTodayTasks(now)
  const { tasks, counts } = selectWidgetTasks(today.tasks, today.overdueCount, toIsoDateLocal(now))
  return {
    version: WIDGET_SNAPSHOT_VERSION,
    vaultName: state.vault?.name ?? null,
    theme: themeFromTokens((token) => style.getPropertyValue(token), themeMode()),
    notes: selectWidgetNotes(state.notes, getPinnedNotes(activeVaultStateKey())),
    tasks,
    taskCounts: counts,
    tasksReady: tasksSettled,
    calendar: await buildCalendar(state, now)
  }
}

async function publish(): Promise<void> {
  const state = getShellSnapshot()
  // No vault (onboarding, a switch in flight): keep whatever the widgets
  // already show rather than blanking them.
  if (!state.vault || !state.workspaceRestored) return
  let body: Omit<WidgetSnapshot, 'generatedAt'>
  try {
    body = await buildSnapshot(state, new Date())
  } catch (err) {
    console.error('widget snapshot failed', err)
    return
  }
  // The vault switched while the calendar was read: that publish is stale.
  if (getShellSnapshot().vault?.root !== state.vault.root) return
  const payload = JSON.stringify(body)
  if (payload === lastPayload) return
  lastPayload = payload
  lastPublishedAt = Date.now()
  const snapshot: WidgetSnapshot = { ...body, generatedAt: Date.now() }
  await ZenWidgets.update({ snapshot: JSON.stringify(snapshot) }).catch(() => {})
}

/** One publish at a time: building the calendar awaits note reads, and two
 *  overlapping publishes could land out of order. */
function publishNow(): void {
  if (inFlight) {
    publishAgain = true
    return
  }
  inFlight = publish().finally(() => {
    inFlight = null
    if (publishAgain) {
      publishAgain = false
      publishNow()
    }
  })
}

function schedule(): void {
  if (timer) return
  const wait = Math.max(PUBLISH_DEBOUNCE_MS, lastPublishedAt + PUBLISH_MIN_INTERVAL_MS - Date.now())
  timer = window.setTimeout(() => {
    timer = 0
    publishNow()
  }, wait)
}

function flush(): void {
  if (!timer) return
  window.clearTimeout(timer)
  timer = 0
  publishNow()
}

/**
 * Apply the Calendar widget's logged taps once the vault is ready, in the
 * order they were made, through core's own toggle, which finds the task
 * again or leaves it alone when its line changed. A tap the widget already
 * wrote goes through it too: it finds the line in the wanted state and
 * only rescans, and a later tap on the same task still wins. A tap that
 * cannot be applied yet stops the pass there, unacked, so nothing after it
 * jumps ahead. A tap logged against another vault is dropped: the same path
 * in this vault is a different note.
 */
async function applyWidgetActions(): Promise<void> {
  if (applyingActions || !actionsWanted) return
  const state = getShellSnapshot()
  const root = state.vault?.root
  if (!root || !state.workspaceRestored || !isMobileNoteIndexReady()) return
  applyingActions = true
  actionsWanted = false
  try {
    const actions = parseWidgetActions((await ZenWidgets.readActions()).actions)
    let ack = actionsAck
    let blocked = false
    for (const action of actions) {
      if (action.at <= actionsAck) continue
      if (action.vaultKey === root) {
        const result = await setTaskChecked(action.id, seenLine(action), action.checked)
        if (result === 'retry') {
          blocked = true
          break
        }
        if (result === 'stale') {
          console.warn('[zen] a widget tick no longer matches its note; left alone:', action.path)
        }
      }
      ack = Math.max(ack, action.at)
    }
    window.clearTimeout(actionsRetryTimer)
    if (blocked && actionsRetries < ACTIONS_MAX_RETRIES) {
      actionsRetries += 1
      actionsRetryTimer = window.setTimeout(() => {
        actionsWanted = true
        void applyWidgetActions()
      }, ACTIONS_RETRY_MS)
    } else if (!blocked) {
      actionsRetries = 0
    }
    if (ack > actionsAck) {
      actionsAck = ack
      lastPayload = ''
      schedule()
    }
  } catch (err) {
    console.error('widget actions failed', err)
  } finally {
    applyingActions = false
  }
}

function reconcileTasks(state: StoreState, prev: StoreState | null, tasks: TasksSnapshot, previousTasks: TasksSnapshot | null): void {
  if (!state.vault || !state.workspaceRestored || !isMobileNoteIndexReady()) return
  const key = activeVaultStateKey()
  if (key !== taskVaultKey) {
    taskVaultKey = key
    tasksSettled = false
    knownUpdatedAt = new Map(state.notes.map((n) => [n.path, n.updatedAt]))
    if (!tasks.loading) void refreshTasks()
    return
  }
  if (previousTasks?.loading && !tasks.loading) tasksSettled = true
  if (!prev || state.notes === prev.notes) return
  const changed: string[] = []
  const next = new Map<string, number>()
  for (const n of state.notes) {
    next.set(n.path, n.updatedAt)
    if (n.folder !== 'trash' && knownUpdatedAt.get(n.path) !== n.updatedAt) changed.push(n.path)
  }
  knownUpdatedAt = next
  if (changed.length === 0) return
  if (changed.length > RESCAN_BATCH_LIMIT) {
    if (!tasks.loading) void refreshTasks()
    return
  }
  for (const path of changed) void refreshTasks(path)
}

/** Start publishing; returns the teardown (tests / hot paths — the shell
 *  itself never stops). No-op off the native platform. */
export function installWidgetPublisher(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  let shell = getShellSnapshot()
  let tasks = getTasksSnapshot()
  const changed = (): void => {
    const nextShell = getShellSnapshot(), nextTasks = getTasksSnapshot()
    const previousShell = shell, previousTasks = tasks
    // Store subscriptions can fire synchronously when refreshTasks starts.
    shell = nextShell; tasks = nextTasks
    reconcileTasks(nextShell, previousShell, nextTasks, previousTasks)
    void applyWidgetActions()
    schedule()
  }
  const unsubShell = subscribeShell(changed)
  const unsubTasks = subscribeTasks(changed)
  const unsubSettings = subscribeSettings(schedule)
  const unsubPins = subscribePins(schedule)
  const appState = CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      flush()
      return
    }
    actionsWanted = true
    actionsRetries = 0
    void applyWidgetActions()
  })
  reconcileTasks(getShellSnapshot(), null, getTasksSnapshot(), null)
  void applyWidgetActions()
  schedule()
  return () => {
    unsubShell(); unsubTasks(); unsubSettings()
    unsubPins()
    void appState.then((handle) => handle.remove()).catch(() => {})
    window.clearTimeout(timer)
    timer = 0
  }
}
