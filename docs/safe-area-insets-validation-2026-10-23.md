# Safe-area insets: verification, 23 October 2026

Branch `fix/safe-area-insets`, cut from `origin/main` at 6e0887e (1.31.0,
build 47). Committed locally, not pushed. Changes: `src/ui-mobile/mobile.css` and
two new contract tests in `src/ui-mobile/mobile-layout.test.ts`. No native
code, no Capacitor config and no app-core change.

This is the iPhone port of the Android shell's system bar fix
(zennotesandroid `fix/system-bar-insets`, from Dave's report on 2026-10-23:
Review sync changes drew its last line under the navigation bar). Both
shells carry the same `mobile.css` dialog-sheet and app-shell rules, so the
iPhone had the same geometry problems; only the insets differ.

## Cause

The iPhone shell has always drawn edge to edge (`viewport-fit=cover`,
`ios.contentInset: 'never'`), so `env(safe-area-inset-*)` carries the real
values and the CSS owns every inset: the status bar and Dynamic Island at
the top, the home indicator at the bottom, and in landscape the sensor
housing on one side with a matching inset on the other. Measured on the
iPhone 17 Pro simulator: portrait 402x874 with top 62 and bottom 34;
landscape 874x402 with left 62, right 62, bottom 20 and top 0; bottom 0
while the keyboard is up.

1. **Dialog sheets overflow into the bottom inset.** `mobile.css` turns core
   dialogs into bottom sheets capped at `86dvh`, with the home indicator's
   height as `padding-bottom` inside that cap. Core sizes some dialog bodies
   in `vh` for the desktop: Review sync changes has a `72vh` scroller under
   its header. Once the body reaches its cap, header + body + inset exceed
   `86dvh`, and `overflow: hidden` clips at the padding edge, so the body
   paints into the strip under the home indicator. The overflow is
   header + inset minus 14% of the screen height: 8 px on a 17 Pro in
   portrait, 36 px in landscape (20 px under the indicator, 16 px off the
   bottom of the screen, so the end of the body could not be reached).
2. **Full-screen surfaces ignore the bottom inset.** Settings' footer note
   sat under the home indicator, and the search palette's results ran to
   the screen bottom, so with a long list the last rows could never scroll
   clear of it.
3. **Nothing honors the side insets.** In landscape the editor's lines, the
   note header's back button, the More and Create sheets, dialog sheets, the
   drawer, the search palette, Outline and Settings all ran under the sensor
   housing side and the mirrored inset ("Finish later" in Review sync
   changes sat in the right inset).

It went unnoticed because the app is mostly used in portrait, where the
overflow is a few pixels into a mostly empty strip.

## Fix (shell CSS only, same rules as the Android shell)

- Dialog sheets: block panels become a flex column, so a vh-capped scroller
  (the dialog body) shrinks to fit the cap and the header and footer stay in
  view; panels core already lays out as `flex` or `grid` are left alone.
  `overflow-y: auto` replaces the clip, so anything that still does not fit
  scrolls with the inset at the end of the scroll instead of painting into
  it. Left and right insets are padded.
- Palettes and Settings pad all four insets; their absolute corner buttons
  (Cancel, Done, back) add the side inset.
- App shell, shell sheets and onboarding pad the side insets; the drawer
  widens by the left inset; the separate note-list column pads left; side
  panels are inset (not padded, since core gives them their own side
  padding) and their Done button moves in; the toast host clears both sides.

The comments describe the iPhone's insets (home indicator, sensor housing)
rather than Android's navigation bar; the selectors and values match the
Android change one for one, so the two shells stay in step.

Deliberately not done: no app-core edit (optionally, `CloudConflictDialog`
could lay its panel out as `flex flex-col` with a `min-h-0 flex-1` body in
place of the fixed `max-h-[72vh]`, so other hosts get the same fit), and no
native change.

Visible side effect: in landscape a dialog's tinted footer strip (for
example the Move to Trash confirm) now stops at the safe area, 62 px from
each edge, with the sheet's own background in the insets. Android has the
same.

## Verification

Scratch simulator `zn-safe-area-scratch` (iPhone 17 Pro, iOS 26.5, Xcode
27.1), Debug build of this branch and of `origin/main`. The page was driven
through a small eval channel injected into the scratch builds' `dist`
(never into the source), rotation through the simulator. A stand-in for
Review sync changes was mounted with the exact core 2.75.0 Modal, Header and
Body class strings, in two states: six queued files with the resolver still
loading (Dave's screenshot), and the resolver loaded (both versions, the
merge box and its buttons), since the simulator has no Cloud account to
raise a real conflict. The probe flags any button, link, status, input or
text whose clipped box reaches into a non-zero inset.

| Case | Before (main, 1.31.0) | After |
| --- | --- | --- |
| Review sync changes, loading, portrait | fits (body 619 px, under its 629 px cap) | unchanged |
| Review sync changes, loaded, portrait | body ends at 848, indicator from 840 | body shrinks to end at 840; nothing to scroll |
| Review sync changes, loaded, landscape (both rotations) | body spans x 0 to 874, ends at 418 (screen 402): 20 px under the indicator, 16 px off-screen; text from x 20 under the sensor housing; Finish later at 762 to 854 | body spans x 62 to 812, ends at 382; scrolled to the end the last line ends at 366 |
| Home, More, Create, Browse, Search, Settings, Outline, landscape | probe hits on every surface (editor lines 32 to 842, back button at 16, sheet rows 14 to 860, drawer rows from 12, Cancel at 798 to 862) | no hits, both landscape rotations |
| Settings, portrait | "Settings save automatically on this device." at 828 to 873, under the indicator | clear |
| Search palette, portrait | results scroller ends at 874 | ends at 840; with the keyboard up the inset is 0 and it meets the keyboard |
| Move to Trash confirm, Rename prompt, landscape | | header and footer inside the safe area, same stacking as before |
| Settings, landscape | | keeps its grid; rows 75 to 799, Done at 733 to 798 |

Before/after composites (insets tinted red) and every screenshot are in the
side-session notes folder `iphone-safe-area-insets/`, not in the repo; start
with `before-after-review-sync-landscape.png` and
`before-after-review-sync-portrait.png`.

Automated: `npm test` 285 passed (the two new layout contracts fail on the
`origin/main` CSS and pass here); `npm run typecheck` clean; `npm run build`
and the simulator `xcodebuild` succeed.

Not verified: a real Cloud conflict on a real iPhone (no account on the
simulator), shorter phones (the overflow grows as the screen gets shorter;
not measured), the toast host (no toast was raised), side panels such as
the calendar and the separate note-list column (not opened), iPad (the
dialog and app-shell rules are phone-gated, and iPad side insets are 0), and
VoiceOver.

## How to test locally

1. In this worktree: `npm ci && npm run build`, then
   `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap sync ios`.
2. Open `ios/App/App.xcworkspace` and run the App scheme on an iPhone 17
   Pro simulator. Fresh install: "Get started", then "On this iPhone".
3. Portrait: open the ensō, More, Settings: the footer note sits above the
   home indicator (before: under it).
4. Rotate to landscape (Cmd+Left): the editor text, the More sheet, Browse
   and Search stay clear of the sensor housing side (before: they ran under
   it). Rotate the other way (Cmd+Right) and check again.
5. With a Cloud account and two devices, edit one note on both and sync:
   Review sync changes keeps its body, its last line and its buttons inside
   the safe area, portrait and landscape (before, in landscape, the end of
   the body was off-screen).
