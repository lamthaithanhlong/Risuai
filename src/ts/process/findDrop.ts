// Finds: a skill or an item the character stumbles on by chance while the story runs (spec: finds-spec.md).
// The app decides WHEN (deterministic, seeded, capped), the narrator decides WHAT and weaves it into the prose, and writes one hidden line
//   [[FIND|skill|Tên VI|Name EN|effect|rarity|conditions|portable]]
// at the end of the reply. That line is taken out of the stored and the streamed text, parsed into a record, and the turn is kept on
// the chat ($find_turn) so the cap counts only replies that actually carried a block. Saving the record is the bridge's job
// (setFindParsedHandler); with no handler a find is only parsed and shown.

import type { Chat, character, groupChat } from '../storage/database.svelte'
import { gmRequest, hasCreationStep, yesAt } from './gameMaster'
import { similar } from './findSimilar.mjs'
import { isAskAnswer, lastTurnIsAsk } from './adminAsk'

// ---- the drop schedule --------------------------------------------------------------------------------------------------------

/** never in the first story turns after the character is locked */
export const FIND_FIRST_TURN = 4
/** at most one find event in any window of this many story turns (owner 2026-11-05: an event every 6..10 turns: gap 6, certain by 10) */
export const FIND_MIN_GAP = 6
/** by this many turns since the last find (or the start) one is certain, in any scene that can carry it */
export const FIND_DROUGHT = 10
const BASE_CHANCE = 0.25

