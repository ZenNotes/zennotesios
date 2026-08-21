# ZenNotes for iPhone and iPad 1.9.1: a cleaner keyboard transition

1.9.1 fixes the remaining dark backdrop that could appear around Apple's
rounded system keyboard on newer iOS versions.

## What's fixed

- **No more black block behind the keyboard.** When iOS shortens ZenNotes to
  make room for the keyboard, the newly exposed native window now matches the
  active ZenNotes theme instead of appearing black.
- **Light and dark themes both stay seamless.** ZenNotes refreshes the native
  backdrop whenever the keyboard opens, so it follows the current theme.
- **The keyboard is still Apple's.** This changes only the app background
  visible around the system keyboard. ZenNotes does not install or replace a
  keyboard.

This patch resolves the follow-up report in
[#644](https://github.com/ZenNotes/zennotes/issues/644), which confirmed that
the compatibility-based adjustment in 1.9 did not cover every newer iOS
presentation. The original visual report is tracked in
[#631](https://github.com/ZenNotes/zennotes/issues/631).

There are no new permissions, services, or data collection changes. Local-first
storage and iCloud Drive continue to work with or without a ZenNotes Cloud
account.
