# UI tests on the iOS 27.2 simulator: bounding XCTest's animation wait, 25 November 2026

Branch `fix/ui-tests-idle-bound`, cut from `origin/main` at 01981af (1.44.0,
build 66). Changes: `ios/App/AppUITests/UITestCase.swift` (new), the five test
classes now inherit from it, `project.pbxproj` (the new file),
`tooling/cloud-ui-tests.mjs` (two report lines), and a row helper in
`CloudFlowUITests.swift` (second fix, at the end). No app code changes.

## The problem

On the iOS 27.2 simulator an app can stop telling XCTest that its animations
are done, for the rest of that process's life. XCTest asks before and after
every tap and typed string, and then waits its full 60 seconds each time ("App
animations complete notification not received, will attempt to continue.").
The app itself keeps working.

- 24 November, full Cloud run: `testAutomaticCloudSyncPushesIOSChange` passed
  in 9 min 33 s (31 s on 9 November, iOS 27.0). Nine waits of 60 s, all in
  ZenNotes, the first right after Dismiss keyboard.
- 24 November, the same test alone: the stall began in Safari right after the
  Save Password sheet's Not Now. Waits of 60 s, 60 s, 648 s and 685 s, the
  device approval expired, the test failed at `CloudFlowUITests.swift:474`.
- It is not tied to Cloud or to sign-in. `FavoriteUITests` hit it three times
  here with no account at all: after Dismiss keyboard twice, after a tap in the
  ensō menu once. Two of the three were its first run on a freshly erased
  simulator, which is how every Cloud run starts. Twenty-seven other runs of
  that test did not stall, with the bound or without, so it is intermittent.

## The change

XCTest has no public setting for this wait. Every event, launch and activation
reaches it through one private method,
`-[XCUIApplicationProcess waitForQuiescenceIncludingAnimationsIdle:isPreEvent:]`,
and the wait's length is XCTest's application state timeout
(`_XCTApplicationStateTimeout`, 60 s). `AnimationIdleBound` replaces the method
with one that calls the original under a lower timeout and puts the timeout
back:

- A healthy process gets the original call once, as before, capped at 5 s.
  Healthy waits measured here: under 0.5 s after an event, 1.5 to 2 s after
  launch.
- A process that used up a cap is treated as stalled. Its waits then run the
  run loop step under the usual 60 s and the animations step for at most 1 s.

If a later Xcode renames the method or the timeout, nothing is replaced and a
line starting `IDLE_BOUND` is printed; the Cloud runner repeats it under its
report. The runner also counts, per test, the idle waits that were cut short.

No assertion changed.

## What else was looked at

- `XCUIApplication.idleAnimationWaitEnabled = false` (private). Skips the
  animations step outright. It is per `XCUIApplication` instance and it changes
  a healthy run too: taps would go out while the keyboard or a Safari sheet is
  still moving. Not used.
- The private interaction options that skip the pre and post event waits. They
  skip the run loop wait as well. Not used.
- A flat 1 or 2 second bound on every wait, run loop step first. It worked
  under a stall (the note steps below took 80 s at 2 s and 52 s at 1 s), but it
  cut the launch wait short on every healthy run and ran two waits per step.
  Replaced by the version above, which leaves a healthy run's timing alone.
- Coordinate taps, or putting the keyboard away another way. Coordinate taps
  go through the same wait, and one stall began after a menu tap.
- Keeping sign-in inside the five-minute approval needs nothing of its own
  once each wait is bounded.

## Verification

Scratch simulator (iPhone 17 Pro, iOS 27.2, Xcode 27.2), deleted afterwards. No
Cloud sign-in was run: that needs the QA password.

To have a stall on demand, a scratch build of the app ran an endless 1-point
`UIView` animation, from launch or from the first keyboard hide. Without the
bound that gives the same message and 60.0 s per step. A scratch test ran the
push test's note steps (new note, title, body, Dismiss keyboard, Settings to
Cloud and back twice). Both were removed before the final runs.

