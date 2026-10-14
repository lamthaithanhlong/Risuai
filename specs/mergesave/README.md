# Two pages, one save: merge instead of overwrite

Every page loads the whole save and writes the whole file back, so a page that never touched the lorebook still wrote its old copy of it.
In one day this erased the lorebook update twice (305 entries again), Max Response (4096 -> 1000 -> 4096 -> 1000) and parts of a chat.
The server now knows which version of `database.bin` each page loaded (the hash of the browser's public key identifies the page) and merges
each write against it: a part the page did not change follows the server, a part it changed takes the page's value, a part deleted on one
side stays deleted only if the other side did not change it. Parts are: blocks, the top-level keys of a block, and the elements of a list of
objects with an id (a character's chats, the modules); `__directory` is a list of names and is merged as a set and repaired to match the blocks.

| File | Tool | Result |
| --- | --- | --- |
| `MergeSave.tla` | TLC, `Policy = "LWW"` | `TouchNothing` is violated within 101 states: a page that changed nothing still overwrites what the server has (today's behaviour). |
| `MergeSave.tla` | TLC, `Policy = "Merge"` | 1 796 445 states generated, 576 940 distinct, no error: a write never changes a key the writer did not change (`NoStaleOverwrite`), takes the writer's value for a key it changed (`ChangedKeysWin`), a page that changed nothing writes nothing (`TouchNothing`), and when nobody else wrote the result is the page's own copy (`FastPath`). Two pages, two keys, four edits. |
| `Merge3.dfy` | Dafny | 17 verified, on one level of keys: an untouched key follows the server, a changed or added key takes the page, nobody else wrote gives exactly the page's file, a page that changed nothing gives exactly the server's, the same write twice changes nothing the second time, no value is invented, deletions respect the other side's edits. Five deliberate breaks (last writer wins, server always wins, two deletion rules) are each rejected. |

Code: `server/node/dbMerge.cjs` (the merge), `server/node/dbSync.cjs` (the page bookkeeping in SQLite: revisions, a manifest of hashes per revision,
the base of each page), wired in `server.cjs` (`RISU_DB_MERGE=0` turns it off). Tests: `src/ts/storage/dbMerge.test.ts` (21 merge cases incl. the
incident, a property test against the per-key rule, 6 bookkeeping cases, 15 deliberate breaks caught) and `dbMergeServer.test.ts` (the real
server, two pages with two signing keys over HTTP, a restart; it fails with `RISU_DB_MERGE=0`).

Limits, on purpose:
* A page's base stays the revision it loaded, also after its own writes (its memory is that revision plus its own edits), so what differs from
  the base is exactly what it changed. The first write of a page the server did not see load (a page open before this was switched on) is
  stored as it is, as before; from then on it is merged.
* The page's screen is not refreshed: a stale page still shows, and generates with, its own copy until it reloads. It is told once, by a toast,
  when a write of its was merged.
* Both pages changing the same key: the writing page wins. Both changing the same chat: the writing page's chat wins.
* Characters stored as separate `remotes/...` files, and assets, are not merged (assets are named by their hash and never conflict).
* A merged write keeps a safety copy of what the server had and what the page wrote (`database/premerge-*`), at most one pair per ten minutes.
