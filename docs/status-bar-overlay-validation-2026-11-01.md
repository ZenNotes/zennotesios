# Status bar overlay and bottom strip: verification, 1 November 2026

Branch `fix/ios-overlay-1035`, cut from `origin/main` at e2bf684 (1.35.0,
build 54). Committed locally, not pushed. Changes: `ios/App/App/ZNViewController.swift`,
`src/bridge/keyboard-backdrop.ts`, `src/main.tsx`, `src/ui-mobile/mobile.css`
and the layout contracts in `src/ui-mobile/mobile-layout.test.ts`. No
app-core change and no Capacitor config change.

Report: ZenNotes/zennotes#1035 (@Christian-SC26), iPhone 1.35.0 on iOS 27.2
in dark mode. A whitish, translucent band covers the status bar; it goes away
once the keyboard opens. A blank strip sits at the bottom of the screen.

## Cause

**The band is the iOS 27 scroll edge effect on the web view.** Apps built
with the iOS 27 SDK get the current design whatever
`UIDesignRequiresCompatibility` says (the key added for #631 only works on
iOS 26), so the WKWebView's scroll view carries the system's top edge effect
(`style=automatic backgroundCapture=sampled`, read with lldb from the running
1.35.0 build). The effect is a progressive blur over the top safe area. Near
the screen edge it samples past the page, which is transparent
(`ios.backgroundColor` `#00000000`), into the UIWindow behind it.

**The window's color is the keyboard backdrop's**, and that was only set at
boot and on `keyboardWillShow`. At boot `index.html`'s pre-boot script sets
`data-theme` from the stored `themeId` as is, even in Auto mode, and Auto
keeps the id of the variant the user picked (`apple-light`, say). The boot
sync read that light theme's `--z-bg` (white) into the window; core then
resolved Auto to `apple-dark`, and nothing repainted the window. The edge
effect blurred white into the status bar. Opening the keyboard ran the sync
again, so the window turned dark and the band went away: exactly the report.
The same thing happens without a cold launch when Auto follows the system
from light to dark while the app runs, or when a theme is picked in Settings.

Measured column, top 60 pt, dark Apple theme: the reporter's screenshot runs
126, 125, 124, 121, 117, 111, 102, 87, 69, 51, 38, 30, 28 (every 5 pt); the
simulator before the fix runs 127, 127, 125, 122, 119, 114, 105, 94, 77, 59,
45, 33, 29.

**The bottom strip is the shell's own padding.** `.zn-app-shell` padded
`0.75rem + env(safe-area-inset-bottom)` under every view (46 pt on an iPhone
16 Pro), so the note stopped at a hard line well above the home indicator.

## Fix

- **Native:** `ZNViewController` hides the web view's four scroll edge effects
  (iOS 26 and later). The page draws its own chrome edge to edge and never
  scrolls the document, so the effects have nothing to mark. This alone
  removes the band, whatever color the window has.
- **Backdrop follows the theme:** `watchThemeBackdrop()` replaces the one-off
  boot sync. It re-reads `--z-bg` whenever core changes `data-theme` or
  `data-theme-mode` on `<html>`, or the managed `<style>` elements in `<head>`
  (custom themes, tweaks), coalesced to one frame and deduplicated, so the
  window around the rounded keyboard and behind the web view always matches
  the theme. The `keyboardWillShow` sync stays as a cheap second check.
- **Bottom edge:** the shell no longer pads the bottom. Views run under the
  home indicator to the screen edge, and every view's main scroller (a
  `flex-1` overflow element: Home, Read mode, Tasks, Tags, the collections, a
  database table) ends with a `::after` spacer of the old clearance
  (`--zn-shell-bottom`), so the last line still scrolls clear. The editor's
  scroller already ends with core's fifth-of-a-screen padding. Kept as before:
  the Kanban board pads itself so its columns stop above the indicator; side
  panels and the separate note-list column pad themselves and add no spacer;
  with the keyboard up the clearance is 0, as the shell's padding was; Cloud's
  attention row, the last thing in the shell, carries the clearance under its
  44 px so its action and the circle sit where they did.

