// The page's side of the Game Master (gameMaster.ts): the note in the request, and the [[GM]] block taken out after a reply.
// Works on every platform: no server, the state lives in the chat's variables (scriptstate "$gm_*").

import { getDatabase, type Chat, type character, type groupChat } from '../storage/database.svelte'
import { applyBookkeep, BOOK_KEYS, bookkeepPrompt, cardDice, cardEvent, gmWorld, prevNewOf, creationNote, hasFuturePlan, hasPersonaRule, INIT_STORY, PERSONA_STORY, VOICE_STORY, PLAN_STORY, GM_KEYS, gmNote, hasCreationStep, hasPanel, markAdvance, gmPhase, gmRequest, gmStateOf, parseBookkeep, rollGm, settleGm, takeGm, worldFlavour, yesAt, type GmState } from './gameMaster'
import { applyStatus, narratorWrites, paidNote, panelOf, parseStatus, statusPrompt, statusSpec, type StatusSpec } from './statusBook'
import { storyShape } from './replyFormat'
import { getPersonaPrompt } from '../util'
import { FORWARD_VAR, parseShelvesLine, shelvesAsk, withForward, type Shelf } from './loreIndex'
import { forwardAsk, prefetchBooks, trackForward } from './loreIndexPage'
import { decideMessages, decideVars, type DecideInput, type GmDecision } from './gmSolver'
import { modeAfterDecision, modeBefore, modeFromTurn, modeVar } from './gmMachine'

type Room = character | groupChat

/** On for a story card (not a group) unless turned off in the settings. */
export function gameMasterOn(card: Room | undefined): card is character {
    return getDatabase().gameMaster !== false && !!card && card.type !== 'group'
}

function writeState(chat: Chat, state: GmState): void {
    chat.scriptstate ??= {}
    // every key, so a value the rolled-back reply had added is cleared too
    for (const k of [...GM_KEYS, ...BOOK_KEYS]) chat.scriptstate['$' + k] = state[k] ?? ''
}

/** This turn's note at the end of the player's message (fresh dice every request); unchanged while the GM is silent. */
export function gameMasterRequest<T extends { role: string; content: unknown }>(formated: T[], card: Room | undefined, chat: Chat | undefined, rng?: () => number): T[] {
    if (!gameMasterOn(card) || !chat) return formated
    const messages = chat.message ?? []
    const settled = settleGm(gmStateOf(chat.scriptstate), messages)
    if (settled.rolledBack) writeState(chat, settled.state)
    const state = settled.state
    const replies = messages.filter((m) => m.role === 'char')
    const shape = storyShape(replies.map((m) => m.data ?? ''))
    const phase = gmPhase(card, messages, chat.scriptstate, state, shape.head.length + shape.tail.length > 0)
    const dice = rollGm(state, replies.length, rng)
    // the card's own fate die, as this request rolled it, is named in the note, which the model follows over the system prompt;
    // never two in a row (the cards' Module 10), so a NEW right after a reply told NEW is held back
    const die = phase === 'run' ? cardEvent(formated) : null
    let held = false
    if (die !== null) {
        if (cardNewMark(chat.scriptstate ??= {}, replies.length, die)) dice.cardNew = true
        else held = die
    }
    // the pace clock is the app's: an advance rolled now is marked on the chat (sinceAdvance)
    const mark = phase === 'run' ? markAdvance(state, replies.length, dice) : null
    if (mark) { chat.scriptstate ??= {}; chat.scriptstate.$gm_adv_at = mark.gm_adv_at ?? ''; chat.scriptstate.$gm_adv_prev = mark.gm_adv_prev ?? '' }
    return gmRequest(formated, gmNote(phase, state, dice, worldFlavour(card)) + (held ? CARD_HELD : ''))
}

/**
 * The same note with the solver's decision (gmSolver.ts, server/node/gmSolver.cjs) in place of the open rules: the dice, the card's
 * die, the chat's state and the GM machine's scene and fight go to the solver, which picks this turn's one event and what each
 * person in the scene does. Nothing is written before the answer; no answer (no server, slow, an error) is today's note exactly.
 * The marks follow the decision: the pace clock moves only when the event is a new one, the card's NEW is told only when chosen.
 */