| Case | Result |
| --- | --- |
| Stand-in stall, no bound | 60.0 s per step, same message as the Cloud runs |
| Stand-in stall from the first keyboard hide, bound | every test passed, 73 waits cut short; note steps 56 s (27 s healthy), Favorite 73 s (35 s) |
| Stand-in stall from launch, bound | every test passed, 118 waits cut short |
| A 3 s animation, then none | the two waits inside it cut short, every later wait returned at once |
| The real stall (3 runs of `FavoriteUITests`) | passed in 54 to 70 s with 19 to 35 waits cut short |
| Final tree, erased simulator, all five classes, twice | 7 passed, 7 skipped (account or iPad), 0 failed; longest wait 5.0 s; the first run hit the real stall |

"Every test" is the account-free set: the Cloud route test, the scratch note
steps, `DeepLinkUITests`, `FavoriteUITests`, `SearchCreateUITests` and
`MoveDirectoryUITests`, with one exception that is not about idle waits:
`MoveDirectoryUITests` leaves two folders behind per run and scrolls a fixed
distance to reach New folder, so after about twenty runs on one simulator it
stops finding the row. On an erased simulator it passes.

Expected for the push test under the stall seen on 24 November (nine waits):
about 13 s on top of its 31 s, instead of nine minutes.

## The account-backed run, and a second fix

The maintainer ran `npm run test:ui:cloud` on this branch at 12:33 (bundle
`cloud-ui-tests-2026-11-25T18-33-52-592Z`): 6 passed, 1 skipped (iPad),
1 failed, 256 s for the suite. `testAutomaticCloudSyncPushesIOSChange` took
32 s. No wait went unanswered in that run, so the bound was installed but
never needed there.

The failure was `testPublishesNoteWithSyncedAttachment`, and it is not an idle
wait: "Failed to determine hittability of "Cloud attachment publishing proof"
Button: Activation point invalid and no suggested hit points based on element
frame". The run's own snapshot shows the row at y 784 to 830 and the Browse
drawer's fixed Settings button at y 788 to 832. For a row lying under that
button XCTest records a failure instead of answering "not hittable", and
`canTap` asked before `coveredByDrawerFooter` could rule the row out. The row
got there because the QA vault's list moves down one row with every push test
(and two "Idle probe" notes were added on 24 November); the day before, the
same row was in the clear.

Reproduced with no account on a scratch simulator: nine new notes put
"Untitled 4" at y 784, and the unchanged helpers failed with the same message.
`CloudFlowUITests` now has `canTapRow`, which checks the footer by frame
first; `hittableButton` and `scrollUntilHittable` use it. With it the same
scratch test scrolled the row clear and opened the right note.

## The account-backed run with both fixes

Run by the maintainer at 12:54 (bundle `cloud-ui-tests-2026-11-25T18-54-23-977Z`):
7 passed, 1 skipped (iPad), 0 failed, 257 s for the suite.

| Test | Time |
| --- | --- |
| `testAutomaticCloudSyncPullsDesktopAndAndroidChanges` | 68 s |
| `testAutomaticCloudSyncPushesIOSChange` | 33 s (9 min 33 s on 24 November, 31 s on 9 November) |
| `testCloudSettingsOpenThroughTheMoreSheet` | 9 s |
| `testCloudSyncAndBackupFlow` | 37 s |
| `testDesktopNoteAppearsAfterSync` | 33 s |
| `testPublishesExistingNote` | 32 s |
| `testPublishesNoteWithSyncedAttachment` | 35 s |

`testPublishesNoteWithSyncedAttachment` found its row under the footer again,
swiped once and tapped it. No idle wait went unanswered in this run or in the
12:33 one, so the simulator's stall has not yet happened in an account-backed
run with the bound installed. Where it did happen with the bound (six
account-free runs, 19 to 73 waits each), no wait lasted longer than 5.0 s;
five of those tests passed and the sixth failed only on the covered row above,
before its fix.

A run started at 12:49 was stopped by hand after 2 min 29 s and left an
unreadable bundle (`cloud-ui-tests-2026-11-25T18-49-43-598Z`); it says nothing
about either fix.
