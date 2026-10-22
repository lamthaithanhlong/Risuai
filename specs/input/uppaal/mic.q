// dictated words land only in the chat they were spoken for
A[] not leak
// a retried or resumed reply never wipes unsent words
A[] not lost
// the mic is back from "transcribing" (the button is disabled meanwhile) within the page's limit. With the invariants on Wait and
// Dropped and no deadlock this is the bounded form of mic.Wait --> mic.Idle (the leads-to itself did not finish in 5 minutes here)
A[] ((mic.Wait || mic.Dropped) imply x <= STT_LIMIT)
A[] not deadlock
// the owner's case is reachable: words that come back after a switch while a reply generates
E<> (late && genOn)
