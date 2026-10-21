// The Game Master's lifecycles as one XState machine (asked 2026-10-21: "cần xstate nha vì có quản lý trạng thái, chuyển cảnh,
// combat, quest"; "dùng XState + LLM, bổ sung PDDL nếu cần NPC lập kế hoạch nhiều bước. XState không tự suy luận hay lập kế hoạch
// như PDDL"). Three parallel regions, each with its states and the only transitions allowed:
//   quest   none -> open (SEED) -> open (REVISE same hook, BEAT same step or the next) -> none (CLOSE "arc: done", SET_ASIDE a side)
//           A different arc while one is open, a beat with no arc, a beat that goes back or skips a step: no transition, refused
//           (applyGm keeps the previous value; gameMaster.ts).
//   scene   still | travel | rest: what the player's turn does (MOVE, REST, STAY); a natural pause is travel or rest.
//   combat  peace -> fight (ENGAGE) -> aftermath (DISENGAGE) -> peace (SETTLE); a fight can flare again from the aftermath.
// The machine only holds and checks state. It does not reason or plan: what happens is chosen by the solver (server/node/
// gmSolver.cjs, Datalog + ASP), an absent NPC's road by PDDL, and the narration by the model. The scene and combat states go to the
// solver as facts (no new event in the middle of a fight; an enemy in a fight opposes the player).
import { assign, initialTransition, setup, transition, type SnapshotFrom } from 'xstate'

export type GmEvent =
    | { type: 'SEED'; step: number | null }
    | { type: 'REVISE' }
    | { type: 'BEAT'; step: number | null }
    | { type: 'CLOSE' }
    | { type: 'SET_ASIDE' }
    | { type: 'MOVE' } | { type: 'REST' } | { type: 'STAY' }
    | { type: 'ENGAGE' } | { type: 'DISENGAGE' } | { type: 'SETTLE' }

export const gmMachine = setup({
    types: { context: {} as { step: number | null }, events: {} as GmEvent },
    guards: {
        // a beat keeps its step (a rewording) or moves one step on; a beat with no number is a rewording
        beatOk: ({ context, event }) => {
            if (event.type !== 'BEAT') return false
            if (event.step === null || context.step === null) return true
            return event.step === context.step || event.step === context.step + 1
        },
    },
    actions: {
        // the step a SEED or a numbered BEAT sets; CLOSE and SET_ASIDE clear it
        takeStep: assign({ step: ({ context, event }) => (event.type === 'BEAT' ? (event.step ?? context.step) : event.type === 'SEED' ? event.step : null) }),
    },
}).createMachine({
    id: 'gm',
    type: 'parallel',
    context: { step: null },
    states: {
        quest: {
            initial: 'none',
            states: {
                none: { on: { SEED: { target: 'open', actions: 'takeStep' } } },
                open: {
                    on: {
                        REVISE: { target: 'open' },
                        BEAT: { target: 'open', guard: 'beatOk', actions: 'takeStep' },
                        CLOSE: { target: 'none', actions: 'takeStep' },
                        SET_ASIDE: { target: 'none', actions: 'takeStep' },
                    },
                },
            },
        },
        scene: {
            initial: 'still',
            states: {
                still: { on: { MOVE: 'travel', REST: 'rest', STAY: 'still' } },
                travel: { on: { MOVE: 'travel', REST: 'rest', STAY: 'still' } },
                rest: { on: { MOVE: 'travel', REST: 'rest', STAY: 'still' } },
            },
        },
        combat: {
            initial: 'peace',
            states: {
                peace: { on: { ENGAGE: 'fight', SETTLE: 'peace' } },
                fight: { on: { ENGAGE: 'fight', DISENGAGE: 'aftermath' } },
                aftermath: { on: { ENGAGE: 'fight', SETTLE: 'peace', DISENGAGE: 'aftermath' } },
            },
        },
    },
})

export type GmSnapshot = SnapshotFrom<typeof gmMachine>
export type GmMode = { quest: 'none' | 'open'; scene: 'still' | 'travel' | 'rest'; combat: 'peace' | 'fight' | 'aftermath'; step: number | null }

/** A snapshot at a stored mode (the chat's variables keep the mode, not the snapshot). */
export function snapshotAt(mode: Partial<GmMode> = {}): GmSnapshot {
    const [init] = initialTransition(gmMachine)
    return gmMachine.resolveState({
        value: { quest: mode.quest ?? 'none', scene: mode.scene ?? 'still', combat: mode.combat ?? 'peace' },
        context: { ...init.context, step: mode.step ?? null },
    })
}