export async function gameMasterRequestSolved<T extends { role: string; content: unknown }>(formated: T[], card: Room | undefined, chat: Chat | undefined,
    decide: (input: DecideInput) => Promise<GmDecision | null>, rng?: () => number): Promise<T[]> {
    if (!gameMasterOn(card) || !chat) return formated
    const messages = chat.message ?? []
    const settled = settleGm(gmStateOf(chat.scriptstate), messages)
    if (settled.rolledBack) writeState(chat, settled.state)
    const state = settled.state
    const replies = messages.filter((m) => m.role === 'char')
    const shape = storyShape(replies.map((m) => m.data ?? ''))
    const phase = gmPhase(card, messages, chat.scriptstate, state, shape.head.length + shape.tail.length > 0)
    if (phase === 'silent') return formated
    const n = replies.length
    const dice = rollGm(state, n, rng)
    const die = phase === 'run' ? cardEvent(formated) : null
    const player = [...messages].reverse().find((m) => m.role === 'user')?.data ?? ''
    const mode = modeFromTurn(modeBefore(chat.scriptstate, n), player)
    const { kinds, stance } = cardDice(formated)
    const decision = await decide({
        chatId: chat.id ?? '', world: gmWorld(card), phase, vars: decideVars(chat.scriptstate), messages: decideMessages(messages),
        dice: { pace: dice.pace, surface: dice.surface, consequence: dice.consequence, cardNew: die === true, firstOrder: !!dice.firstOrder },
        prevNew: prevNewOf(chat.scriptstate, n), kinds, stance, mode,
    }).catch(() => null)
    if (!decision) return gameMasterRequest(formated, card, chat, rng)
    const vars = chat.scriptstate ??= {}
    if (phase === 'run') {
        cardNewMark(vars, n, decision.turn === 'new')
        if (decision.turn === 'advance' || decision.turn === 'escalate' || decision.turn === 'order') {
            const mark = markAdvance(state, n, { ...dice, pace: 'advance' })
            if (mark) { vars.$gm_adv_at = mark.gm_adv_at ?? ''; vars.$gm_adv_prev = mark.gm_adv_prev ?? '' }
        } else if (String(vars.$gm_adv_at ?? '') === String(n)) {
            // a reroll of a reply the clock was marked for, now not a new event: the mark goes back
            vars.$gm_adv_at = vars.$gm_adv_prev ?? ''
        }
    }
    vars.$gm_mode = modeVar(vars, n, modeAfterDecision(mode, decision))
    return gmRequest(formated, gmNote(phase, state, dice, worldFlavour(card), decision.line))
}

const CARD_HELD = '\n\n[Card fate die (hidden, never named): the last reply already brought something new; nothing new surfaces in this one, whatever the card\'s die says.]'

/**
 * Whether this request tells the card's NEW event (cardEvent), kept on the chat: the cards' Module 10 says "never two new
 * events in a row", but the note followed the die alone, and its "overrides a QUIET or BUILD pace" asked for a second one (Z3,
 * specs/story/dice/card_new_z3.py: sat before, unsat after). $gm_new_at is the reply count the last NEW was told for;
 * a reroll asks again at that count, so it looks at the mark before ($gm_new_prev), and a quiet reroll takes the mark back.
 */
export function cardNewMark(vars: Chat['scriptstate'], n: number, dieNew: boolean): boolean {
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? -1 : Number(v))
    const at = num(vars.$gm_new_at), prev = num(vars.$gm_new_prev)
    const last = at === n ? prev : at
    const told = dieNew && last !== n - 1
    const str = (x: number) => (x < 0 ? '' : String(x))
    vars.$gm_new_at = str(told ? n : last)
    vars.$gm_new_prev = str(told ? last : at === n ? -1 : prev)
    return told
}

/**
 * The persona and Future Plan notes, whether the GM is on or off: they belong to the card and the player, not to the GM
 * (Z3 on the note conditions, 2026-10-19: inside gameMasterRequest they were gone with the GM switched off, and on a card with
 * no creation step they never came, since nothing there confirms a character). From the yes on, the Initialization reply
 * included; on a card with no creation step, once a story reply exists.
 */