export type SceneKind = 'creation' | 'combat' | 'death' | 'quiet' | 'explore' | 'scavenge' | 'travel' | 'rest' | 'social' | 'other'
export type FindKind = 'skill' | 'item'
export type FindRarity = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'
export const TIERS: FindRarity[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond']
/** The words before 2026-11-06: an old reply or an old stored find still parses (the tier it maps to). */
export const LEGACY_RARITY: Record<string, FindRarity> = { common: 'bronze', uncommon: 'silver', rare: 'gold', epic: 'platinum' }
export type FindDue = { due: boolean; kind: FindKind; rarity: FindRarity; note: string }

/** A scene that cannot carry a find. */
const BARRED: SceneKind[] = ['creation', 'combat', 'death']
/** How much a scene favours a find (quiet / exploring / scavenging weigh more than the rest). */
const WEIGHT: Record<SceneKind, number> = { creation: 0, combat: 0, death: 0, scavenge: 1.4, explore: 1.3, quiet: 1.2, rest: 1, travel: 0.9, social: 0.8, other: 0.8 }

/** A seeded number in [0, 1): the same (seed, turn, salt) always gives the same one (cyrb53-style mixing). */
export function seededUnit(seed: string | number, turn: number, salt = ''): number {
    const s = `${seed}|${turn}|${salt}`
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        h1 = Math.imul(h1 ^ c, 2654435761)
        h2 = Math.imul(h2 ^ c, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return ((h2 & 0x1fffff) * 4294967296 + (h1 >>> 0)) / 9007199254740992
}

/** The chance on an eligible turn, `since` turns after the last find: 25% at the cap, rising to certain by FIND_DROUGHT. */
export function findChance(since: number, scene: SceneKind): number {
    if (since >= FIND_DROUGHT) return 1
    const ramp = since <= FIND_MIN_GAP ? BASE_CHANCE : BASE_CHANCE + (1 - BASE_CHANCE) * ((since - FIND_MIN_GAP) / (FIND_DROUGHT - FIND_MIN_GAP))
    return Math.min(1, ramp * WEIGHT[scene])
}

// ---- rank and the loot table (owner 2026-11-06; the twin of fate-simulator/stats.lua S.rank / S.loot_table / S.loot_pick, proved in tools/stats/formal/Loot.dfy) ----
export const RANK_MAX = 10
export const RANK_STEP = 10
const LOOT_BASE = [50, 28, 14, 6, 2]
const LOOT_CUM = [0, 4, 7, 9, 10]

/** rank = min(10, 1 + floor((Level - 1) / 10)); Level below 1 or not a number = 1. */
export function rankOfLevel(level: unknown): number {
    const l = Math.max(1, Math.floor(Number(level)) || 1)
    return Math.min(RANK_MAX, 1 + Math.floor((l - 1) / RANK_STEP))
}

/** The Level in the chat's `$lvl` ({"l":n,"e":n}); missing or broken = 1. */
export function levelOf(vars: Record<string, unknown> | undefined): number {
    try {
        const v = vars?.$lvl
        const o = typeof v === 'string' ? JSON.parse(v) : v
        return Math.max(1, Math.floor(Number((o as { l?: unknown })?.l)) || 1)
    } catch { return 1 }
}

/** The five loot percentages at a rank (bronze..diamond, integers summing to 100). */
export function lootTable(rank: number): number[] {
    const r = Math.max(1, Math.min(RANK_MAX, Math.floor(Number(rank)) || 1))
    const moved = 2 * (r - 1)
    return [LOOT_BASE[0] - moved, ...[1, 2, 3, 4].map((k) => LOOT_BASE[k] + Math.floor(moved * LOOT_CUM[k] / 10) - Math.floor(moved * LOOT_CUM[k - 1] / 10))]
}

/** The tier a roll (0..99) lands on at a rank: the roll walks the cumulative table. */
export function lootPick(roll: number, rank: number): FindRarity {
    const n = Math.max(0, Math.min(99, Math.floor(Number(roll)) || 0))
    let acc = 0
    const t = lootTable(rank)
    for (let i = 0; i < 5; i++) { acc += t[i]; if (n < acc) return TIERS[i] }
    return TIERS[4]
}

export type FindInput = {
    /** the story turn of the reply about to be written (1 = the Initialization reply after the yes) */
    turn: number
    /** the story turn of the last reply that carried a find block; null/undefined = none yet */
    lastFindTurn?: number | null
    sceneKind: SceneKind
    seed: string | number
    /** names already saved, Vietnamese and English: the narrator must not repeat any */
    known?: string[]
    /** the character's rank (1..10, from its Level); missing = 1 */
    rank?: number
}

/** Whether a find is due on this turn, and what to ask the narrator for. Pure: the same input is always the same answer. */
export function findDue(input: FindInput): FindDue {
    const { turn, sceneKind, seed } = input
    const none: FindDue = { due: false, kind: 'item', rarity: 'bronze', note: '' }
    if (!Number.isFinite(turn) || turn < FIND_FIRST_TURN || BARRED.includes(sceneKind)) return none
    const last = input.lastFindTurn ?? null
    if (last !== null && turn - last < FIND_MIN_GAP) return none
    const since = turn - (last ?? 0)
    if (seededUnit(seed, turn, 'drop') >= findChance(since, sceneKind)) return none
    const kind: FindKind = seededUnit(seed, turn, 'kind') < (sceneKind === 'scavenge' ? 0.7 : 0.4) ? 'item' : 'skill'
    const rarity = lootPick(Math.floor(seededUnit(seed, turn, 'rarity') * 100), input.rank ?? 1)
    return { due: true, kind, rarity, note: findNote(kind, rarity, input.known ?? []) }
}

// ---- the dice: a find is an EVENT that can fail (owner 2026-11-05) -----------------------------------------------------------------
// When a find is due, a d20 seeded by (chat, turn) is rolled (a regenerated reply gets the same roll) and the tier of the related stat is added:
// a skill uses the stat of the act the character just did ($act_stat, written by the card's stats script), else Tinh thần; an item uses Cảm nhận.
// Against the DC of its rarity: pass = the narrator is asked for the [[FIND|..]] line as before; fail = the narrator is told it missed and why
// it should read as scene detail, and writes NO line. A FIND line in a reply whose turn had no pass is dropped, never stored (NoFreeGrant).
export const FIND_DC: Record<FindRarity, number> = { bronze: 8, silver: 11, gold: 14, platinum: 17, diamond: 20 }
const STAT_NAMES: Record<string, string> = { suc_manh: 'Sức mạnh', nhanh_nhen: 'Nhanh nhẹn', the_luc: 'Thể lực', tinh_than: 'Tinh thần', cam_nhan: 'Cảm nhận', y_chi: 'Ý chí' }
export type FindRoll = { turn: number; len?: number; d20: number; bonus: number; dc: number; ok: boolean; kind: FindKind; rarity: FindRarity; stat: string }

/** The tier of a stat in the chat's `$stats` (hundredths; every 3.00 above the start 10.00 is one tier). */
export function statTier(vars: Record<string, unknown> | undefined, stat: string): number {
    try {
        const v = Number(JSON.parse(String(vars?.$stats ?? '{}'))?.[stat])
        return Number.isFinite(v) && v > 1000 ? Math.floor((v - 1000) / 300) : 0
    } catch { return 0 }
}

/** Pure: the same (seed, turn, kind, rarity, vars) is always the same roll. */
export function findRoll(due: { kind: FindKind; rarity: FindRarity }, turn: number, seed: string | number, vars: Record<string, unknown> | undefined): FindRoll {
    const act = String(vars?.$act_stat ?? '')
    const stat = due.kind === 'item' ? 'cam_nhan' : (act in STAT_NAMES ? act : 'tinh_than')
    const d20 = 1 + Math.floor(seededUnit(seed, turn, 'd20') * 20)
    const bonus = statTier(vars, stat)
    const dc = FIND_DC[due.rarity]
    return { turn, d20, bonus, dc, ok: d20 + bonus >= dc, kind: due.kind, rarity: due.rarity, stat }
}

/** The hidden note when the roll failed: nothing is gained, and the narrator says why in the scene's own terms. */
export function findFailNote(kind: FindKind): string {
    return `\n\n[Find (hidden, never named): the chance of a ${kind} came up in this scene and the character did not get it this time. In prose, inside the scene's own events, show why it slipped away (it was missed, it broke, it was not understood, someone else took it), a detail of the scene and not an announcement. Do NOT write a [[FIND|..]] line, give no skill and no item, and do not mention this note.]`
}

/** The panel line for a roll: "🎲 d20 14+1 vs 12: OK" (the find's name is added once it is saved), or "… hụt". */
export function findDiceLine(r: FindRoll): string {
    return `🎲 d20 ${r.d20}${r.bonus ? `+${r.bonus}` : ''} vs ${r.dc}: ${r.ok ? 'OK' : 'hụt'}`
}

const parseRoll = (raw: unknown): FindRoll | null => {
    try { const r = JSON.parse(String(raw ?? '')); return r && typeof r === 'object' && Number.isFinite(r.turn) ? r as FindRoll : null } catch { return null }
}

const KNOWN_MAX = 80

/** The hidden note for the request (like PLAN_STORY): a find is due, how to weave it, what it must not repeat. */
export function findNote(kind: FindKind, rarity: FindRarity, known: string[]): string {
    const names = [...new Set(known.map((k) => k.trim()).filter(Boolean))].slice(-KNOWN_MAX)
    return `\n\n[Find (hidden, never named): a ${rarity} ${kind} is due in this reply. Let the character stumble on or realise it by chance, inside the scene's own events and in prose, never as a popup, a menu, a system line or "Bạn nhận được", and name it naturally in the narration. It must be a new one${names.length ? `, none of these and nothing close to them (the same kind of thing under another name counts as the same): ${names.join('; ')}` : ''}. `
        + `The find is not complete without its line: the reply MUST end with exactly one line "[[FIND|${kind}|Tên VI|Name EN|effect in this world's terms with its limit or cost|${rarity}|when it works and what it costs|yes or no (usable outside this world)]]" `
        + `after the Future Plan line and before any STATUS, LEDGER or GM block; no pipe inside a field. A STATUS item or skill line or a GM line does NOT replace it: if the reply gives the character something found, learned or realised, that line is required. `
        + `Only if this scene truly cannot carry a find (a fight, a loss, a creation reply) write nothing.]`
}

// ---- the hidden block ----------------------------------------------------------------------------------------------------------

export type FindRecord = {
    id: string
    kind: FindKind
    name: { vi: string; en: string }
    source: { card: string; chapter: string }
    effect: string
    rarity: FindRarity
    conditions: string
    portable: boolean
}

const BLOCK = /\[\[FIND\b([^\]]*)\]\]/
const BLOCK_ALL = /[ \t]*\[\[FIND\b[^\]]*\]\][ \t]*\n?/g
// a block still being streamed ("[[FIND|skill|Tên"), or only the first characters of its opening; the stream can also stop between its
// two closing brackets ("…|yes]"), and that frame showed the whole line (release-2 test, 2026-11-05)
const OPEN_TAIL = /[ \t]*\[\[FIND\b[^\]]*\]?$/
const PREFIX_TAIL = /[ \t]*\[\[(?:F|FI|FIN)?$/

/** The reply with every find block taken out, and one still being streamed hidden (for the screen and for the stored text). */
export function stripFind(text: string): string {
    const t = text ?? ''
    if (!t.includes('[[F') && !/\[\[?$/.test(t)) return t
    return t.replace(BLOCK_ALL, '').replace(OPEN_TAIL, '').replace(PREFIX_TAIL, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
}

const KINDS: FindKind[] = ['skill', 'item']
const NAME_MAX = 60
const EFFECT_MAX = 400

/** id: lowercase a-z0-9 and dashes from the English name. */
export function findId(nameEn: string): string {
    return (nameEn ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with'])

/** The asset manager's dedupe key: lowercase, no accents or punctuation or stopwords, tokens sorted. */
export function findFingerprint(nameEn: string): string {
    const tokens = (nameEn ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t))
    return [...new Set(tokens)].sort().join(' ')
}

/**
 * The first find block of a reply as a record, or null: no block, a bad one (wrong number of fields, a kind or rarity outside the
 * lists, a name over 60 characters, an effect empty or over 400, a portable that is not yes/no), never a guess. Only the first
 * block counts. `ctx` is the source the page knows (the card and the story place).
 */
export function parseFind(text: string, ctx: { card?: string; chapter?: string } = {}): FindRecord | null {
    const m = BLOCK.exec(text ?? '')
    if (!m) return null
    const body = m[1]
    if (!body.startsWith('|')) return null
    const f = body.slice(1).split('|').map((x) => x.replace(/\s+/g, ' ').trim())
    if (f.length !== 7) return null
    const [kindRaw, vi, en, effect, rarityRaw, conditions, portableRaw] = f
    const kind = kindRaw.toLowerCase() as FindKind
    const rarityWord = rarityRaw.toLowerCase()
    const rarity = (LEGACY_RARITY[rarityWord] ?? rarityWord) as FindRarity
    const portable = /^(yes|true|có)$/i.test(portableRaw) ? true : /^(no|false|không)$/i.test(portableRaw) ? false : null
    if (!KINDS.includes(kind) || !TIERS.includes(rarity) || portable === null) return null
    if (!vi || !en || vi.length > NAME_MAX || en.length > NAME_MAX) return null
    if (!effect || effect.length > EFFECT_MAX || !conditions || conditions.length > EFFECT_MAX) return null
    const id = findId(en)
    if (!id) return null
    return { id, kind, name: { vi, en }, source: { card: ctx.card ?? '', chapter: ctx.chapter ?? '' }, effect, rarity, conditions, portable }
}

// ---- the injectable hooks (the bridge connects them) ---------------------------------------------------------------------------

export type FindContext = { chatId: string; card: string; turn: number }
type FindHandler = (record: FindRecord, ctx: FindContext) => void
type KnownProvider = () => string[]

let handler: FindHandler = () => {}
let knownProvider: KnownProvider = () => []

/** Called with each new find a reply carried (default: nothing). The save to the asset manager hangs here. */
export function onFindParsed(record: FindRecord, ctx: FindContext): void {
    try { handler(record, ctx) } catch (e) { console.warn('[finds] handler failed', e instanceof Error ? e.message : String(e)) }
}
export function setFindParsedHandler(fn: FindHandler | null): void { handler = fn ?? (() => {}) }
/** Names already in the global store (Vietnamese and English), added to the chat's own for the "not these" list. */
export function setFindKnownProvider(fn: KnownProvider | null): void { knownProvider = fn ?? (() => []) }

// ---- the chat's side -----------------------------------------------------------------------------------------------------------

type Room = character | groupChat
type Msg = { role: string; data?: string; chatId?: string }

/** The card teaches the block (its description has the rule), so only such a card is asked for finds. */
export function hasFindRule(card: Room | undefined): boolean {
    if (!card || card.type === 'group') return false
    // the card teaches the block itself, or Admin (global, on for this card) does: finds are Admin's events in every story (owner 2026-11-05)
    return /\[\[FIND\|/.test((card as character).desc ?? '') || adminProbe(card)
}

// Whether Admin is on for a card, asked through a probe adminGlobal.ts registers when it loads (this file stays light: the Lua tests bundle it alone)
let adminProbe: (card: Room) => boolean = () => false
export function setAdminActiveProbe(fn: ((card: Room) => boolean) | null): void { adminProbe = fn ?? (() => false) }

/** The number of story replies since the character was locked (all replies on a card with no creation step), `Initialization` included. */
export function storyTurns(card: Room | undefined, messages: Msg[]): number {
    const yes = yesAt(messages as never)
    const creation = hasCreationStep(card as never)
    if (creation && yes < 0) return 0
    // an answer to "@admin ..." is not a story turn (adminAsk.ts)
    return messages.reduce((n, m, i) => (i > yes && m.role === 'char' && !isAskAnswer(messages as never, i) ? n + 1 : n), 0)
}

const SCAVENGE = /(?<![\p{L}\p{N}])(lục|lục soát|lục lọi|tìm kiếm|tìm đồ|nhặt|thu gom|kiếm đồ|scavenge|search|loot|rummage)(?![\p{L}\p{N}])/iu
const EXPLORE = /(?<![\p{L}\p{N}])(khám phá|quan sát|xem xét|thăm dò|nhìn quanh|kiểm tra|explore|look around|inspect|examine)(?![\p{L}\p{N}])/iu
const ATTACK = /(?<![\p{L}\p{N}])(đánh|chém|đâm|bắn|tấn công|lao vào|đấm|giết|attack|strike|stab|shoot|fight|punch|kill)(?![\p{L}\p{N}])/iu
const DEATH = /(bạn|ngươi|anh|cậu)\s+đã\s+chết|cái chết của (bạn|ngươi)|game over|you (have )?died/i

/** The scene the next reply continues, from the GM machine's mode ($gm_mode) and the player's turn. */
export function sceneKindOf(vars: Record<string, unknown> | undefined, player: string, lastReply = ''): SceneKind {
    let mode: { scene?: string; combat?: string } = {}
    try {
        // the machine's mode as this request's GM note left it (gmMachine.ts modeVar)
        mode = (JSON.parse(String(vars?.$gm_mode ?? '')) as { mode?: typeof mode }).mode ?? {}
    } catch { mode = {} }
    if (DEATH.test(lastReply)) return 'death'
    if (mode.combat === 'fight' || ATTACK.test(player)) return 'combat'
    if (SCAVENGE.test(player)) return 'scavenge'
    if (EXPLORE.test(player)) return 'explore'
    if (mode.scene === 'rest') return 'rest'
    if (mode.scene === 'travel') return 'travel'
    return mode.scene === 'still' ? 'quiet' : 'other'
}

const num = (v: unknown): number | null => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/** The last find's turn as this request sees it: a reroll of the reply that carried it asks again at that turn, so it looks at the mark before. */
export function lastFindTurnOf(vars: Record<string, unknown> | undefined, turn: number): number | null {
    const at = num(vars?.$find_turn)
    return at !== null && at >= turn ? num(vars?.$find_prev) : at
}

const knownOf = (vars: Record<string, unknown> | undefined): string[] => {
    try { const a = JSON.parse(String(vars?.$find_known ?? '[]')); return Array.isArray(a) ? a.map(String) : [] } catch { return [] }
}

/** The note at the end of the player's message when a find is due (the chat's turn, scene and seed); else the request as it was. */
export function findRequest<T extends { role: string; content: unknown }>(formated: T[], card: Room | undefined, chat: Chat | undefined): T[] {
    if (!hasFindRule(card) || !chat) return formated
    const vars = (chat.scriptstate ??= {})
    // the panel line is for the turn that carried the find only
    vars.$find_line = ''
    // "@admin ..." is out of the story: no roll, no find due, nothing spent (adminAsk.ts)
    if (lastTurnIsAsk(chat.message)) { vars.$find_roll = ''; return formated }
    const messages = chat.message ?? []
    const turn = storyTurns(card, messages) + 1
    const player = [...messages].reverse().find((m) => m.role === 'user')?.data ?? ''
    const lastReply = [...messages].reverse().find((m) => m.role === 'char')?.data ?? ''
    const r = findDue({
        turn, lastFindTurn: lastFindTurnOf(vars, turn), seed: chat.id ?? '', sceneKind: sceneKindOf(vars, player, lastReply), rank: rankOfLevel(levelOf(vars)),
        known: [...knownOf(vars), ...knownProvider()],
    })
    if (!r.due) { vars.$find_roll = ''; return formated }
    const roll: FindRoll = { ...findRoll(r, turn, chat.id ?? '', vars), len: messages.length + 1 }   // len: the chat length once the reply is in (the card's Lua matches on it)
    vars.$find_roll = JSON.stringify(roll)
    vars.$find_line = findDiceLine(roll)
    if (roll.ok) return gmRequest(formated, r.note)
    // a miss still spends the event: the next one is 6..10 turns away, whatever the narrator does (a reroll of this reply looks at the mark before)
    const was = num(vars.$find_turn)
    vars.$find_prev = was !== null && was < turn ? String(was) : String(vars.$find_prev ?? '')
    vars.$find_turn = String(turn)
    return gmRequest(formated, findFailNote(r.kind))
}

/**
 * After a reply: its find block leaves the stored text, a new find is recorded on the chat ($find_turn for the cap, $find_known so
 * it is not repeated, $find_line for the panel) and handed to the hook. A block that repeats a known find, or is bad, is only taken
 * out: it does not count for the cap. Returns the record or null.
 */
export function noteFind(charIndex: number, card: Room | undefined, chat: Chat | undefined): FindRecord | null {
    if (!chat || !card || card.type === 'group') return null
    const at = chat.message.length - 1
    const reply = chat.message[at]
    if (!reply || reply.role !== 'char' || !/\[\[F/.test(reply.data ?? '')) return null
    chat.message[at] = { ...reply, data: stripFind(reply.data ?? '') }
    if (isAskAnswer(chat.message, at)) return null   // Admin's answer to an ask gives no find
    if (!hasFindRule(card)) return null
    const vars = (chat.scriptstate ??= {})
    const turn = storyTurns(card, chat.message)
    const rec = parseFind(reply.data ?? '', { card: String((card as character).chaId ?? ''), chapter: '' })
    if (!rec || turn < 1) return null
    // NoFreeGrant: only a reply whose turn rolled a pass may give something (when Lua decides the drop, $finds_by_lua=1, it owns the roll)
    if (String(vars.$finds_by_lua ?? '') !== '1') {
        const roll = parseRoll(vars.$find_roll)
        if (!roll || roll.turn !== turn || !roll.ok) return null
    }
    const known = [...knownOf(vars), ...knownProvider()].map(findFingerprint)
    if (known.includes(findFingerprint(rec.name.en)) || known.includes(findFingerprint(rec.name.vi))) return null
    if ([...knownOf(vars), ...knownProvider()].some((k) => similar(k, rec.name.en))) return null
    const was = num(vars.$find_turn)
    vars.$find_prev = was !== null && was < turn ? String(was) : String(vars.$find_prev ?? '')
    vars.$find_turn = String(turn)
    const dice = parseRoll(vars.$find_roll)
    vars.$find_line = `${dice && dice.turn === turn ? findDiceLine(dice) + ' — nhận ' : '+ ' + (rec.kind === 'skill' ? 'Skill' : 'Item') + ' mới: '}${rec.name.vi}`
    vars.$find_known = JSON.stringify([...knownOf(vars), rec.name.vi, rec.name.en].slice(-KNOWN_MAX * 2))
    onFindParsed(rec, { chatId: chat.id ?? '', card: rec.source.card, turn })
    return rec
}