export function modeOf(s: GmSnapshot): GmMode {
    const v = s.value as { quest: GmMode['quest']; scene: GmMode['scene']; combat: GmMode['combat'] }
    return { quest: v.quest, scene: v.scene, combat: v.combat, step: s.context.step }
}

/** The snapshot after the event, or null when the machine has no such transition from here (an illegal one). */
export function step(s: GmSnapshot, event: GmEvent): GmSnapshot | null {
    if (!s.can(event)) return null
    return transition(gmMachine, s, event)[0]
}

// ---- the scene and the fight, turn by turn ---------------------------------------------------------------------------------------
// Kept on the chat as $gm_mode = {"at": replies when it was written, "mode": {scene, combat}, "prev": the mode before}: a reroll of
// the same reply starts again from "prev", as the pace clock does (gameMaster.ts markAdvance).
export type SceneMode = { scene: GmMode['scene']; combat: GmMode['combat'] }
const CALM: SceneMode = { scene: 'still', combat: 'peace' }

// whole words: \b is ASCII-only and never matches after a Vietnamese letter ("nghỉ", "đá")
const words = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu')
const REST = words('nghỉ|ngủ|chợp mắt|ngồi xuống|chờ|đợi|ăn|uống|dựng trại|rest|sleep|wait|camp|eat|drink')
const MOVE = words('đi|tới|đến|rời|chạy|leo|vượt|băng qua|lên đường|tiến về|quay về|walk|go|head|leave|travel|run|climb|cross')
const ATTACK = words('đánh|chém|đâm|bắn|tấn công|lao vào|đấm|đá vào|giết|ra tay|attack|strike|stab|shoot|fight|punch|kill')

const asMode = (m: unknown): SceneMode | null => {
    const x = m as SceneMode | null
    return x && ['still', 'travel', 'rest'].includes(x.scene) && ['peace', 'fight', 'aftermath'].includes(x.combat) ? { scene: x.scene, combat: x.combat } : null
}

/** The mode this request starts from (`n` = replies so far). */
export function modeBefore(vars: Record<string, unknown> | undefined, n: number): SceneMode {
    try {
        const j = JSON.parse(String(vars?.$gm_mode ?? '')) as { at: number; mode: unknown; prev: unknown }
        return (j.at >= n ? asMode(j.prev) : asMode(j.mode)) ?? { ...CALM }
    } catch {
        return { ...CALM }
    }
}

const apply = (m: SceneMode, events: GmEvent[]): SceneMode => {
    let s = snapshotAt({ scene: m.scene, combat: m.combat })
    for (const e of events) s = step(s, e) ?? s
    const v = modeOf(s)
    return { scene: v.scene, combat: v.combat }
}

/** What the player's own turn does to the scene and the fight, before the solver chooses (a fight is no natural pause). */
export function modeFromTurn(m: SceneMode, player: string): SceneMode {
    const t = player ?? ''
    const scene: GmEvent = REST.test(t) ? { type: 'REST' } : MOVE.test(t) ? { type: 'MOVE' } : { type: 'STAY' }
    return apply(m, [scene, ...(ATTACK.test(t) ? [{ type: 'ENGAGE' } as GmEvent] : [])])
}

/** The fight after the solver's choice: a hostile move in the scene starts one; with no hostile left in the scene it ends,
 *  and an aftermath settles the turn after. */
export function modeAfterDecision(m: SceneMode, d: { turn: string | null; hostile: string[]; present: string[]; onstage: string[] }): SceneMode {
    const hostileHere = d.hostile.some((h) => d.present.includes(h))
    const hostileActs = (d.turn === 'advance' || d.turn === 'escalate') && d.onstage.some((p) => d.hostile.includes(p))
    if (hostileActs) return apply(m, [{ type: 'ENGAGE' }])
    if (m.combat === 'fight' && !hostileHere) return apply(m, [{ type: 'DISENGAGE' }])
    if (m.combat === 'aftermath') return apply(m, [{ type: 'SETTLE' }])
    return m
}

/** $gm_mode after this request */
export function modeVar(vars: Record<string, unknown> | undefined, n: number, mode: SceneMode): string {
    return JSON.stringify({ at: n, mode, prev: modeBefore(vars, n) })
}
