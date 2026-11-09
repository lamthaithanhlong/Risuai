// Hard continuity gate after a story draft (measured 2026-11-08, New Chat 2 / Ollama 9B):
// "Tui nhìn 3 người họ" → narrator invented Yuuichi as boyfriend lead and labeled Aki/Naru girlfriend/cousin.
// Prompt rules alone were not enough; one rewrite note is added when these fire.

export type ContinuityHit = { rule: 'kinship' | 'viewpoint' | 'lead'; text: string }

// JS \b is ASCII-only; Vietnamese labels need Unicode letter boundaries.
const KINSHIP =
    /(?<![\p{L}\p{N}])(?:bạn\s*gái|bạn\s*trai|bạn\s*đời|người\s*yêu|crush|em\s*họ|anh\s*họ|chị\s*họ|vợ|chồng|girlfriend|boyfriend|wife|husband|cousin|mẹ|bố|cha|má|con\s+gái|con\s+trai|mother|father|mom|mum|dad|daughter|son)(?![\p{L}\p{N}])/giu

/** Player text is canon; prior assistant drafts are never authority. */
export function canonBlob(playerText: string, _previous: string[] = []): string {
    return String(playerText ?? '').toLowerCase()
}
function playerBlob(playerText: string): string { return canonBlob(playerText) }

export function kinshipHits(reply: string, playerText: string, _previous: string[] = []): ContinuityHit[] {
    const prior = playerBlob(playerText), hits: ContinuityHit[] = [], seen = new Set<string>()
    for (const m of String(reply ?? '').matchAll(KINSHIP)) {
        const label = m[0].replace(/\s+/g, ' ').trim().toLowerCase()
        if (!label || seen.has(label)) continue
        seen.add(label)
        if (!prior.includes(label)) hits.push({ rule: 'kinship', text: m[0].replace(/\s+/g, ' ').trim().slice(0, 80) })
    }
    return hits
}
export function scrubKinship(reply: string, playerText: string, previous: string[] = []): string {
    let scrubbed = String(reply ?? '')
    for (const { text } of kinshipHits(scrubbed, playerText, previous)) {
        const pattern = text.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
        scrubbed = scrubbed.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu'), 'người')
    }
    return scrubbed.replace(/người\s+người/giu, 'người')
}

export function viewpointHits(reply: string, playerText: string, playerName = ''): ContinuityHit[] {
    if (!/(?<![\p{L}\p{N}])(?:nhìn|quan\s*sát|ngó|liếc|theo dõi|observe|watch|look(?:ing)?\s+at)(?![\p{L}\p{N}])/iu.test(String(playerText ?? ''))) return []
    const text = String(reply ?? ''), low = text.toLowerCase(), name = String(playerName ?? '').trim(), first = name.split(/\s+/)[0] || ''
    const playerPresent = (name.length >= 2 && low.includes(name.toLowerCase())) || (first.length >= 2 && new RegExp(`[^\\p{L}]${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}]`, 'iu').test(` ${low} `))
    const hub = /(?<![\p{L}\p{N}])(?:bạn\s*gái|bạn\s*trai|bạn\s*đời|em\s*họ)(?![\p{L}\p{N}]).{0,40}(?<![\p{L}\p{N}])(?:của|của\s+mình)(?![\p{L}\p{N}])/iu.test(text) || /(?<![\p{L}\p{N}])(?:bị|được)\s+bạn\s*gái(?![\p{L}\p{N}])/iu.test(text)
    if (!hub || playerPresent) return []
    return [{ rule: 'viewpoint', text: text.replace(/\s+/g, ' ').trim().slice(0, 120) || 'viewpoint recentered off the player' }]
}

