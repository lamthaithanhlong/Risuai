----------------------------- MODULE InlaySync -----------------------------
\* Chat pictures across two browsers (Mac, Phone) and the Risu server (files/inlaySync.ts).
\* REMOTE = FALSE is the old build (pictures only in the drawing browser's IndexedDB).
EXTENDS Naturals, FiniteSets
CONSTANTS Devices, Pics, REMOTE, RETRY
VARIABLES local, synced, server, drawnBy, cleared, shownMissing

vars == <<local, synced, server, drawnBy, cleared, shownMissing>>

Init == /\ local = [d \in Devices |-> {}] /\ synced = [d \in Devices |-> {}] /\ server = {}
        /\ drawnBy = [p \in Pics |-> "none"] /\ cleared = {} /\ shownMissing = {}

\* a device draws a new picture: stored locally, then uploaded right away (the upload may fail)
Draw(d, p, ok) == /\ drawnBy[p] = "none"
                  /\ drawnBy' = [drawnBy EXCEPT ![p] = d]
                  /\ local' = [local EXCEPT ![d] = @ \cup {p}]
                  /\ IF REMOTE /\ ok THEN /\ server' = server \cup {p} /\ synced' = [synced EXCEPT ![d] = @ \cup {p}]
                                      ELSE UNCHANGED <<server, synced>>
                  /\ UNCHANGED <<cleared, shownMissing>>

\* the app starts on a device: every unsynced local picture is uploaded (each may fail)
Start(d) == /\ REMOTE
            /\ \E up \in SUBSET (local[d] \ synced[d]) :
                 /\ server' = server \cup up /\ synced' = [synced EXCEPT ![d] = @ \cup up]
            /\ UNCHANGED <<local, drawnBy, cleared, shownMissing>>

\* RETRY: while the app stays open, a timer tries the unsynced pictures again (each try may fail again)
Retry(d) == /\ REMOTE /\ RETRY
            /\ \E up \in SUBSET (local[d] \ synced[d]) :
                 /\ server' = server \cup up /\ synced' = [synced EXCEPT ![d] = @ \cup up]
            /\ UNCHANGED <<local, drawnBy, cleared, shownMissing>>
\* a retry that gets through: the network comes back at some point
RetryOk(d) == /\ REMOTE /\ RETRY /\ local[d] \ synced[d] # {}
              /\ server' = server \cup local[d] /\ synced' = [synced EXCEPT ![d] = @ \cup local[d]]
              /\ UNCHANGED <<local, drawnBy, cleared, shownMissing>>

\* a device shows a picture: browser copy, else the server file (cached), else the raw tag
Read(d, p) == /\ drawnBy[p] # "none"
              /\ IF p \in local[d] THEN UNCHANGED <<local, synced, shownMissing>>
                 ELSE IF REMOTE /\ p \in server
                      THEN /\ local' = [local EXCEPT ![d] = @ \cup {p}] /\ synced' = [synced EXCEPT ![d] = @ \cup {p}]
                           /\ UNCHANGED shownMissing
                      ELSE /\ shownMissing' = shownMissing \cup {<<d, p>>} /\ UNCHANGED <<local, synced>>
              /\ UNCHANGED <<server, drawnBy, cleared>>

\* the user clears a browser's site data
Clear(d) == /\ local' = [local EXCEPT ![d] = {}] /\ synced' = [synced EXCEPT ![d] = {}]
            /\ cleared' = cleared \cup {d}
            /\ UNCHANGED <<server, drawnBy, shownMissing>>

Next == \/ \E d \in Devices, p \in Pics, ok \in BOOLEAN : Draw(d, p, ok)
        \/ \E d \in Devices : Start(d) \/ Clear(d) \/ Retry(d) \/ RetryOk(d)
        \/ \E d \in Devices, p \in Pics : Read(d, p)

\* "synced" is never claimed for a picture the server does not have
SyncedMeansOnServer == \A d \in Devices : synced[d] \subseteq server
\* a picture is only ever missing on a device when it is on no server and in no browser that could still send it:
\* i.e. the device that drew it never got it up (upload failed and it has not started since) or its data was cleared
MissingOnlyIfNotYetUp == \A <<d, p>> \in shownMissing :
        p \notin server
\* the phone never shows a raw tag for a picture the server already had
NoRawTagWhenOnServer == \A <<d, p>> \in shownMissing : p \notin server
\* a picture is lost (nowhere at all) only after the drawing browser was cleared before it got up
LostOnlyAfterClear == \A p \in Pics : (drawnBy[p] # "none" /\ p \notin server /\ \A d \in Devices : p \notin local[d]) => drawnBy[p] \in cleared
\* the old build's promise to the phone: every picture drawn anywhere can be shown on every device
EveryDeviceCanShow == \A d \in Devices, p \in Pics : drawnBy[p] # "none" /\ drawnBy[p] # d /\ p \notin server => FALSE
\* the user may never restart the app or clear it: only the timer is fair, and the network is eventually up
Spec == Init /\ [][Next]_vars /\ \A d \in Devices : SF_vars(RetryOk(d))
\* every picture drawn reaches the server, unless the browser that drew it was cleared first
ReachesServer == \A p \in Pics : (drawnBy[p] # "none") ~> (p \in server \/ drawnBy[p] \in cleared)
=============================================================================
