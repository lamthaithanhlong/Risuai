// The model judge: the owner's own model through the same local 9router the settings point at (read from the COPY of the save),
// asked for strict JSON. Used where a regex cannot tell: did a pause surface something new, was the impossible turn granted, does
// a reply fit the novel's canon. Every answer is kept in the record, so a scorecard shows what the judge said.
import fs from 'fs'
import path from 'path'
import { oneLine } from './score.mjs'

// A model the hook or the router refuses (or that answers nothing usable twice) is replaced by cfg.fallback for the rest of the run,
// and the record says so (out.model / out.fallbackWhy).
async function ask(cfg, prompt, opts = {}) {
    try { return await askOnce(cfg, prompt, opts) } catch (e) {
        if (!cfg.fallback || cfg.model === cfg.fallback) throw e
        cfg.fallbackWhy = `${cfg.model} failed (${oneLine(e.message, 160)}); judged with ${cfg.fallback}`
        cfg.model = cfg.fallback
        return askOnce(cfg, prompt, opts)
    }
}

// ---- the judge on the Claude subscription (an option, 2026-10-21) --------------------------------------------------------------
// Of the day's 399 DeepSeek requests through 9Router, 298 were this judge and 101 its canon reviewer. A Claude model name
// (claude:sonnet, claude:haiku, sonnet, claude-*) runs a lean `claude -p` instead: no tools, no MCP, no
// settings or hooks, no session kept, ~740 tokens of its own, on the plan rather than per token. At most CLAUDE_AT_ONCE run at
// once (about the router's DeepSeek pace); a failure or a limit goes to cfg.fallback (DeepSeek) through ask().
// Owner's popup, 2026-10-21 (later the same day): the judge runs claude:sonnet on the plan by default ($0 real money); main-deepseek
// was landing on GLM ($9.6 / M in, ~$0.086 a judge call) while DeepSeek's channel is out of balance.
export const isClaudeModel = (m) => /^(claude:|sonnet$|haiku$|opus$|claude-)/i.test(String(m ?? ''))
const claudeName = (m) => String(m).replace(/^claude:/i, '')
const CLAUDE_AT_ONCE = 4
let claudeRunning = 0
const claudeWaiting = []
async function claudeSlot() {
    if (claudeRunning < CLAUDE_AT_ONCE) { claudeRunning++; return }
    await new Promise((r) => claudeWaiting.push(r))
}
function claudeDone() {
    const next = claudeWaiting.shift()
    if (next) next(); else claudeRunning--
}
export async function askClaude(model, prompt, { timeoutMs = 240000, bin = process.env.RISU_JUDGE_CLAUDE_BIN || 'claude' } = {}) {
    await claudeSlot()
    try {
        const { spawn } = await import('child_process')
        const args = ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
            '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json',
            '--system-prompt', 'You are a strict, careful judge of an interactive story. Answer only with the JSON object asked for.']
        const out = await new Promise((resolve, reject) => {
            const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
            let o = '', e = ''
            const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude -p timed out after ${timeoutMs} ms`)) }, timeoutMs)
            child.stdout.on('data', (d) => { o += d })
            child.stderr.on('data', (d) => { e += d })
            child.on('error', (err) => { clearTimeout(timer); reject(err) })
            child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(o) : reject(new Error(`claude -p exit ${code}: ${oneLine(e || o, 200)}`)) })
            child.stdin.on('error', () => {})
            child.stdin.end(prompt)
        })
        const j = JSON.parse(out)
        if (j.is_error) throw new Error(`claude -p: ${oneLine(j.result ?? j.subtype ?? 'error', 200)}`)
        return String(j.result ?? '')
    } finally {
        claudeDone()
    }
}

async function askOnce(cfg, prompt, { maxTokens = 1200 } = {}) {
    if (isClaudeModel(cfg.model)) {
        let lastErr = ''
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const content = await askClaude(claudeName(cfg.model), prompt)
                const m = /\{[\s\S]*\}/.exec(content.replace(/```json|```/g, ''))
                if (!m) { lastErr = `no JSON in: ${oneLine(content, 200)}`; continue }
                return JSON.parse(m[0])
            } catch (e) { lastErr = String(e.message || e) }
        }
        throw new Error(lastErr)
    }
    let lastErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await fetch(cfg.url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
                body: JSON.stringify({ model: cfg.model, stream: false, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
                signal: AbortSignal.timeout(180000),
            })
            const text = await r.text()
            if (!r.ok) { lastErr = `HTTP ${r.status}: ${oneLine(text, 200)}`; await new Promise((res) => setTimeout(res, 20000 * (attempt + 1))); continue }
            const content = JSON.parse(text).choices?.[0]?.message?.content ?? ''
            const m = /\{[\s\S]*\}/.exec(content.replace(/```json|```/g, ''))
            if (!m) { lastErr = `no JSON in: ${oneLine(content, 200)}`; continue }
            return JSON.parse(m[0])
        } catch (e) {
            lastErr = String(e.message || e)
        }
    }
    throw new Error(lastErr)
}

const rulesOf = (story) => {
    try { return fs.readFileSync(path.join(story.src, 'main_description.md'), 'utf8').slice(0, 7000) } catch { return '' }
}

/**
 * Did the narrator speak or choose for the player's character? Every story turn: { label: {speaks, decides, quote} }.
 * Carrying out what the player wrote is the narrator's job; words the player did not write, or a choice the player was owed
 * (answering a question, agreeing, going somewhere new, deciding the next step), are not.
 */
export async function judgeVoice(rec, story, cfg, errors = []) {
    const out = {}
    const play = rec.play?.turns ?? []
    const prevOf = (t) => { const i = play.indexOf(t); return i > 0 ? play[i - 1].shown || play[i - 1].reply : '' }
    const name = (t) => oneLine(t.vars?.st_name ?? '', 40)
    for (const t of play.filter((x) => x.phase === 'story' && x.ok)) {
        try {
            out[t.label] = await ask(cfg, `You check an interactive story (${story.title}, played in Vietnamese). The player controls ONE character${name(t) ? ` (${name(t)})` : ''}; the narrator controls everyone and everything else. The narrator must carry out what the player wrote and must not play the player's character beyond it.
Read the player's turn and the reply. Answer:
- speaks: the reply gives the player's character words the player did not write: a quoted line, or reported speech ("anh đáp rằng…", "cô hỏi…", "anh đồng ý"). Putting what the player wrote into a quoted line is fine (the player wrote "I ask her name" and the character asks her name aloud); only words with content the player did not write count: a new question, an answer, a promise, a joke, a reply to someone. Other characters' words do not count.
- decides: the reply makes a choice the player had not made: answers an NPC's question or offer for them, agrees or refuses, picks a side, sets off somewhere the player did not say, or takes a new significant action after finishing what the player wrote. The physical steps of carrying out the player's own action, reflexes (flinching, a gasp), sensations, and the character's immediate reaction to something sudden do NOT count.

PREVIOUS REPLY (end):
${String(prevOf(t)).slice(-1200)}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 5000)}

Answer only JSON: {"speaks": true|false, "decides": true|false, "quote": "<the words of the reply that do it, or empty>"}`, { maxTokens: 400 })
        } catch (e) { errors.push(`voice ${t.label}: ${e.message}`) }
    }
    return out
}

// the player's persona companions (e.g. the ghost Evelyn) are always with the character: never a new event (measured
// 2026-10-19: Mailman t6 was judged "new: Evelyn xuất hiện")
const companions = (rec) => {
    const names = [...String(rec.persona ?? '').matchAll(/^\*\*([^*\n—:]{2,30}?)\s*—/gm)].map((m) => m[1].trim())
    return names.length ? `, and the character's own companions from the player's profile (${names.join(', ')}), who are always with them` : ''
}

/** judge the record: { pauses: {label: {newThing, what}}, impossible: {granted, why}, canon: [{label, fit, summary, slips}] } */
export async function judgeRecord(rec, story, cfg, log = console.log) {
    cfg = { ...cfg }
    const out = { model: cfg.model, pauses: {}, sideLife: {}, canon: [], errors: [] }
    const play = rec.play?.turns ?? []
    const storyTurns = play.filter((t) => t.phase === 'story' && t.ok)
    const prevOf = (t) => { const i = play.indexOf(t); return i > 0 ? play[i - 1].shown || play[i - 1].reply : '' }

    for (const t of storyTurns.filter((x) => x.kind === 'pause')) {
        try {
            out.pauses[t.label] = await ask(cfg, `You check an interactive story (${story.title}, played in Vietnamese). The player paused (rest, a walk, travel or time passing).
Did the narrator's reply introduce a NEW EVENT: a person, creature, clue, rumour, message or threat not in the story before, entering the scene and asking for the player's attention? These do NOT count: time passing, weather, the scenery, furniture or objects of a place the player walks into, the character's own thoughts, and people or things already present or already announced in the previous reply${companions(rec)}. Also say whether the reply ends with a menu of options for the player.

PREVIOUS REPLY (end):
${String(prevOf(t)).slice(-1500)}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 5000)}

