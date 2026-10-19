// Drives the real Risu page in headless Chromium the way the owner plays: log in, pick the card, New Chat, type, press send,
// wait for the reply. Reads what the player sees (the chat DOM) and what the app keeps (the chat's variables, through the page's
// own plugin API getChar()), and records the model requests the page makes (the turn's dice, the GM note, the referee note).
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const HELPER = [
    [/^You are a literary translator/, 'translate'],
    [/^Below is the index of a story's lore/, 'lore-pick'],
    [/^Below are the rules of an interactive story/, 'rules-helper'],
]

/** the text of a streamed (SSE) or plain chat-completions response */
export function completionText(body) {
    if (!body) return ''
    const t = String(body)
    if (/^\s*data:/m.test(t)) {
        let out = ''
        for (const line of t.split('\n')) {
            const m = /^data:\s*(.*)$/.exec(line.trim())
            if (!m || m[1] === '[DONE]') continue
            try { const j = JSON.parse(m[1]); out += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text ?? '' } catch { /* keep going */ }
        }
        return out
    }
    try { const j = JSON.parse(t); return j.choices?.[0]?.message?.content ?? '' } catch { return '' }
}

/** what the acceptance needs out of one model request body (never the headers: they carry the key) */
export function readMainRequest(bodyText) {
    let body
    try { body = JSON.parse(bodyText) } catch { return null }
    const msgs = Array.isArray(body.messages) ? body.messages : []
    const first = typeof msgs[0]?.content === 'string' ? msgs[0].content : ''
    for (const [re, kind] of HELPER) if (re.test(first)) return { kind }
    const all = msgs.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    const lu = typeof lastUser?.content === 'string' ? lastUser.content : ''
    const ev = /\* Event: (\d+|NEW|quiet)\b/.exec(all)
    const kindDie = /\* Kind: ([^\n]*?)\.?\n/.exec(all)
    // '[GM, hidden …' (038fa4dd) and '[GM (hidden, never named) …' (dc7fadf0)
    const gmAt = lu.search(/\[GM[ ,(]/)
    const pace = /Dice: (QUIET|BUILD|ADVANCE|ESCALATE)/.exec(lu)
    const ref = /\[Referee: ([^\]]*)\]/.exec(lu)
    if (!ev && gmAt < 0 && all.length < 20000) return { kind: 'other', model: body.model }
    return {
        kind: 'main', model: body.model, stream: !!body.stream,
        event: ev ? ev[1] : null,
        eventNew: ev ? (ev[1] === 'NEW' ? true : ev[1] === 'quiet' ? false : Number(ev[1]) <= 20) : null,
        eventKind: kindDie ? kindDie[1].trim() : null,
        gmNote: gmAt >= 0, sideFocus: /focus: the side \(|the side's first order/.test(lu), gmSeed: /No arc yet: seed one/.test(lu), gmPace: pace ? pace[1] : null,
        referee: ref ? ref[1] : null,
        storyCheckLine: /\[Story consistency check:/.test(lu),
        lastUserHead: lu.slice(0, 400),
    }
}

export class Player {
    constructor({ port, password, outDir, label, log = console.log }) {
        Object.assign(this, { port, password, outDir, label, log })
        this.base = `http://localhost:${port}`
        this.net = []
        this.auth = ''
    }

    async open() {
        this.browser = await chromium.launch({ headless: true })
        this.ctx = await this.browser.newContext({ viewport: { width: 1400, height: 1000 } })
        // This throwaway profile carries the owner's existing acceptance of the app's terms (tos4, alert.ts) and keeps the page
        // from offering any account sync (dosync=avoid, autoStorage.ts; the Node server never syncs anyway).
        await this.ctx.addInitScript(() => { try { localStorage.setItem('tos4', 'true'); localStorage.setItem('dosync', 'avoid') } catch { /* private */ } })
        this.page = await this.ctx.newPage()
        this.page.on('pageerror', (e) => this.log(`[page] ${String(e.message || e).slice(0, 200)}`))
        this.page.on('request', (req) => {
            const a = req.headers()['risu-auth']
            if (a && req.url().startsWith(this.base) && a.split('.').length === 3) this.auth = a
        })
        this.page.on('requestfinished', (req) => this.#capture(req).catch(() => {}))
        await this.page.goto(this.base + '/')
        await this.page.waitForSelector('text=Input your password', { timeout: 90000 })
        await this.page.locator('#alert-input, input').first().fill(this.password)
        await this.page.getByRole('button', { name: 'OK' }).click()
        await this.page.waitForSelector('text=My Stories', { timeout: 120000 })
        await this.page.waitForFunction(() => !!globalThis.__pluginApis__?.getChar, null, { timeout: 60000 })
    }

    async #capture(req) {
        const url = req.url()
        if (req.method() !== 'POST') return
        const at = Date.now()
        if (/\/chat\/completions/.test(url)) {
            const info = readMainRequest(req.postData() || '')
            if (!info) return
            let text = null
            if (info.kind === 'main') { try { text = completionText(await (await req.response())?.text()) } catch { text = null } }
            this.net.push({ at, type: 'completion', ...info, response: text })
        } else if (/\/api\/story\/referee/.test(url)) {
            let r = null
            try { r = await (await req.response())?.json() } catch { /* none */ }
            this.net.push({ at, type: 'referee', turn: (() => { try { return JSON.parse(req.postData() || '{}').turn } catch { return '' } })(), result: r })
        } else if (/\/v1\/systemone/.test(url)) {
            let r = null
            try { r = await (await req.response())?.json() } catch { /* none */ }
            this.net.push({ at, type: 'jev-guard', result: r })
        } else if (/images\/generations|image-jobs/.test(url)) {
            this.net.push({ at, type: 'image', url: url.replace(/\?.*$/, ''), status: (await req.response())?.status() ?? null })
        }
    }

    /** the current character and chat as the app holds them */
    async state() {
        return this.page.evaluate(() => {
            const c = globalThis.__pluginApis__.getChar()
            if (!c) return null
            const chat = c.chats?.[c.chatPage]
            const vars = {}
            for (const [k, v] of Object.entries(chat?.scriptstate ?? {})) vars[k.replace(/^\$/, '')] = v === null || v === undefined ? '' : String(v)
            return {
                chaId: c.chaId, name: c.name, chatId: chat?.id, chatName: chat?.name, chatCount: c.chats?.length ?? 0,
                vars, isStreaming: !!chat?.isStreaming,
                messages: (chat?.message ?? []).map((m) => ({ role: m.role, data: String(m.data ?? ''), time: m.time ?? null })),
            }
        })
    }

    /** what the player sees, per message index (-1 = the first message) */
    async dom() {
        return this.page.evaluate(() => {
            const out = []
            for (const el of document.querySelectorAll('.risu-chat[data-chat-index]')) {
                const idx = Number(el.getAttribute('data-chat-index'))
                const texts = [...el.querySelectorAll('.chattext')]
                const panel = el.querySelector('details.x-risu-sp')
                const prose = texts.map((t) => {
                    const c = t.cloneNode(true)
                    c.querySelectorAll('details, style, script').forEach((n) => n.remove())
                    // a strip of pictures with short captions (the scene's portraits, "Người · Lính") is not prose
                    for (const n of [...c.querySelectorAll('*')]) {
                        const k = n.querySelectorAll('img').length
                        if (k && (n.textContent || '').trim().length <= 24 * k && n.parentNode) n.remove()
                    }
                    return c.innerText
                }).join('\n').trim()
                const imgs = [...el.querySelectorAll('.chattext img, img.risu-inlay, .inlay img')].filter((i) => !i.closest('details'))
                out.push({
                    idx, prose, full: texts.map((t) => t.innerText).join('\n'),
                    panel: panel ? { summary: panel.querySelector('summary')?.innerText ?? '', text: panel.innerText.slice(0, 3000) } : null,
                    images: imgs.map((i) => ({ src: (i.getAttribute('src') || '').slice(0, 120), complete: i.complete, w: i.naturalWidth, h: i.naturalHeight })),
                })
            }
            return out
        })
    }

    /**
     * Scroll every message into view (lazy pictures load only on screen), then read the chat. Measured 2026-10-19: the chat
     * renders its last 30 messages and the older ones only when its scroller (.default-chat-screen, column-reverse) comes within
     * 100 px of the top, which scrolling a message into view never did: the first story reply's picture was never on screen and
     * was scored "not loaded" in three runs, while the same picture loads as soon as it is scrolled to. So the scroller is taken
     * to the top until no more messages come, then each message is visited by its own index, waiting for its pictures.
     */
    async domAll() {
        const rows = this.page.locator('.risu-chat[data-chat-index]')
        let last = -1
        for (let k = 0; k < 40; k++) {
            const n = await rows.count()
            if (n === last) break
            last = n
            await this.page.evaluate(() => { const s = document.querySelector('.default-chat-screen'); if (s) { s.scrollTop = -s.scrollHeight; s.dispatchEvent(new Event('scroll')) } })
            await this.page.waitForTimeout(900)
        }
        const indexes = [...new Set(await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-chat-index')))))].sort((a, b) => b - a)
        for (const i of indexes) {
            const row = this.page.locator(`.risu-chat[data-chat-index="${i}"]`).first()
            await row.scrollIntoViewIfNeeded().catch(() => {})
            await row.evaluate((e) => Promise.all([...e.querySelectorAll('img')].map((img) => img.complete ? null
                : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 4000) })))).catch(() => {})
            await this.page.waitForTimeout(100)
        }
        await this.page.waitForTimeout(1500)
        return this.dom()
    }

    async busy() { return (await this.page.locator('.loadmove').count()) > 0 }

    /** an error alert's text, dismissed; '' when there is none */
    async takeError() {
        const h = this.page.locator('h2.text-red-700', { hasText: 'Error' })
        if (!(await h.count())) return ''
        const box = h.first().locator('xpath=..')
        const text = (await box.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)
        await box.getByRole('button', { name: 'OK' }).first().click().catch(() => {})
        return text || 'Error'
    }

    async selectCard(cardId, nameMatch) {
        const tryIt = async (loc) => {
            await loc.click({ timeout: 10000 }).catch(() => {})
            await this.page.waitForTimeout(2500)
            const s = await this.state()
            return s?.chaId === cardId
        }
        const entries = this.page.getByText(nameMatch, { exact: false })
        const n = await entries.count()
        for (let i = 0; i < n; i++) if (await tryIt(entries.nth(i))) return true
        // the sidebar: each avatar sits next to its "Character actions <name>" button
        const avatars = this.page.locator('[aria-label^="Character actions"]')
        const m = await avatars.count()
        for (let i = 0; i < m; i++) if (await tryIt(avatars.nth(i).locator('xpath=..'))) return true
        throw new Error(`card ${cardId} (${nameMatch}) could not be selected`)
    }

    async newChat() {
        const before = await this.state()
        await this.page.getByRole('button', { name: 'New Chat', exact: true }).click()
        for (let i = 0; i < 30; i++) {
            await this.page.waitForTimeout(500)
            const s = await this.state()
            if (s && s.chatId !== before?.chatId && s.messages.length === 0) return s
        }
        throw new Error('New Chat did not open an empty chat')
    }

    /**
     * Type one turn and wait for the reply. Returns { ok, ms, errors[], net[] }. A failed request (an error alert, e.g. quota or
     * 503) is retried by pressing send on an empty input, which makes the app answer the player's message already in the chat.
     */
    async turn(text, { timeoutMs = 8 * 60 * 1000, retries = 3, backoff = [30000, 90000, 180000] } = {}) {
        const start = await this.state()
        const want = start.messages.length + 2
        const netFrom = this.net.length
        const errors = []
        const t0 = Date.now()
        await this.page.locator('textarea.text-input-area').fill(text)
        await this.page.locator('.button-icon-send').click()
        let attempt = 0
        let lastText = null, stable = 0
        while (Date.now() - t0 < timeoutMs) {
            await this.page.waitForTimeout(2000)
            const err = await this.takeError()
            if (err) {
                errors.push({ at: Math.round((Date.now() - t0) / 1000), error: err })
                this.log(`[${this.label}] request failed: ${err.slice(0, 160)}`)
                if (attempt >= retries) break
                // a quota or 503 needs time; an app-side refusal (the prompt over the context size: the lore picked varies per try)
                // is retried at once
                const appSide = /Max Context Size|minimum required token/i.test(err)
                await this.page.waitForTimeout(appSide ? 3000 : backoff[Math.min(attempt, backoff.length - 1)])
                attempt++
                while (await this.busy()) await this.page.waitForTimeout(1000)
                const s = await this.state()
                if (s.messages.length < want && s.messages.at(-1)?.role === 'user') {
                    await this.page.locator('textarea.text-input-area').fill('')
                    await this.page.locator('.button-icon-send').click()
                }
                stable = 0
                continue
            }
            if (await this.busy()) { stable = 0; continue }
            const s = await this.state()
            const last = s.messages.at(-1)
            if (s.messages.length < want || last?.role !== 'char' || !last.data.trim() || s.isStreaming) { stable = 0; continue }
            const d = await this.dom()
            const shown = d.find((x) => x.idx === s.messages.length - 1)?.full ?? ''
            const sig = last.data + '\u0000' + shown
            if (sig === lastText) stable++; else { stable = 0; lastText = sig }
            if (stable >= 3) return { ok: true, ms: Date.now() - t0, errors, net: this.net.slice(netFrom) }
        }
        return { ok: false, ms: Date.now() - t0, errors, net: this.net.slice(netFrom), timeout: Date.now() - t0 >= timeoutMs }
    }

    /** GET /api/story/:chatId/check with the page's own auth token */
    async storyApi(chatId, what = 'check') {
        if (!this.auth) return { status: 'no-auth' }
        try {
            const r = await fetch(`http://127.0.0.1:${this.port}/api/story/${chatId}${what ? '/' + what : ''}`, { headers: { 'risu-auth': this.auth }, signal: AbortSignal.timeout(30000) })
            return { http: r.status, ...(await r.json().catch(() => ({}))) }
        } catch (e) {
            return { status: 'error', error: String(e.message || e) }
        }
    }

    async shot(name) {
        const p = path.join(this.outDir, `${this.label}-${name}.png`)
        await this.page.screenshot({ path: p }).catch(() => {})
        return p
    }

    async close() { await this.browser?.close().catch(() => {}) }
}

