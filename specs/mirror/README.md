# Cloud mirror specs

`server/node/cloudMirror.cjs` pushes assets, then `database.bin`, to the Risu account. Invariant: the database in the account never
points at an asset the account lacks.

| File | Tool | Result |
| --- | --- | --- |
| `MirrorRace.tla` + `MirrorRace_FALSE.cfg` / `_TRUE.cfg` | TLC | Checking "every asset is in the account" BEFORE reading the database is violated in an 8-state trace (a chat adds an asset and saves between the check and the read). Checking AFTER the read holds (270 states). The code does the second. |
| `MirrorRename.als` | Alloy 6 | The unchanged database is safe iff no referenced file was renamed by the hub; one rename breaks it. The guard is conservative: a rename of an unreferenced file is withheld too (the script cannot tell which are referenced). |
| `IsCompleteSave.dfy` | Dafny (Z3) | `isCompleteSave` never reads out of range, terminates, and answers true exactly when the blocks tile the file. 4 verified, 0 errors. |

Run: `java -cp tla2tools.jar tlc2.TLC -metadir /tmp/x -config MirrorRace_FALSE.cfg MirrorRace.tla` (expect a violation) and
`..._TRUE.cfg` (expect none); `java -jar alloy.jar exec -f -o /tmp/out MirrorRename.als`; `dafny verify IsCompleteSave.dfy`.
The test `src/ts/network/cloudMirror.test.ts` "the race TLC found" drives the TLC trace through a test seam; with the old order it fails.
