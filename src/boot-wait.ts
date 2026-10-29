/**
 * How long boot waits for a native answer it can do without.
 *
 * Boot awaits a few native bridge calls before anything renders: the app
 * version, the Cloud sign-in link listeners and launch URL, and the Share
 * Extension's waiting captures. A call that never answers left a blank page
 * with nothing to do but quit (the Android shell saw it after about eleven
 * rapid Layout reloads, on a Preferences call). Each of these waits now ends
 * after BOOT_NATIVE_WAIT_MS and boot goes on without the answer, logging
 * once. The work itself keeps running: listeners still register and shared
 * captures still land when their answer comes, but an answer that comes late
 * is never applied over what boot already decided (the app version stays the
 * placeholder Cloud sign-in was configured with). The vault itself is not
 * bounded: without it there is nothing to show.
 *
 * The Android shell measured its whole native preferences restore at a few
 * tens of milliseconds; two seconds is far above any normal answer and still
 * short enough that a stalled bridge costs a launch seconds, not the whole
 * app. Same helper as the Android shell's.
 */
export const BOOT_NATIVE_WAIT_MS = 2000

export interface BootTimer {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const browserTimer: BootTimer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export type BootAnswer<T> = { inTime: true; value: T } | { inTime: false }

/** Wait for `work` at most `ms`. A rejection in time rejects; after the wait
 *  ends, the answer (or failure) is dropped and `onLate` has been called once. */
export function settleWithin<T>(
  work: Promise<T>,
  ms: number,
  onLate: () => void,
  timer: BootTimer = browserTimer
): Promise<BootAnswer<T>> {
  return new Promise((resolve, reject) => {
    let done = false
    const handle = timer.set(() => {
      if (done) return
      done = true
      onLate()
      resolve({ inTime: false })
    }, ms)
    work.then(
      (value) => {
        if (done) return
        done = true
        timer.clear(handle)
        resolve({ inTime: true, value })
      },
      (error: unknown) => {
        if (done) return
        done = true
        timer.clear(handle)
        reject(error)
      }
    )
  })
}

/** Boot's wait for a native step, named for the one log line it may write. */
export function waitAtBoot<T>(step: string, work: Promise<T>): Promise<BootAnswer<T>> {
  return settleWithin(work, BOOT_NATIVE_WAIT_MS, () => {
    console.warn(`ZenNotes boot: ${step} did not answer within ${BOOT_NATIVE_WAIT_MS} ms; continuing without it`)
  })
}
