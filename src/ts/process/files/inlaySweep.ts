// Removes chat pictures nothing uses any more (owner's choice: orphan pictures only, never a chat): pictures of deleted chats
// and pictures replaced by a redraw, on the server (inlays/<id>) and in this browser's cache.
//
// Safety, in order:
// - only ids shaped like a generated picture's (a uuid); a character image stored the same way under another name is never touched
// - "used" means the id appears anywhere in the database, the chats moved to cold storage included (the caller gives that text)
// - two strikes (specs/core/AssetSweep.tla, assetSweep.ts): a start that finds an orphan only remembers it; a later start removes
//   it only if it is still an orphan and has been for at least the grace time. A page that has just drawn a picture and not
//   yet saved the message that uses it is thereby safe.

import { planSweep, SWEEP_GRACE_MS, type SweepSeen } from '../../storage/assetSweep'

export const INLAY_SWEEP_SEEN_KEY = 'inlaySweepSeen'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every uuid-shaped string in the given texts (the database, character by character). */
export function referencedIds(texts: Iterable<string>): Set<string> {
    const out = new Set<string>()
    for (const t of texts) for (const m of (t ?? '').matchAll(UUID)) out.add(m[0].toLowerCase())
    return out
}

/** The picture ids no text uses: uuid-shaped candidates only, everything else is kept. */
export function orphans(candidates: Iterable<string>, used: Set<string>): string[] {
    const out = new Set<string>()
    for (const id of candidates) if (IS_UUID.test(id) && !used.has(id.toLowerCase())) out.add(id)
    return [...out]
}

export function loadSeen(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SweepSeen {
    try { const v = JSON.parse(storage?.getItem(INLAY_SWEEP_SEEN_KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}
export function saveSeen(seen: SweepSeen, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
    try { storage?.setItem(INLAY_SWEEP_SEEN_KEY, JSON.stringify(seen)) } catch { /* the next start begins the wait again */ }
}

export interface SweepDeps {
    /** the whole database as text, one piece per character (cold storage loaded) plus the rest */
    referenceTexts(): Promise<string[]>
    serverIds(): Promise<string[]>
    localIds(): Promise<string[]>
    removeServer(id: string): Promise<void>
    removeLocal(id: string): Promise<void>
    seen: { load(): SweepSeen; save(s: SweepSeen): void }
    now(): number
    log?: (m: string) => void
}

/** One sweep at start: remembers new orphans, removes the ones orphaned for long enough. Returns what it removed and is waiting on. */
export async function sweepInlays(deps: SweepDeps, graceMs = SWEEP_GRACE_MS) {
    const used = referencedIds(await deps.referenceTexts())
    const server = new Set(await deps.serverIds())
    const local = new Set(await deps.localIds())
    const plan = planSweep(orphans([...server, ...local], used), deps.seen.load(), deps.now(), graceMs)
    deps.seen.save(plan.seen)
    for (const id of plan.remove) {
        if (server.has(id)) await deps.removeServer(id)
        if (local.has(id)) await deps.removeLocal(id)
    }
    if (plan.remove.length || Object.keys(plan.seen).length) {
        deps.log?.(`[inlay] removed ${plan.remove.length} unused picture(s); ${Object.keys(plan.seen).length} more unused, removed at a later start if still unused`)
    }
    return { removed: plan.remove, waiting: Object.keys(plan.seen) }
}
