# Cloud pull: fewer bridge calls per file, 26 October 2026

Branch `perf/cloud-pull-bridge-calls`, cut from `origin/main` at 7caa474
(1.32.0 and two later fixes). Changes: `src/bridge/cloud-sync-repository.ts`,
`src/bridge/mobile-cloud-sync.ts`, and tests. No native code, no Capacitor
config and no app-core change. This is the iPhone half of
ZenNotes/zennotesandroid#133.

## Why

A Discord report (yeminn) had phones sitting in "Syncing..." through a long
first Cloud sync. A pull costs the same per file whatever the vault size, and
that cost is almost all Capacitor bridge round trips, made one after another:
on the iOS Simulator about 14 per pulled file, and the time spent waiting on
them adds up to nearly the whole sync. So the lever for big first syncs is
calls per file.

## What changed

Four calls per pulled file were redundant. Each is gone only where it could
not have guarded a file.

| Call | Where | Why it cannot lose a file |
|---|---|---|
| `deleteFile(backup)` on every write | `NativeCloudSyncContent.write` | A backup exists only when an original was moved aside (`before`). A new file never makes one, so the delete always failed into its `.catch`. Replacing a file still deletes its backup. |
| `stat(temporary)` after publishing | same | A rename that resolved moved the temporary onto the path. Checked on the simulator: after a resolved `Filesystem.rename` the source is gone and the destination is there. Every path that did not publish still checks and removes the temporary. |
| `readdir(.zennotes/sync)` on every write | `assertReady` | Recovery files are now relisted only when one may have appeared: after a write that failed, after a backup that would not delete, and after any staged publish (which keeps its own backups). The first write, every scan and every staged download still list first. A completed write that removed its backup leaves nothing to find. |
| `mkdir(parent)` before every rename | `hostVault` in `mobile-cloud-sync.ts` | Each sync operation remembers the folders it has made. A rename into a folder that went missing fails before it changes anything (checked on the simulator: `OS-PLUG-FILE-0013`, the source stays, no folder is made), and the cache forgets that folder so the next rename makes it again. The next sync starts with an empty cache. |

Kept as they were: the pre-publish `stat(path)` (a new file must still be
absent), both verifies (the temporary before publishing, the path after),
the original's verify before it moves aside, and every rollback.

The fifth call the Android shell dropped, a `Filesystem.getUri` before every
`inspect`, is not here to drop: `NativeFs.readForSync` already builds a local
vault's file URIs from the root resolved at open. An iCloud vault still
materializes and stats each file before reading it, on purpose, so an
evicted `.icloud` stub is never fingerprinted in place of the note.

One stricter behavior: a staged publish (large or referenced files) whose
rollback copy would not delete now stops the next write in the same run
with "Cloud sync needs recovery". Before, the run went on and the next sync's
scan stopped at the same file, so the user lands in the same place one step
sooner, the same way an inline write's leftover backup already behaved.

### iCloud vaults

Not exercised: the scratch simulator had no iCloud account. An iCloud vault
writes through the same Capacitor `Filesystem` calls, with file URLs in the
ubiquity container instead of a Documents path, so the two rename facts above
hold there as well. Two things differ only there:

- `.zennotes/sync` sits inside the synced folder, so another device's leftover
  rollback file can arrive through iCloud during a run. Before, the next write
  would have stopped on it; now the next run's first write or scan does. That
  file records the other device's interrupted write, not one of this run's,
  so nothing this run does depends on seeing it sooner.
- A folder deleted by another device mid-run makes the next rename into it
  fail before it changes anything. That write rolls back like any failed
  write and the folder is made again on the next rename. Before, the `mkdir`
  in front of every rename would have put the folder back first.

## Results

iOS Simulator (iOS 26.5, iPhone 17 Pro, a scratch device made for this and
deleted afterwards), fake Cloud fixture on the Mac, small inline notes in four
folders, a local vault ("On this iPhone"). Fresh install each run (uninstall,
install, onboard, link), bridge calls counted by wrapping
`Capacitor.nativePromise`. Before and after apps were built from this
worktree, differing only in the two source files, and run alternately.

The Mac was busy with other work throughout (load average 57 to 116 on 16
cores), which moved single runs by up to 2x in either direction, so the table
gives medians over every run:

| Run | Before | After | Change |
|---|---|---|---|
| First sync, 600 notes (5 runs each) | 4.34 s, 138 notes/s | 3.49 s, 172 notes/s | 20% less time |
| First sync, 2,500 notes (3 runs each) | 17.24 s, 145 notes/s | 14.66 s, 171 notes/s | 15% less time |

All runs: 600 before 4.34, 6.51, 4.23, 4.20, 8.56 s and after 3.39, 3.49,
3.36, 8.13, 3.99 s; 2,500 before 17.01, 17.24, 17.92 s and after 14.66,
17.36, 14.36 s.

Bridge calls per pulled file, first sync of 600 (identical in every run):

| Call | Before | After |
|---|---|---|
| `Filesystem.stat` | 5.02 | 4.02 |
| `ZenDirectUpload.inspect` | 3.00 | 3.00 |
| `Filesystem.readdir` | 1.05 | 0.05 |
| `Filesystem.readFile` | 1.01 | 1.01 |
| `Filesystem.writeFile` | 1.00 | 1.00 |
| `Filesystem.mkdir` | 1.00 | 0.01 |
| `Filesystem.rename` | 1.00 | 1.00 |
| `Filesystem.deleteFile` | 1.00 | 0 |
| **Total** | **14.11** | **10.12** |

At 2,500 notes it went from 14.03 to 10.03. A call costs about 0.3 to 0.9 ms
on the simulator (`inspect` the most), cheaper than the Android emulator's
1 ms, so the share of time saved is the number to carry to a real phone, not
the seconds.

Same results: the vault's files hashed identically (SHA-256 of every file
outside `.zennotes`) between before and after for every pair: 602 files at
600 and 2,502 at 2,500. `.zennotes/sync` held nothing but an empty
`downloads` folder after every run. With the Welcome note served as a content
reference, resolving the first-sync conflict with Cloud's version (a staged
download and publish over an existing note) landed the other device's text,
left no conflict pending and no rollback file.

## What is left per file

About 10 calls: `stat` 4 (core's existence check, the write's own, the
pre-publish check, the post-sync scan's stability check), `inspect` 3 (both
verifies, and the scan reading the new file), and one each of `writeFile`,
`rename` and `readFile` (the app's rescan after sync). The core's check and
the write's own `stat` look alike but sit on either side of the core
boundary; merging them is a core API change.

## Tests

`npm test`: 295 pass (289 before, 6 new). `npm run typecheck` and
`npm run boundaries:check` clean.

- `cloud-sync-repository.test.ts`, "bridge calls per pulled file": the exact
  call list for a new file (one recovery listing, no backup delete, no
  temporary check); a replaced original is still verified, moved aside and its
  rollback copy deleted; a rollback copy that will not delete stops the next
  write; a failed write lists recovery files again; a staged publish that kept
  its rollback copy stops the next write.
- `mobile-cloud-sync.integration.test.ts`: each folder is made once per sync,
  and again on the next sync.

Against the old code, the call-count tests fail, as does the staged-publish
one (it pins the stricter behavior above); the other recovery tests pass on
both.

## How to test locally

1. `npm test`, `npm run typecheck` and `npm run boundaries:check` in this
   checkout.
2. Run a debug build on a simulator with a Cloud vault linked (for the fake
   Cloud, build with `VITE_ZENNOTES_CLOUD_DEV_URL=http://127.0.0.1:<port>`).
   Debug builds are inspectable: Safari, Develop, the simulator, ZenNotes.
   In the console, count calls during a sync:

   ```js
   const cap = window.Capacitor, stats = {}
   cap.__orig ??= cap.nativePromise
   cap.nativePromise = function (plugin, method, options) {
     const s = (stats[`${plugin}.${method}`] ??= { n: 0 })
     s.n++
     return cap.__orig.call(this, plugin, method, options)
   }
   const summary = await window.zen.syncCloudVault()
   Object.entries(stats).map(([k, v]) => `${k} ${(v.n / summary.pulled).toFixed(2)}`)
   ```

   A sync that pulls new notes should show no `deleteFile`, almost no `mkdir`
   or `readdir`, and about 10 calls per file in total.
3. Pull a note into a new folder, edit a pulled note on another device, then
   sync: both land. Resolve a conflict with Cloud's version. Afterwards
   `.zennotes/sync` holds nothing but an empty `downloads` folder.