export function storyNotesRequest<T extends { role: string; content: unknown }>(formated: T[], card: Room | undefined, chat: Chat | undefined): T[] {
    if (!card || card.type === 'group' || !chat) return formated
    const paid = notePanelAtRequest(card, chat)
    const messages = chat.message ?? []
    const state = gmStateOf(chat.scriptstate)
    // never while a character is being made (the creation note's turns); a card with no creation step has none, so from its
    // first reply (the GM's own "story-like" test needs panels, which such a card may never write)
    const running = yesAt(messages) >= 0 || hasPanel(chat.scriptstate) || !!state.gm_arc || !!state.gm_past
        || (!hasCreationStep(card) && messages.some((m) => m.role === 'char'))
    if (!running) return formated
    // only a card that says the persona is the character sheet gets the persona and voice notes (another card keeps its own rules)
    const ours = hasPersonaRule(card)
    const yes = yesAt(messages)
    const initializing = yes >= 0 && !messages.slice(yes + 1).some((m) => m.role === 'char')
    return gmRequest(formated, (ours && initializing ? INIT_STORY : '') + (hasPersona() && ours ? PERSONA_STORY : '')
        + (ours && !initializing ? VOICE_STORY : '') + (hasFuturePlan(card) ? PLAN_STORY : '') + (initializing ? '' : paid))
}

/** The card's panel as the request leaves (per chat id), so the reply's own writes can be told apart (statusBook.ts); and as the
 *  last request left, so the next one can say what the reply in between already counted. `vars`: the panel and the ledger as
 *  chat variables, kept for a rollback of the reply (settlePanel). */
const panelAtRequest = new Map<string, { panel: Record<string, string>; vars: Record<string, string> }>()
const panelLastRequest = new Map<string, { at: number; panel: Record<string, string>; note: string }>()

function notePanelAtRequest(card: character, chat: Chat): string {
    const spec = statusSpec(card)
    if (!spec || !chat.id) return ''
    const now = panelOf(spec, chat.scriptstate)
    const at = chat.message?.length ?? 0
    const vars: Record<string, string> = {}
    for (const [k, v] of Object.entries(now)) vars['$st_' + k] = v
    for (const k of LEDGER_VARS) vars[k] = chat.scriptstate?.[k] === undefined ? '' : String(chat.scriptstate[k])
    panelAtRequest.set(chat.id, { panel: now, vars })
    const last = panelLastRequest.get(chat.id)
    // a reroll or a retry asks again at the same place: the same reply in between, the same note
    if (last && last.at === at) return last.note
    const note = paidNote(last?.panel, now)
    panelLastRequest.set(chat.id, { at, panel: now, note })
    return note
}

/** The card's ledger (status.lua's [[LEDGER]]: memories, relations, timeline), written by the reply as the panel is. */
const LEDGER_VARS = ['$led_mem', '$led_rel', '$led_ev']
/** Replies whose rollback is kept: a rollback over more replies at once goes back to before the oldest of these. */
const PANEL_LOG_MAX = 20
type PanelLog = [string, Record<string, string>][]

function panelLog(vars: Chat['scriptstate']): PanelLog {
    let log: PanelLog = []
    try { log = JSON.parse(String(vars.$panel_log || '[]')) } catch { log = [] }
    if (!Array.isArray(log)) log = []
    // 21380949 kept the latest reply only ($panel_at, its panel by key)
    if (vars.$panel_at) {
        let prev: Record<string, string> = {}
        try { prev = JSON.parse(String(vars.$panel_prev || '{}')) ?? {} } catch { prev = {} }
        log.push([String(vars.$panel_at), Object.fromEntries(Object.entries(prev).map(([k, v]) => ['$st_' + k, v]))])
        vars.$panel_at = ''
        vars.$panel_prev = ''
    }
    return log
}

/**
 * A reply's panel and ledger writes (the card's script from its [[STATUS]] and [[LEDGER]] blocks, the helper's) go with it on a
 * reroll or a delete, as the GM's do (settleGm): the variables before each reply are kept with its chat id ($panel_log; not st_*,
 * which is the panel), and once the chat's last kept replies are gone the variables go back to before the oldest of them. Called
 * as sendChat starts, before the lorebook's {{getvar::st_*}} shows the narrator the panel: a rerolled kill in Shadow Slave read
 * 3/1000 there and paid it again (0 -> 3 -> 6), a rerolled wage in Lord of the Mysteries too, and a rerolled "event:" stayed in
 * the timeline twice. TLA+ (specs/story/reroll/PanelReroll.tla): the latest reply alone fails a rollback over two replies.
 * A reply deleted from the middle, with later ones kept, leaves the variables as they are.
 */