Answer only JSON: {"newThing": true|false, "what": "<the new element in a few words, or empty>", "menu": true|false}`)
        } catch (e) { out.errors.push(`pause ${t.label}: ${e.message}`) }
    }

    const imp = play.find((t) => t.kind === 'impossible' && t.ok)
    if (imp) {
        try {
            out.impossible = await ask(cfg, `You referee an interactive story (${story.title}). The player declared an action that is impossible for an ordinary new character, or dictated its outcome (a kill, a reward, a power, another person's choice).
Did the narrator's reply GRANT it as written (the impossible feat succeeded, or the dictated reward/rank/obedience was given)? An attempt that fails, costs dearly, or is shown to be beyond the character is NOT granted.

PLAYER: ${imp.text}

REPLY:
${String(imp.shown || imp.reply).slice(0, 6000)}

Answer only JSON: {"granted": true|false, "why": "<one sentence, quoting the reply>"}`)
        } catch (e) { out.errors.push(`impossible: ${e.message}`) }
    }

    const sideT = play.find((t) => t.kind === 'side')
    for (const t of storyTurns.filter((x) => x.kind === 'side-life')) {
        try {
            out.sideLife[t.label] = await ask(cfg, `You check an interactive story (${story.title}). Earlier the player committed to a side: "${sideT?.text ?? ''}".
Does this reply keep that choice alive: either the side's people, duties, rules, orders, rivals or consequences shape what happens, or the choice is still the character's goal and the world shows honestly why it cannot be reached yet (e.g. the side is far away)? It does NOT follow when the choice is forgotten, silently undone, or replaced by another side without the player deciding it.

PREVIOUS REPLY (end): ${String(prevOf(t)).slice(-1200)}

PREVIOUS REPLY (end): ${String(prevOf(t)).slice(-1200)}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 5000)}