const LEAD_OBSERVE = /(?<![\p{L}\p{N}])(?:nhìn|quan\s*sát|ngó|liếc|theo\s*dõi|observe|watch|look(?:ing)?\s+at)(?![\p{L}\p{N}])/iu
export function leadHits(reply: string, playerText: string, playerName = '', _previous: string[] = []): ContinuityHit[] {
    if (!LEAD_OBSERVE.test(String(playerText ?? ''))) return []
    const text = String(reply ?? ''), prior = playerBlob(playerText), player = String(playerName ?? '').trim().toLowerCase(), playerFirst = player.split(/\s+/)[0] || '', proper = String.raw`\p{Lu}[\p{L}'-]{1,30}`, hits: ContinuityHit[] = []
    const add = (s: string) => { if (!prior.includes(s.toLowerCase())) hits.push({ rule: 'lead', text: s }) }
    const named = (pattern: RegExp, transform: (m: RegExpMatchArray) => string) => { for (const m of text.matchAll(pattern)) { const n = (m[1] ?? '').toLowerCase(); if (n && n !== player && n !== playerFirst) add(transform(m)) } }
    named(new RegExp(String.raw`(?<![\p{L}\p{N}])(?:bám\s+lấy|níu\s+lấy|ôm\s+lấy|dựa\s+vào|bám\s+vào)\s+(${proper})(?![\p{L}\p{N}])`, 'giu'), m => m[0])
    for (const m of text.matchAll(/(?<![\p{L}\p{N}])điểm\s+tựa(?![\p{L}\p{N}])/giu)) if (text.slice(Math.max(0,m.index!-40),m.index!+80).match(new RegExp(String.raw`(?<![\p{L}\p{N}])(${proper})(?![\p{L}\p{N}])`,'u'))) add(m[0])
    named(new RegExp(String.raw`(?<![\p{L}\p{N}])người\s+cũ\s+(${proper})(?![\p{L}\p{N}])`,'giu'), m=>m[0])
    named(new RegExp(String.raw`(?<![\p{L}\p{N}])siết\s+[\p{L}\p{N}\s]{0,20}áo\s+của\s+(${proper})(?![\p{L}\p{N}])`,'giu'), m=>m[0])
    for (const m of text.matchAll(/(?<![\p{L}\p{N}])đi\s+cùng\s+(?:hai|2)\s+cô\s+gái(?![\p{L}\p{N}])/giu)) add(m[0])
    const contact = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:chạm|đặt|tựa|khoác|nắm|bám)\s+(?:(?:nhẹ\s+)?(?:lên\s+)?(?:tay|cánh\s+tay|vai)|(?:tay|cánh\s+tay|vai)(?:\s+(?:nhẹ|lên))?)\s+(?:của\s+)?(${proper}|cậu|anh|cô|nàng|chàng|bạn|him|her|them)(?![\p{L}\p{N}])`,'giu')
    // Soft contact with the PC (or any body) on observe turns — do not skip player name.
    for (const m of text.matchAll(contact)) {
        if (!prior.includes(m[0].toLowerCase())) hits.push({ rule: 'lead', text: m[0] })
    }
    for (const m of text.matchAll(/(?<![\p{L}\p{N}])đội\s+hình\s+cố\s+định(?![\p{L}\p{N}])/giu)) {
        const after = text.slice(m.index! + m[0].length, Math.min(text.length, m.index! + m[0].length + 40))
        const name = after.match(new RegExp(String.raw`(?<![\p{L}\p{N}])(${proper})(?![\p{L}\p{N}])`, 'u'))?.[1]
        if (name && name.toLowerCase() !== player && name.toLowerCase() !== playerFirst) add(`${m[0]} ${name}`)
    }
    return hits
}

export function scrubLead(reply: string, playerText: string, previous: string[] = [], playerName = ''): string {
    if (!leadHits(reply, playerText, playerName, previous).length) return String(reply ?? '')
    let s = String(reply ?? ''); const proper = String.raw`\p{Lu}[\p{L}'-]{1,30}`, player = String(playerName ?? '').trim().toLowerCase(), first = player.split(/\s+/)[0] || '', prior = playerBlob(playerText)
    const replace = (re: RegExp, fn: (full: string, name: string) => string) => { s=s.replace(re,(full,name)=> { const n=String(name??'').toLowerCase(); if(n===player||n===first||prior.includes(full.toLowerCase())) return full; return fn(full,name) }) }
    replace(new RegExp(String.raw`(?<![\p{L}\p{N}])(?:bám\s+lấy|níu\s+lấy|ôm\s+lấy|dựa\s+vào|bám\s+vào)\s+(${proper})(?![\p{L}\p{N}])`,'giu'),(_f,n)=>`đứng cạnh ${n}`)
    s=s.replace(/(?<![\p{L}\p{N}])điểm\s+tựa(?![\p{L}\p{N}])/giu,'người cạnh bên')
    replace(new RegExp(String.raw`(?<![\p{L}\p{N}])người\s+cũ\s+(${proper})(?![\p{L}\p{N}])`,'giu'),(_f,n)=>String(n))
    replace(new RegExp(String.raw`(?<![\p{L}\p{N}])siết\s+[\p{L}\p{N}\s]{0,20}áo\s+của\s+(${proper})(?![\p{L}\p{N}])`,'giu'),(_f,n)=>`nắm áo của ${n}`)
    s=s.replace(/(?<![\p{L}\p{N}])đi\s+cùng\s+(?:hai|2)\s+cô\s+gái(?![\p{L}\p{N}])/giu, m=>prior.includes(m.toLowerCase())?m:'đi cùng hai người')
    s=s.replace(/(?<![\p{L}\p{N}])đội\s+hình\s+cố\s+định(?![\p{L}\p{N}])/giu,(m, offset) => {
        if (prior.includes(m.toLowerCase())) return m
        const after = s.slice(offset + m.length, offset + m.length + 40)
        const name = after.match(new RegExp(String.raw`(?<![\p{L}\p{N}])(${proper})(?![\p{L}\p{N}])`,'u'))?.[1]
        return name ? `nhóm ${name}` : 'nhóm'
    })
    {
        const contactRe = new RegExp(
            String.raw`(?<![\p{L}\p{N}])(?:chạm|đặt|tựa|khoác|nắm|bám)\s+(?:(?:nhẹ\s+)?(?:lên\s+)?(?:tay|cánh\s+tay|vai)|(?:tay|cánh\s+tay|vai)(?:\s+(?:nhẹ|lên))?)\s+(?:của\s+)?(${proper}|cậu|anh|cô|nàng|chàng|bạn|him|her|them)(?![\p{L}\p{N}])`,
            'giu',
        )
        s = s.replace(contactRe, (full, name) => {
            if (prior.includes(full.toLowerCase())) return full
            return `đứng cạnh ${name}`
        })
    }
    
    return s
}