export function settlePanel(chat: Chat | undefined): void {
    const vars = chat?.scriptstate
    if (!vars || (!vars.$panel_log && !vars.$panel_at)) return
    const log = panelLog(vars)
    const present = new Set((chat.message ?? []).map((m) => m.chatId).filter(Boolean))
    let k = log.length
    while (k > 0 && !present.has(log[k - 1][0])) k--
    if (k < log.length) Object.assign(vars, log[k][1])
    vars.$panel_log = JSON.stringify(log.slice(0, k))
}

/** The player wrote a persona (the prompt carries it as its own block, index.svelte.ts getPersonaPrompt). */
function hasPersona(): boolean {
    return !!String(getPersonaPrompt() ?? '').trim()
}

/** The note at the end of the player's message while the character is being made (gameMaster.ts creationNote); none after. */
export function creationRequest<T extends { role: string; content: unknown }>(formated: T[], card: Room | undefined, chat: Chat | undefined): T[] {
    if (!card || card.type === 'group' || !chat) return formated
    return gmRequest(formated, creationNote(card, chat.message ?? [], chat.scriptstate, gmStateOf(chat.scriptstate), hasPersona() && hasPersonaRule(card)))
}

/** The status panel's keys are kept once the character is confirmed: the yes was given, or the GM already runs (statusBook.ts). */
export function statusConfirmed(card: character, messages: Chat['message'], vars: Chat['scriptstate']): boolean {
    const s = gmStateOf(vars)
    return yesAt(messages) >= 0 || !!s.gm_arc || !!s.gm_past || (!hasCreationStep(card) && hasPanel(vars))
}

/** After a reply: its [[GM]] block leaves the message and its values go to the chat's variables; then the bookkeeper. */
export function noteGameMaster(charIndex: number, chat: Chat | undefined): void {
    const card = getDatabase().characters[charIndex] as Room | undefined
    if (!chat || !card || card.type === 'group') return
    const at = chat.message.length - 1
    const reply = chat.message[at]
    if (!reply || reply.role !== 'char') return
    const replies = chat.message.filter((m) => m.role === 'char').length
    const player = [...chat.message.slice(0, at)].reverse().find((m) => m.role === 'user')?.data ?? ''
    const storyLike = () => { const shape = storyShape(chat.message.filter((m) => m.role === 'char').map((m) => m.data ?? '')); return shape.head.length + shape.tail.length > 0 }
    const gmOn = gameMasterOn(card)
    if (gmOn) {
        const before = settleGm(gmStateOf(chat.scriptstate), chat.message.slice(0, at)).state
        // a side the player commits to counts once the character is confirmed (not a creation answer that names a faction)
        const quiet = gmPhase(card, chat.message, chat.scriptstate, before, storyLike()) === 'silent'
        const taken = takeGm(before, reply, replies, quiet ? '' : player)
        if (taken) {
            chat.message[at] = { ...reply, data: taken.text }
            writeState(chat, taken.state)
        }
    }
    // what the narrator's own block wrote for this reply (the card's script has applied it): a counter it raised with no system
    // line in the reply goes back (a reward is paid once, statusBook.ts), and the helper leaves the rest of its keys alone
    const spec = statusSpec(card)
    const atRequest = chat.id ? panelAtRequest.get(chat.id) : undefined
    const asked = atRequest?.panel
    if (chat.id) panelAtRequest.delete(chat.id)
    let written: Record<string, string> = {}
    if (spec && asked) {
        const w = narratorWrites(spec, asked, chat.scriptstate, reply.data ?? '')
        written = w.written
        if (Object.keys(w.unpaid).length) applyStatus(chat.scriptstate ??= {}, w.unpaid)
    }
    // the panel and ledger before this reply, for a reroll or a delete of it (settlePanel); the helper's writes go with it too
    if (spec && atRequest && reply.chatId && chat.scriptstate) {
        const log = panelLog(chat.scriptstate).filter(([id]) => id !== reply.chatId)
        log.push([reply.chatId, atRequest.vars])
        chat.scriptstate.$panel_log = JSON.stringify(log.slice(-PANEL_LOG_MAX))
    }
    // the bookkeeper, once the character is confirmed (not awaited: the chat goes on); Settings can turn the extra call off.
    // One helper call per turn asks for both the GM's notes and the card's status panel.
    if (getDatabase().gmBookkeeper === false) return
    const gm = gmOn && gmPhase(card, chat.message, chat.scriptstate, gmStateOf(chat.scriptstate), storyLike()) !== 'silent'
    const status = spec && statusConfirmed(card, chat.message, chat.scriptstate) ? spec : null
    if (!gm && !status) return
    // the chat is read again when the answer comes: it may have been replaced meanwhile (as scenePicturesPage does)
    const live = () => getDatabase().characters[charIndex]?.chats?.find((c) => c === chat || (!!chat.id && c.id === chat.id)) ?? chat
    const redraw = () => { const c = getDatabase().characters[charIndex]; if (c) c.reloadKeys = (c.reloadKeys ?? 0) + 1 }
    // the same call also names the shelves the next reply needs (loreIndex.ts "the GM asks the librarian"); the chain, books included,
    // is tracked so the next turn waits for it rather than asking the shelf question itself
    const ask = forwardAsk(card)
    const lore = ask ? { ...ask, prefetch: () => prefetchBooks(card, live()) } : undefined
    const run = bookkeep(live, chat.message[at], replies, worldFlavour(card), undefined, { gm, status, redraw, written, lore })
    trackForward(chat, run)
    void run.catch((e) => console.warn('[game master] bookkeeper failed', e))
}

