# ZenNotes for iPhone and iPad 1.9.8: widgets and app core 2.46

Home Screen and Lock Screen widgets, the first native surface the shell
adds beyond the share sheet. Three of them, zero configuration, wearing
whatever theme the app wears. Underneath, the app core moves from 2.45.0
to 2.46.0: the pin release that was prepared as 1.9.8 and never shipped
on its own rides along here.

## What changes on the phone

- **New Note.** A small Home Screen widget, and on iOS 16 and later a
  Lock Screen circle, rectangle, or inline line. One tap creates a note
  in the Inbox and opens it with the title focused, the same path as the
  ⊕ sheet's New note.
- **Recent Notes.** Medium or large. Your pinned notes first, in the
  order you pinned them (the drawer's own rule), then the ones you edited
  last, each with its "3h ago" stamp. A row opens the note; the + in the
  header starts a new one.
- **Today's Tasks.** Medium or large. The Home dashboard's Today bucket:
  due today, overdue, or undated, with overdue tasks first and their
  count in the header. A row lands on the task's line in its note; the
  header opens the Tasks view. "All clear" when nothing is due.
- **Live.** The widgets update within seconds of a change: a saved note,
  a pinned one, a ticked task, a theme switch. Time stamps keep counting
  between updates.

## App core 2.46

- **Comment threads with names.** A reply files under the comment it
  answers and every entry shows who wrote it. An assistant connected over
  MCP on your desktop can answer in the same threads (list_comments,
  add_comment, reply_to_comment, resolve_comment); its replies arrive on
  the phone through your synced vault, signed with its name.
- **Pick any date from the @ menu.** The list ends with Date…, which opens
  a calendar; Today, Yesterday, Tomorrow and Now stay one tap away.
- **Saved Tasks filters.** Name a filter once and recall it from the chips
  under the Tasks header; the list lives in your preferences.
- **The Kanban Folder board** gives every note folder its own column, or
  the children of one folder you name (kanban_folder_root).
- **Math.** A $$ block inside a callout renders in both views, and Typst
  formulas match KaTeX's size with square-root bars in the text color.

Not on the phone: the desktop-only keymap changes (Unbind, ignored keys),
the CLI fix and the remote-template routes, which need a desktop or a
ZenNotes server.

## Under the hood

- A WidgetKit extension target, `ZenWidgets` (`md.zennotes.ZenWidgets`),
  wired by `tooling/add-widget-extension.rb` the way the Share Extension
  is; deployment target stays iOS 15.0, with the Lock Screen families
  gated to 16+ and the container background API to 17+.
- A widget cannot see the vault, so the shell publishes a snapshot into
  the App Group it already shares with the Share Extension: pinned and
  recent note titles, paths and dates; today's tasks; the theme's colors.
  No note bodies. `src/bridge/widgets.ts` publishes on change, throttled
  to one reload per 8 s while typing and flushed on backgrounding;
  `WidgetBridgePlugin.swift` writes the file and reloads the timelines.
- Taps are `zennotes://` links the shell runs after the workspace
  restores, so the cold-launch landing runs first and the link wins. The
  newest link wins while booting.
- Pinned to upstream `a3e638fc`, on ZenNotes/zennotes `main`: app core
  2.46.0 plus the js-yaml and svgo lockfile fix for the advisories
  published on 2026-09-08. The bridge contract gains optional comment
  fields (`author`, `parentId`) and the `kanbanFolderRoot` view setting.
  The on-device vault now reads and writes the comment sidecar through
  the same shared normalizer desktop uses, so a comment action on the
  phone keeps the names and threads instead of rebuilding each record
  from the old field list. Harper stays off the phone.

No new permissions, services, or data collection. Local-first storage and
iCloud Drive continue to work without an account; self-hosted and
ZenNotes Cloud vaults remain optional. The same release ships on Android
as ZenNotes 1.1.18: the widgets, with the app core 2.46 changes from
1.1.17 in its notes.
