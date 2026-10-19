// Markdown scorecards: one per story (<story>.md) and the summary (summary.md).
import { oneLine, tally } from './score.mjs'

const mark = { PASS: 'PASS', FAIL: '**FAIL**', 'N/A': 'n/a', INFO: 'info' }
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|')

export function storyMarkdown(rec, checks) {
    const t = tally(checks)
    const L = []
    L.push(`# ${rec.title} — acceptance playtest ${rec.date}`, '')
    L.push(`Played through the real Risu page (headless Chromium) on a copy of the save, server :${rec.port}, ${rec.store} store, client ${rec.build}.`)
    L.push(`Model: ${rec.model.aiModel} slot "${rec.model.slot}" → \`${rec.model.requestModel}\` via ${rec.model.url.replace(/\/v1\/.*$/, '')}; Game Master ${rec.model.gameMaster ? 'on' : 'off'}, Jev referee ${rec.model.jevReferee ? 'on' : 'off'}. Judge: ${rec.judge?.model ?? 'not run'}${rec.judge?.fallbackWhy ? ` (${rec.judge.fallbackWhy})` : ''}.`)
    L.push(`Chats: step-by-step \`${rec.steps?.chatId ?? '-'}\`, surprise \`${rec.play?.chatId ?? '-'}\` (new chats on the copy; the owner's chats untouched). Duration ${Math.round((rec.ms ?? 0) / 60000)} min.`, '')
    if (rec.narrator) L.push(`**Narrator** — ${rec.narrator}.`, '')
    if (rec.diagnostic) L.push(`**DIAGNOSTIC RUN** — ${rec.diagnostic}. Not how the owner plays today.`, '')
    L.push(`**${t.pass} pass, ${t.fail} fail, ${t.na} n/a${t.info ? `, ${t.info} info` : ''}**`, '')
    L.push('| Check | Result | Summary |', '|---|---|---|')
    for (const c of checks) L.push(`| ${esc(c.title)} \`${c.id}\` | ${mark[c.status]} | ${esc(c.summary)} |`)
    L.push('', '## Evidence', '')
    for (const c of checks) {
        L.push(`### ${c.id} — ${mark[c.status]}`, '', c.summary, '')
        for (const e of c.evidence) L.push(`- ${e}`)
        L.push('')
    }
    if (rec.blocked?.length) { L.push('## Blocked', ''); for (const b of rec.blocked) L.push(`- ${b}`); L.push('') }
    L.push('## Transcript (first 300 characters of each reply as the player saw it)', '')
    for (const run of [rec.steps, rec.play]) {
        for (const x of run?.turns ?? []) {
            const main = (x.net ?? []).filter((n) => n.kind === 'main').at(-1)
            const ref = (x.net ?? []).filter((n) => n.type === 'referee').at(-1)
            const tags = [x.kind, main?.event != null ? `die ${main.event}` : '', main?.gmPace ? `GM ${main.gmPace}` : main?.gmSeed ? 'GM seed' : '', ref?.result?.note ? 'referee note' : '', x.ok ? `${Math.round(x.ms / 1000)} s` : 'NO REPLY'].filter(Boolean).join(', ')
            L.push(`**${x.label}** (${tags}) — player: ${oneLine(x.text, 200)}`, '', `> ${oneLine(x.shown || x.reply, 300)}`, '')
        }
    }
    return L.join('\n')
}

export function summaryMarkdown(date, results, meta) {
    const ids = []
    for (const r of results) for (const c of r.checks ?? []) if (!ids.includes(c.id)) ids.push(c.id)
    const L = [`# Risu acceptance playtest — ${date}`, '']
    L.push(`Command: \`${meta.command}\``, `Copy of the save: ${meta.runDir} (${meta.store} store); client ${meta.build}; model ${meta.model}.`, '')
    L.push(`| Check | ${results.map((r) => r.title).join(' | ')} |`, `|---|${results.map(() => '---').join('|')}|`)
    for (const id of ids) L.push(`| \`${id}\` | ${results.map((r) => mark[(r.checks ?? []).find((c) => c.id === id)?.status] ?? '-').join(' | ')} |`)
    L.push(`| **total** | ${results.map((r) => { const t = tally(r.checks ?? []); return `${t.pass} pass / ${t.fail} fail / ${t.na} n/a` }).join(' | ')} |`, '')
    for (const r of results) {
        L.push(`## ${r.title}`, '', r.error ? `Run error: ${r.error}` : `Scorecard: ${r.file}`, '')
        for (const c of (r.checks ?? []).filter((x) => x.status === 'FAIL')) L.push(`- FAIL \`${c.id}\`: ${c.summary}${c.evidence[0] ? ` — ${c.evidence[0]}` : ''}`)
        for (const b of r.blocked ?? []) L.push(`- blocked: ${b}`)
        L.push('')
    }
    return L.join('\n')
}
