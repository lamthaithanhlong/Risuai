---------------------------- MODULE VietjiBar ----------------------------
(* The learning bar while the learner types in Vietnamese (src/lib/ChatScreens/VietjiBar.svelte).
   The word list loads once; after a pause in typing the model is asked, unless the list is sure of the text.
   The effect that set the timer is cleaned up (timer cleared, `live` = false) whenever the text changes.

   Properties:
     NoWastedCall    - the model is never asked for a text the list is sure of
     NoDoubleRequest - never a second request for a text whose request is still out
     Answered        - (liveness) a text the list is not sure of, left alone, gets an answer
   The page shows an answer only when askedFor equals the text (askedFor === typedViet), so an answer that lands for an
   older text is never shown for the new one; that comparison is in the code, not a property here.

   Measured 2026-10-15 (TLC 2.19, Texts = {a, b}, Sure = {a}):
     FIXED = FALSE  NoWastedCall violated: "a" typed while the list loads; the 0.9 s timer fires before the list arrives
                    NoDoubleRequest violated: a, then b, then back to a while a's request is out: asked again
     FIXED = TRUE   no error (both safety properties and Answered) *)
EXTENDS Naturals, FiniteSets

CONSTANTS Texts, Sure,            \* Sure \subseteq Texts: texts the list fully knows
          FIXED                   \* FALSE = the code before this spec, TRUE = after

VARIABLES text,                   \* what is typed ("" = nothing)
          list,                   \* "loading" | "ready"
          timer,                  \* the text the pause timer is for, or "none"
          inflight,               \* texts whose request is out
          cache,                  \* texts with an answer stored (askCache)
          askedFor,               \* the text the shown answer is for, or "none"
          calls                   \* every request ever sent, as <<text, listWasReady, sure>>

vars == <<text, list, timer, inflight, cache, askedFor, calls>>

listSure(t) == list = "ready" /\ t \in Sure

\* what the effect does when it (re)runs for the current text
Effect(t) ==
    IF t = "" \/ listSure(t) THEN timer' = "none"
    ELSE IF t \in cache THEN timer' = "none"
    ELSE IF FIXED /\ (list # "ready" \/ t \in inflight) THEN timer' = "none"   \* wait for the list / for the request already out
    ELSE timer' = t

Init == text = "" /\ list = "loading" /\ timer = "none" /\ inflight = {} /\ cache = {} /\ askedFor = "none" /\ calls = {}

Type(t) ==                                    \* the text changes: cleanup (timer cleared), effect reruns
    /\ t # text
    /\ text' = t
    /\ Effect(t)
    /\ UNCHANGED <<list, inflight, cache, askedFor, calls>>

ListLoads ==
    /\ list = "loading"
    /\ list' = "ready"
    /\ LET sureNow == text \in Sure IN
       IF FIXED \/ sureNow THEN                 \* listSure / readiness is read by the effect: it reruns
           /\ timer' = IF text = "" \/ sureNow \/ text \in cache \/ text \in inflight THEN "none" ELSE text
       ELSE UNCHANGED timer                     \* before: nothing the effect read changed, the timer kept going
    /\ UNCHANGED <<text, inflight, cache, askedFor, calls>>

TimerFires ==
    /\ timer # "none" /\ timer = text
    /\ inflight' = inflight \cup {text}
    /\ calls' = calls \cup {<<text, list = "ready", text \in Sure>>}
    /\ timer' = "none"
    /\ UNCHANGED <<text, list, cache, askedFor>>

Answer(t) ==
    /\ t \in inflight
    /\ inflight' = inflight \ {t}
    /\ cache' = cache \cup {t}
    /\ askedFor' = IF t = text THEN t ELSE askedFor          \* `live`: only the effect that asked, still current, shows it
    /\ timer' = IF FIXED /\ t = text THEN "none" ELSE timer
    /\ UNCHANGED <<text, list, calls>>

\* a cached answer for the current text is shown when the effect reruns (askCache hit)
ShowCached ==
    /\ text \in cache /\ askedFor # text
    /\ askedFor' = text
    /\ UNCHANGED <<text, list, timer, inflight, cache, calls>>

Next == \/ \E t \in Texts \cup {""} : Type(t)
        \/ ListLoads \/ TimerFires \/ \E t \in Texts : Answer(t) \/ ShowCached

Spec == Init /\ [][Next]_vars /\ WF_vars(TimerFires) /\ WF_vars(ListLoads) /\ \A t \in Texts : WF_vars(Answer(t)) /\ WF_vars(ShowCached)

NoWastedCall == \A c \in calls : ~c[3]          \* not even while the list is still loading
NoDoubleRequest == [][\A t \in Texts : (TimerFires /\ text = t) => t \notin inflight]_vars
Answered == \A t \in Texts \ Sure : [](text = t => <>(text # t \/ askedFor = t))
=============================================================================
