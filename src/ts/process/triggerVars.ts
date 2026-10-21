// A trigger runs on a copy of the chat (triggers.ts runTrigger: safeStructuredClone) and used to hand the copy's whole scriptstate back to
// the live chat when it ended, so whatever another writer put in the live chat meanwhile was gone. Measured 2026-10-21 (acceptance ss,
// cb0dd7bc): the bookkeeper wrote 9 social lines in 6 of 17 calls and $led_soc stayed empty, because the card's triggers, running while
// the helper answered, wrote their copy (taken before it) back over the chat. Only the keys the trigger itself set go back now.

type WithState = { scriptstate?: Record<string, string | number | boolean> } | null | undefined

/** The trigger's own writes (`keys`, '$'-prefixed as in scriptstate) from `from` into each live chat; other keys stay as they are. */
export function writeTriggerVars(targets: WithState[], from: Record<string, string | number | boolean> | undefined, keys: Iterable<string>): void {
    const ks = [...keys]
    if (!from || !ks.length) return
    for (const t of new Set(targets.filter((x): x is NonNullable<WithState> => !!x))) {
        if (t.scriptstate === from) continue
        t.scriptstate ??= {}
        for (const k of ks) if (k in from) t.scriptstate[k] = from[k]
    }
}