Answer only JSON: {"follows": true|false, "how": "<one sentence, quoting the reply>"}`)
        } catch (e) { out.errors.push(`side ${t.label}: ${e.message}`) }
    }

    out.voice = await judgeVoice(rec, story, cfg, out.errors)

    // the librarian's tagged facts (loreFacts.ts): a turn whose request carried a RUMOR, an UNKNOWN or an OUTDATED line is asked
    // whether the reply told it as true, revealed it, or as still so (at most 8 turns)
    out.facts = {}
    const tagged = storyTurns.map((t) => ({ t, lines: (t.net ?? []).filter((n) => n.kind === 'main' || n.type === 'facts').flatMap((n) => n.facts ?? []).filter((f) => f.status !== 'fact') })).filter((x) => x.lines.length).slice(0, 8)
    for (const { t, lines } of tagged) {
        try {
            out.facts[t.label] = await ask(cfg, `You check an interactive story (${story.title}, played in Vietnamese). Before this reply the narrator was given lore lines, each tagged: RUMOR = only said or believed, never to be narrated as true; UNKNOWN = nobody in the story knows it, not to be revealed; OUTDATED = was true and is no longer.

TAGGED LINES:
${[...new Set(lines.map((f) => `${f.status.toUpperCase()} · ${f.text}`))].slice(0, 20).join('\n')}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 5000)}