export function continuityHits(reply: string, playerText: string, previous: string[] = [], playerName = ''): ContinuityHit[] {
    return [...kinshipHits(reply, playerText, previous), ...viewpointHits(reply, playerText, playerName), ...leadHits(reply, playerText, playerName, previous)]
}
export function continuityNote(hits: ContinuityHit[]): string {
    if (!hits.length) return ''
    const parts = hits.map(h => { const t=h.text.toLowerCase(); if(h.rule==='kinship') return `invented kinship/romance label "${h.text}"`; if(h.rule==='lead'){ if(t.includes('người cũ')) return `invented "người cũ" framing "${h.text}"`; if(t.includes('siết')&&t.includes('áo của')) return `invented cling-grip framing "${h.text}"`; if(/(?:tay|vai)/u.test(t)) return `invented soft arm/shoulder contact "${h.text}"`; if(t.includes('đi cùng')&&t.includes('cô gái')) return `invented couple walk framing "${h.text}"`; if(t.includes('đội hình cố định')) return `invented fixed-lineup framing "${h.text}"`; return `invented romantic/emotional hub framing "${h.text}"` } return `viewpoint left the player ("${h.text.slice(0,80)}")` })
    return `\n\n[Rewrite (hidden, never named): the last draft had: ${parts.join(' / ')}. Player-authored text is the only continuity canon; AI-only leads and kinship wording are void and must not authorize repetition. Preserve player-stated labels such as bạn gái; do not invent other kinship labels or a substitute male lead; do not frame observed people as "người cũ", gripping clothing, walking as a couple, or a fixed lineup around a named hub; describe the people the player looked at from the player's view with neutral observation.]`
}
