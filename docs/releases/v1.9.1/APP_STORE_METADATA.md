# App Store Connect metadata: ZenNotes 1.9.1

| Field | Value | Limit |
| --- | --- | --- |
| Name | ZenNotes: Markdown Notes | 30 |
| Subtitle | Plain-file notes, math, tasks | 30 |
| Category | Productivity (secondary: Utilities) | n/a |
| Keywords | markdown,notes,sync,backup,offline,icloud,wikilink,math,tasks,vault,editor,private | 100 |
| Promotional text | see `PROMOTIONAL_TEXT.txt` | 170 |
| Description | see `APP_STORE_DESCRIPTION.txt` (unchanged from 1.9) | 4000 |
| What's New | see `WHATS_NEW.txt` | 4000 |
| Review notes | see `APP_STORE_REVIEW_NOTES.txt` (no account required) | n/a |
| Support URL | https://github.com/ZenNotes/zennotes/issues | n/a |
| Marketing URL | https://zennotes.org | n/a |
| Privacy policy URL | Unchanged from 1.9 | n/a |
| Age rating | Unchanged from 1.9 (4+) | n/a |
| Price | Free app; optional external SaaS subscription | n/a |
| Version | 1.9.1 (build 12) | n/a |

## App Privacy

**Unchanged from 1.9.** This patch changes only the local presentation of the
area behind Apple's system keyboard. It adds no data collection, permissions,
accounts, network endpoints, or third-party services.

## Release checks

- `MARKETING_VERSION` is 1.9.1 and `CURRENT_PROJECT_VERSION` is 12 in all four
  build configurations (App + ShareExtension × Debug/Release).
- Source: [ZenNotes/zennotes#644](https://github.com/ZenNotes/zennotes/issues/644),
  the follow-up to [#631](https://github.com/ZenNotes/zennotes/issues/631). The
  1.9 compatibility presentation did not remove the exposed black keyboard
  backdrop on every newer iOS version.
- Root cause: native keyboard resize shortens the web view. Around a rounded
  keyboard, that can expose the underlying iOS window, which previously had no
  theme background and appeared black.
- The app now sends its active theme background to an app-local native bridge.
  The bridge applies an opaque matching color to the exact iOS window hosting
  ZenNotes and refreshes it when the keyboard opens.
- The keyboard remains Apple's system keyboard. ZenNotes does not ship a
  keyboard extension or gain access to typing outside its own editor.
- `UIDesignRequiresCompatibility` remains enabled for the main app, but the
  backdrop correction no longer depends on that presentation being honored.
- `.zennotes-commit` remains `c164601`; there is no app-core sync in 1.9.1.
- Verified with 7/7 unit tests, a Vite production build, Capacitor iOS sync, an
  Xcode simulator build, simulator installation, and a rounded-keyboard visual
  check on iOS 26.5. Direct iOS 27 confirmation remains outstanding.
- No test account or credentials are required. App Review can exercise the fix
  with a local on-device or iCloud Drive vault.
- Existing iPhone and iPad App Store screenshots can be reused; this patch does
  not change the store-listing story.
