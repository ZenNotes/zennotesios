# App Store Connect metadata: ZenNotes 1.9.8

| Field | Value | Limit |
| --- | --- | --- |
| Name | ZenNotes: Markdown Notes | 30 |
| Subtitle | Plain-file notes, math, tasks | 30 |
| Category | Productivity (secondary: Utilities) | n/a |
| Keywords | markdown,notes,widgets,sync,backup,offline,icloud,wikilink,math,tasks,vault,editor | 100 |
| Promotional text | see `PROMOTIONAL_TEXT.txt` | 170 |
| Description | see `APP_STORE_DESCRIPTION.txt` (updated: widgets section) | 4000 |
| What's New | see `WHATS_NEW.txt` | 4000 |
| Review notes | see `APP_STORE_REVIEW_NOTES.txt` (no account required) | n/a |
| Support URL | https://github.com/ZenNotes/zennotes/issues | n/a |
| Marketing URL | https://zennotes.org | n/a |
| Privacy policy URL | Unchanged from 1.9 | n/a |
| Age rating | Unchanged from 1.9 (4+) | n/a |
| Price | Free app; optional external SaaS subscription | n/a |
| Version | 1.9.8 (build 19) | n/a |

## App Privacy

**Unchanged from 1.9.7.** The widgets read a summary file the app writes
into its App Group container on the device: note titles, paths and
modification dates, today's task lines, and the theme's colors. No note
bodies, nothing off the device, no new processing. From app core 2.46,
comment authorship is a name stored in the note's own comment file inside
your vault, and saved Tasks filters are a device preference. No new
permissions, data collection, accounts, background modes, network
services, or third-party SDKs. The App Group (`group.md.zennotes`) was
already in use by the Share Extension; the new extension only adds a
second reader.

## Release checks

- Version 1.9.8 (build 19) is set in all six Xcode build configurations
  (App, ShareExtension, ZenWidgets × Debug/Release), committed on its own
  after the widget commit. Build 19 is unused: the last archive in Xcode
  is 1.9.7 (18) from 2026-09-08, and no 1.9.8 build was ever archived or
  uploaded.
- Branch: `release/1.9.8` off main, opened as `release/1.9.9` on the
  assumption that 1.9.8 had shipped and renamed on 2026-09-09. Commits:
  the widgets, the comment-sidecar fix, the version bump, this pack. main
  already carried the
  a3e638fc pin (app core 2.46.0 plus the js-yaml / svgo lockfile fix)
  and the shell's own js-yaml bump.
- Supersedes the pin-only `release/1.9.8` still on origin (1.9.8 build 19
  at the `v2.46.0` tag `da59c372`, pack "app core 2.46"), which was never
  archived, submitted, or merged; its local copy was deleted when this
  branch took the name, so the first push needs `--force-with-lease`. 1.9.7 shipped on app core 2.45, so its
  five phone-visible changes are folded into this pack's What's New,
  review notes, and release notes.
- Pin: `.zennotes-commit` = `a3e638fc`, on ZenNotes/zennotes `main`.
  Between 1.9.7's pin (`3301a29d`, one past `v2.45.0`) and this one,
  app-core gains comment threads with authors and replies, the @ menu
  calendar, saved Tasks filters, the folder-based Kanban board, and the
  two math fixes; the keymap unbind and ignored-keys features are desktop
  surfaces; the bridge contract gains optional comment fields (`author`,
  `parentId`) and the `kanbanFolderRoot` view setting.
- Manual mirror (`git diff --stat 3301a29d..a3e638fc -- packages/bridge-contract
  apps/desktop/src/main/vault.ts`): desktop `vault.ts` dropped its private
  comment normalizer for the shared `@shared/note-comments`, which keeps
  `author` and `parentId`. The shell's `MobileVault.writeNoteComments`
  still rebuilt each record from a fixed field list, and app-core hands
  over the whole list on every comment action, so one reply, resolve, or
  delete on the phone would have flattened every thread and dropped every
  name the desktop or an assistant had written. Fixed in this release:
  `src/bridge/vault-fs.ts` reads and writes the sidecar through the shared
  normalizer, as desktop does. `kanbanFolderRoot` needs nothing: the shell
  keeps no field list for view settings.
- New target: `ZenWidgets`, bundle `md.zennotes.ZenWidgets`, deployment
  target 15.0 like the rest, embedded in Embed Foundation Extensions, App
  Group entitlement only, privacy manifest with no required-reason APIs.
  Wired by `tooling/add-widget-extension.rb`; `add-privacy-manifests.rb`
  knows the target.
- Verified 2026-09-08 on the iPhone 17 Pro simulator (iOS 26.5): the
  gallery previews, all three widgets placed, warm and cold taps land on
  the right note and task line, a new note from the widget, the widgets
  updating within seconds of a change; xcodebuild clean with no warnings
  in the new files; boot-path chunking check unchanged.
- Re-verified 2026-09-09 after renumbering 1.9.9 (20) to 1.9.8 (19) and
  the comment-sidecar fix: `npm test` 45/45, `npm run typecheck` clean at
  the pin, `npm run build` clean, and `dist/index.html` modulepreloads
  unchanged (rolldown runtime, app-local-assets, vendor-react,
  vendor-editor, app-wikilinks, markdown-lines; no mermaid,
  vendor-markdown, or vendor-highlight chunk). The pbxproj change is the
  twelve version strings only. `MobileVault` cannot run under `node
  --test` (path aliases), so the fix rests on the typecheck, the bundle,
  and upstream's own `note-comments.test.ts`; not re-run on the simulator.
- Not verified on a device or on iOS 15/16 hardware for this release. The
  app-core 2.46 changes were verified on the desktop build for the 2.46.0
  release, not on the phone.
- Matching port: Android ZenNotes/zennotesandroid 1.1.18 (versionCode
  20): the widgets, with its Play notes also carrying the app core 2.46
  changes from 1.1.17. Its release notes say "in step with iPhone 1.9.9";
  that is this release.