Only judge what the REPLY says about these lines (most replies do not touch them: then all false). A character repeating a rumor as a rumor ("người ta đồn…", "nghe nói…") is fine.
Answer only JSON: {"rumorAsFact": true|false, "unknownRevealed": true|false, "outdatedAsCurrent": true|false, "touched": true|false, "quote": "<the words of the reply, or empty>"}`)
        } catch (e) { out.errors.push(`facts ${t.label}: ${e.message}`) }
    }

    // NPC psychology (server/node/npcPsych.cjs): a turn whose GM note carried a Subtext line (the copy server's gm.jsonl as a 'decide'
    // net) is asked whether the reply SHOWS each person's drive or STATES it (at most 8 turns, spread over the story), and two adjacent
    // turns that name the same person are asked whether that person's feeling carries over or changes for a cause (at most 6 pairs);
    // read by score.mjs npc.subtext and npc.emotion_consistent
    const subOf = (t) => String((t?.net ?? []).filter((n) => n.type === 'decide' && String(n.npc?.subtext ?? '').trim()).at(-1)?.npc?.subtext ?? '').trim()
    const namesOf = (s) => [...String(s).matchAll(/[“"]([^”"\n]{1,60})[”"]([^“"]*)/g)].map((m) => ({ name: m[1].trim(), text: `“${m[1].trim()}”${m[2]}`.trim() }))
    const withSub = storyTurns.filter((t) => subOf(t))
    const spread = withSub.length <= 8 ? withSub : Array.from({ length: 8 }, (_, k) => withSub[Math.round((k * (withSub.length - 1)) / 7)])
    out.npcSubtext = {}
    for (const t of spread) {
        try {
            out.npcSubtext[t.label] = await ask(cfg, `You check an interactive story (${story.title}, played in Vietnamese). Before this reply the narrator was given hidden NPC subtext (what each named person wants and how they carry themselves), to be SHOWN through what they do, say, avoid saying, and their tone — never STATED as a label.

SUBTEXT GIVEN:
${subOf(t)}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 5000)}

For each person named in the subtext who appears in the reply: is their drive or feeling conveyed through action, dialogue, silence, body language or tone ("shown")? Does the narration state the feeling or motive flatly as a label ("cô ấy cảm thấy tức giận", "anh ta muốn làm lành với bạn") instead of showing it ("stated")? A person absent from the reply counts as neither. "consistent" = what they do fits the subtext given (a warm person not suddenly cold without cause).
Answer only JSON: {"people": [{"name": "...", "inReply": true|false, "shown": true|false, "stated": true|false, "consistent": true|false, "quote": "<the words, or empty>"}]}`)
        } catch (e) { out.errors.push(`npc subtext ${t.label}: ${e.message}`) }
    }
    out.npcConsistent = {}
    const npcPairs = []
    for (let i = 1; i < storyTurns.length && npcPairs.length < 6; i++) {
        const a = storyTurns[i - 1], b = storyTurns[i]
        const before = namesOf(subOf(a)), now = namesOf(subOf(b))
        const p = now.find((x) => before.some((y) => y.name === x.name) && String(b.shown || b.reply).includes(x.name))
        if (p) npcPairs.push({ a, b, name: p.name, then: before.find((y) => y.name === p.name).text, now: p.text })
    }
    for (const { a, b, name, then, now } of npcPairs) {
        try {
            out.npcConsistent[`${a.label}>${b.label}:${name}`] = await ask(cfg, `You check an interactive story (${story.title}, played in Vietnamese) for emotional continuity of one person across two consecutive replies. The narrator was told, hidden, how ${name} felt and what they wanted in each.

