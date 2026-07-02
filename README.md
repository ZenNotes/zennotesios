# ZenNotes for iPhone

A Capacitor shell that runs the ZenNotes product core (`packages/app-core` from
the [zennotes monorepo](../../opensource/zennotes)) inside a WKWebView, backed
by a local-first vault on the device filesystem. Implements the architecture in
`docs/specs/mobile/` (Phase 0 + the on-device parts of Phase 1).

The zennotes repo is consumed **read-only, straight from source**, via Vite/TS
path aliases (see `vite.config.ts`) — nothing in that repo is modified. The
repo is expected at `../../opensource/zennotes` relative to this directory.

## Architecture

```
src/
  bootstrap.ts            pre-app-core prefs/theme seeding (must import first)
  main.tsx                install bridge → open vault → renderZenNotesApp()
  bridge/
    mobile-bridge.ts      the third ZenBridge (window.zen) implementation
    vault-fs.ts           desktop vault.ts semantics over Capacitor Filesystem
    vault-core.ts         pure helpers ported 1:1 (folder map, meta extraction,
                          naming, search scoring) — keep in sync with desktop
    native-fs.ts          Capacitor Filesystem wrapper (atomic writes, file URLs)
    events.ts             VaultChangeEvent emitter (in-app writes + rescan)
  ui-mobile/
    MobileShell.tsx       bottom nav (capture ⊕ / search / sidebar / palette),
                          phone drawer behavior via the shared Zustand store
    mobile.css            safe areas, overlay drawers, keyboard handling
ios/                      Capacitor-generated Xcode project (appId md.zennotes)
```

Key decisions (all forced by "don't modify the zennotes repo"):

- **`runtime: 'web'`** — the bridge contract has no `'mobile'` runtime yet.
  Every desktop-only affordance in app-core gates on `runtime === 'desktop'`,
  so `'web'` + the capability flags produces correct mobile behavior. When the
  contract gains `'mobile'` + the new capability flags (spec 02), flip it here.
- **Vault location** — `Documents/ZenNotes/<vault>` in the app container
  (visible in the Files app via `UIFileSharingEnabled`). First run creates
  `My Vault` seeded with the official demo tour (imported read-only from
  `apps/desktop/src/main/demo-tour-data.ts`).
- **On-disk contract is byte-compatible with desktop**: same folder layout
  (`inbox|quick|archive|trash`, `assets/`, legacy `attachements/` recognized —
  the misspelling is intentional and load-bearing), same `.zennotes/`
  metadata (vault.json, workspace.json, comments/), same naming/collision
  rules, same NoteMeta extraction regexes.
- **TikZ** is capability-gated off (no WASM TeX on device); blocks show the
  source with a "renders on ZenNotes desktop" notice, per spec 05.
- **Vim mode defaults off** on first run (soft keyboard; spec 06) — Settings
  can re-enable it. The desktop onboarding wizard is skipped; the vault is
  auto-provisioned.

## Build & run