const BOOKKEEP_TIMEOUT_MS = 60_000

/**
 * Ask the submodel for the notes this reply changed (the GM's, and the card's panel keys when `status` is given); applied only
 * while that reply is still the chat's last one. True when anything was written.
 */
export async function bookkeep(live: () => Chat, reply: { data: string; chatId?: string }, replies: number, flavour: string,
    ask?: (prompt: string) => Promise<string | null>, opts: { gm?: boolean; status?: StatusSpec | null; redraw?: () => void; written?: Record<string, string>
        lore?: { shelves: Shelf[]; indexLength: number; prefetch?: () => Promise<void> } } = {}): Promise<boolean> {
    const wantGm = opts.gm !== false
    const before = live()
    const player = [...before.message].reverse().find((m) => m.role === 'user')?.data ?? ''
    // the reply before this one: what it showed is on the panel already (a body seen again is not a second kill)
    const said = before.message.filter((m) => m.role === 'char')
    const previous = (said.at(-1)?.data === reply.data || (!!reply.chatId && said.at(-1)?.chatId === reply.chatId) ? said.at(-2) : said.at(-1))?.data ?? ''
    const written = opts.written ?? {}
    const prompt = bookkeepPrompt(wantGm ? gmStateOf(before.scriptstate) : null, player, reply.data ?? '', flavour, opts.status ? statusPrompt(opts.status, before.scriptstate, { previous, written }) : '', opts.lore ? shelvesAsk(opts.lore.shelves) : '')
    const answer = await (ask ?? askSubmodel)(prompt)
    const chat = live()
    const last = chat.message[chat.message.length - 1]
    if (!answer || !last || last.role !== 'char' || (reply.chatId && last.chatId !== reply.chatId)) return false
    let wrote = false
    const bodies = wantGm ? parseBookkeep(answer) : null
    if (bodies) {
        writeState(chat, applyBookkeep(gmStateOf(chat.scriptstate), bodies, reply.chatId ?? '', replies, player))
        wrote = true
    }
    if (opts.status) {
        const updates = parseStatus(answer, opts.status, chat.scriptstate, { reply: reply.data ?? '', written })
        if (Object.keys(updates).length) {
            chat.scriptstate ??= {}
            applyStatus(chat.scriptstate, updates)
            opts.redraw?.()
            wrote = true
        }
    }
    // the shelves the next reply needs, kept with the reply they answer; then the books of those shelves (nobody waits on it)
    const named = opts.lore && reply.chatId ? parseShelvesLine(answer, opts.lore.shelves.length) : null
    if (opts.lore && named) {
        chat.scriptstate ??= {}
        chat.scriptstate[FORWARD_VAR] = withForward(chat.scriptstate, { at: reply.chatId!, n: opts.lore.indexLength, shelves: named.map((k) => opts.lore!.shelves[k - 1].name) })
        wrote = true
        await opts.lore.prefetch?.()
    }
    return wrote
}

async function askSubmodel(prompt: string): Promise<string | null> {
    const { requestChatData } = await import('./request/request')
    const ask = requestChatData({ formated: [{ role: 'user', content: prompt }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel')
    const res = await Promise.race([ask, new Promise<null>((r) => setTimeout(() => r(null), BOOKKEEP_TIMEOUT_MS))])
    return res && res.type === 'success' && typeof res.result === 'string' ? res.result : null
}