## Verification

Scratch simulator `zn-1035-scratch` (iPhone 16 Pro, iOS 27.2 24B8117, Xcode
27.2), Debug builds of `origin/main` and of this branch. The page was driven
through an eval channel injected into the scratch builds' `dist` only, touch
through a scratch XCUITest driver (an existing UI test file replaced locally
and restored afterwards), native state read with lldb. Both were removed and
`dist` rebuilt clean.

| Case | Before (1.35.0) | After |
| --- | --- | --- |
| Cold launch, Auto + Apple theme (stored `apple-light`), iPhone in dark mode | whitish band, top 127 fading to the background by 60 pt | top exactly the background (28 28 30) |
| Window forced white through the backdrop plugin | band 127 to 29 (the report's profile) | no change at the top |
| Stripes painted under the status bar | blurred and dimmed over the top 50 pt | crisp |
| Edge effects (lldb), after a keyboard cycle and appearance flips | top/bottom/left/right shown | all four `isHidden == YES` |
| Window color (lldb) after the system flips light, then dark | stays the boot color | white, then 28 28 30 |
| Note in Edit mode, at rest | text stops at 828, blank to 874 | text runs to 874 |
| End of scroll: Read mode, Home, Tasks, Tags, Archive, Trash, database table | | scroller reaches 874 and ends with a 46 px spacer; Read mode's last line at 462 |
| Kanban board | columns end at 816 | columns end at 816 (board padded 58 px), card lists add no spacer |
| Outline panel | | panel pads 46 px, its scroller adds no spacer |
| Cloud attention row (phase forced to `attention`) | row 784 to 828, circle bottom 784 | row content 784 to 828, padded to 874, circle bottom 784 |
| Keyboard open and closed in a note | | toolbar and keyboard as before, top stays clean |
| iPhone in light mode | blank strip at the bottom | text runs to the edge; no band in either version |

Automated: `npm test` 416 passed (the new layout contract fails on
1.35.0's `mobile.css` and passes here); `npm run typecheck` clean;
`npm run build`, `cap copy ios` and the simulator `xcodebuild` succeed.

Screenshots (before/after in dark and light, and the reporter's top strip
next to both) are in the side-session notes folder `iphone-status-bar-1035/`,
not in the repo.

## Android

No matching change. The band needs UIKit's scroll edge effects behind a
transparent WKWebView and the iOS-only backdrop plugin; Android has neither.
At the bottom, Android shows core's status row with the Cloud status at all
times (#48: its word-count hide no longer matches core's `px-3 sm:px-6`), so
the inset under it is that row's navigation-bar clearance, not dead space.
Porting the shell rule there would only add a spacer above the row. If
Android ever hides that row the way the iPhone does, port these rules then.

## Not verified

A real iOS 27.2 device; landscape (no rotation without the simulator panel;
the spacer uses the same inset, 20 pt in landscape); iPad (the CSS is
phone-gated, the native change applies there too); a real Cloud account in
an attention phase (forced through the DOM instead); custom themes and theme
tweaks (covered by the `<head>` observer, not exercised); VoiceOver.

## How to test locally

1. In this worktree: `npm ci && npm run build`, then
   `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap sync ios`.
2. Run the App scheme on an iOS 27 iPhone simulator. Fresh install: "Get
   started", then "On this iPhone".
3. With the simulator in light mode: ••• More, Settings, Appearance, mode
   Auto, then pick the Apple theme (Auto stores the light variant's id).
   Switch the simulator to dark (Features, Toggle Appearance) and relaunch
   the app. Before: a whitish band over the status bar until a keyboard
   opens. After: the status bar sits on the plain dark background, and stays
   clean when the appearance is toggled while the app runs.
4. In any note: the text runs to the bottom edge (before: a blank strip about
   46 pt tall); scroll to the end and the last line rests above the home
   indicator. Home, Tasks and a database scroll the same way.
5. Tasks, Kanban: the columns still stop above the home indicator.