```sh
npm install
npm run sync          # vite build + cap sync ios
npx cap open ios      # open in Xcode, or:
xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

Dev loop against a browser (no simulator): `npm run dev` — note Capacitor
plugins are absent in a plain browser, so vault I/O won't work; use the
simulator for real testing.

## What works today (verified on the iPhone 17 Pro simulator)

- Vault CRUD: list/read/write/create/rename (with inbound wikilink rewrite)/
  duplicate/move/trash/restore/archive, folders, favorites, comments,
  templates, vault settings, workspace (session) restore
- Rendering: KaTeX, Mermaid, JSXGraph, function-plot, highlight.js, images;
  TikZ graceful fallback
- Search: fuzzy per-line text search (builtin backend semantics) + title
  quick switcher; tags view; tasks view (parser shared from shared-domain)
- Quick capture from the bottom nav (creates in `quick`, opens immediately)
- Mobile chrome (iOS-native pass, all phone-width only — iPad keeps the
  desktop-like layout per spec 07):
  - desktop chrome hidden: window title bar, tab strip, editor icon toolbar,
    word-count status bar, Split mode
  - bottom nav: sidebar · back · capture ⊕ · search · ••• (all actions run
    through the shared command registry, same as the palette)
  - ••• opens an iOS action sheet: Edit/Read segment + note actions
    (outline, rename, move, copy wikilink, archive, trash) + app actions
    (open notes, vault text search, settings)
  - Settings: the desktop two-pane dialog becomes a full-screen paged flow
    (section list → detail with ‹ back, Done to close; MCP/CLI hidden) via
    the "mobilizer" in MobileShell — CSS state + two injected buttons, no
    app-core changes
  - dialogs render as bottom sheets; palettes go full-width; side panels
    (outline/connections/comments) overlay instead of squeezing the editor
  - overlay sidebar drawer + backdrop with slide animation, safe areas,
    keyboard show/hide handling, theme pre-boot (no flash), haptic on capture
  - keyboard-hint strips hidden on phones (vim hints in Tasks list/calendar/
    kanban and Tags footers, palette "Ctrl+N/P · esc" rows, focused-row key
    chips, the Home "Sidebar ⌘1" chip); collection headers compacted
    (Refresh/Close dropped, filter narrowed, header wraps); the Assets table
    collapses to name + used-in on phone width
- Databases (`.base` CSV) using the same shared logic as the web client

- The spec-06 **editing toolbar** docked above the soft keyboard (undo/redo,
  checkbox, bullet, heading cycle, bold/italic/highlight/code, link, wikilink,
  tag, indent/outdent, dismiss) — drives the shared editor via the store's
  `editorViewRef` + app-core's `lib/cm-format.ts`; auto-hides with a hardware
  keyboard
- **Long-press context menus**: a 450ms press on chrome surfaces synthesizes
  the `contextmenu` event the desktop handlers already listen for (the
  finger-lift's synthetic mouse burst is suppressed or the menu would close
  instantly); disabled inside the editor to preserve text selection
- Archive/unarchive round-trip (subpath preserved); the ••• sheet is
  contextual (Unarchive in archive, Restore in trash)
- **iPad**: ≥768px keeps the desktop-like layout per spec 07 (persistent
  sidebar, no bottom nav) — verified on the iPad Pro 11" simulator

- **Share Extension** ("Share to ZenNotes" from any app): the native
  extension (`ios/App/ShareExtension/`) writes shared text/URLs into the
  `group.md.zennotes` App Group; the app drains them into quick notes on
  launch/foreground via the app-local `ShareInbox` Capacitor plugin
  (`ShareInboxPlugin.swift`, registered by `ZNViewController`). URL-only
  shares get a hostname title. The target is wired by
  `tooling/add-share-extension.rb` (xcodeproj gem via Homebrew CocoaPods) —
  re-run it if the Xcode project is ever regenerated. Device builds need the
  App Group registered with the Apple Developer account (automatic signing
  handles it with a paid membership); the simulator doesn't enforce it.
- Edge-swipe gestures: swipe right from the left edge opens the drawer,
  swipe left on the drawer closes it (edge-start only, so editor selection
  and kanban scrolling are untouched)

- **iCloud Drive vault tier** (spec 03): ••• → iCloud Sync moves the vault
  into the app's ubiquity container (`iCloud Drive › ZenNotes`) via Apple's
  `setUbiquitous` migration; the OS syncs it across devices, and a Mac can
  open `~/Library/Mobile Documents/iCloud~md~zennotes/Documents/ZenNotes/…`
  as a desktop vault. Never combined with any other sync on the same vault
  (enable = move, not copy). Placeholder discipline: `.name.icloud` eviction
  stubs are mapped to logical entries in `NativeFs.readdir`, reads request a
  download + retry, and `ensureDownloaded` sweeps the tree at vault open and
  on every foreground — evicted files must never read as deleted (the
  documented Obsidian data-loss class). Graceful fallback to local storage
  when iCloud is signed out. Native side: `ICloudVaultPlugin.swift`;
  entitlements: CloudDocuments + `iCloud.md.zennotes` container;
  `NSUbiquitousContainers` makes the folder visible in the Files app.
  Simulator/device testing requires a signed-in Apple ID (and a paid
  developer team on real devices — iCloud isn't in free provisioning).

## Boot-order gotcha (load-bearing)

Prefs seeding + theme attributes live in an **inline classic `<script>` in
index.html**, not a module: the app-core store reads
`localStorage['zen:prefs:v2']` at module-evaluation time, and Rollup chunk
hoisting (manualChunks) runs the store chunk before any entry-chunk module —
an imported "bootstrap.ts" silently ran too late on fresh installs.

## Not yet built (per the spec's phasing)

- **ZenNotes Sync** (spec 04) — the E2E-encrypted first-party sync service;
  the largest Phase 1 item, spans `apps/server` too
- Home-screen widget / App Shortcuts capture entry points
- iPad split view (two notes side by side); Android (Phase 2)
- Store distribution work (signing, TestFlight, App Store listing — spec 08)