REPLY 1 (end): ${String(a.shown || a.reply).slice(-1800)}
${name} THEN: ${then}
PLAYER BETWEEN: ${b.text}
REPLY 2: ${String(b.shown || b.reply).slice(0, 4000)}
${name} NOW: ${now}

Is ${name}'s feeling toward the player's character in REPLY 2 continuous with REPLY 1, or changed only for a cause shown in the player's action or REPLY 2 itself? An unexplained swing (cold to affectionate, hostile to helpful with nothing happening) is a contradiction.
Answer only JSON: {"consistent": true|false, "shift": true|false, "justified": true|false, "quote": "<the words showing it, or empty>"}`)
        } catch (e) { out.errors.push(`npc consistent ${a.label}>${b.label}: ${e.message}`) }
    }

    // five replies spread over the story part
    const picks = []
    for (let k = 0; k < 5 && storyTurns.length; k++) {
        const t = storyTurns[Math.min(storyTurns.length - 1, Math.round((k * (storyTurns.length - 1)) / 4))]
        if (!picks.includes(t)) picks.push(t)
    }
    const rules = rulesOf(story)
    for (const t of picks) {
        try {
            const a = await ask(cfg, `You are a strict canon reviewer for an interactive fiction game set in the world of the novel "${story.title}". The player is an original character, not a canon protagonist. Judge ONE narrator reply for canon fit: the world's rules, power system, terminology (as the Vietnamese translation names it), places, factions, timeline, how canon characters behave, and the game's own rules below. Report concrete slips only (quote the words), not style. Something the player did in an earlier turn (an item picked up, a place reached) is established, not a slip.${rec.persona ? " The player's own profile (persona) gives the character abilities and companions" + (companions(rec) ? companions(rec).replace(/^, and the character's own companions from the player's profile/, '') : '') + "; they belong to the character and are not a canon slip." : ''}

GAME RULES (excerpt of the card):
${rules}

THE STORY SO FAR (the player's earlier turns, oldest first): ${play.slice(0, play.indexOf(t)).filter((x) => x.phase !== 'creation').map((x) => x.text).join(' / ').slice(-1500)}

PREVIOUS REPLY (end): ${String(prevOf(t)).slice(-1500)}

CHARACTER PANEL NOW: ${Object.entries(t.vars ?? {}).filter(([k, v]) => /^st_/.test(k) && v && v !== 'null').map(([k, v]) => `${k.slice(3)}=${oneLine(v, 60)}`).join('; ')}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 6000)}

Also rate the Vietnamese prose as a reader of translated web novels would: natural, vivid, varied sentences, not a report, no repeated phrases, no awkward calques.

Answer only JSON: {"fit": 0-3 (3 = fully canon), "summary": "<one sentence>", "slips": [{"slip": "<quote + what is wrong>", "severity": "minor"|"major"}], "prose": 0-3 (3 = reads like a good novel), "proseNotes": "<one sentence with a quote>"}`, { maxTokens: 1500 })
            out.canon.push({ label: t.label, ...a })
        } catch (e) { out.errors.push(`canon ${t.label}: ${e.message}`) }
    }
    out.model = cfg.model
    if (cfg.fallbackWhy) { out.fallbackWhy = cfg.fallbackWhy; log(`[judge] ${cfg.fallbackWhy}`) }
    if (out.errors.length) log(`[judge] ${out.errors.length} judge call(s) failed: ${oneLine(out.errors[0], 200)}`)
    if (out.errors.length && !out.canon.length && !Object.keys(out.pauses).length) out.error = out.errors[0]
    return out
}
