// The hub may answer a write with a different key than the one sent (the client then rewrites the database; the mirror does not).
// Question: when is the account's database, sent unchanged, free of dangling references?
sig Key {}
one sig Local { files: set Key, refs: set Key }      // server: asset files and what database.bin points at
fact { Local.refs in Local.files }
one sig Cloud { rename: Key -> lone Key }             // what the hub stored each uploaded file under
fact { Cloud.rename in Local.files -> Key }
fun stored: set Key { Local.files.(Cloud.rename) }    // keys that exist in the account

pred noRename { all k: Local.files | Cloud.rename[k] = k }
pred anyRename { some k: Local.files | Cloud.rename[k] != k }
pred allUploaded { all k: Local.files | one Cloud.rename[k] }

// with every file uploaded under its own name the unchanged database has no dangling reference
assert SafeWithoutRename { (allUploaded and noRename) implies Local.refs in stored }
check SafeWithoutRename for 5

// ... and a single rename of a referenced file breaks it (so the guard is needed, not decoration)
assert SafeEvenWithRename { (allUploaded and anyRename) implies Local.refs in stored }
check SafeEvenWithRename for 5

// is the guard too strict? a rename of an UNREFERENCED file does not break the database, but the mirror still withholds it
run RenameOfUnreferencedIsHarmless { allUploaded and anyRename and Local.refs in stored } for 5
