// Tap a foreign word in a chat message to hear it. Works on any message, the learner's own too ("我 有 问题" typed by the
// player has no reading markup), so the word is found from the text at the tap, not from markup: the run of foreign script
// around the tapped character (Japanese, Chinese, Korean, Thai), or the «guillemet» phrase for Spanish and French (the learning
// note puts those in «»; a Vietnamese word next to it must not be read in a Spanish voice). Reading lines are left out: the
// Việt-ji line under each word and furigana in <rt>.

import { speakForeign, warmVoice, type StreamDeps } from './ttsStream'
import { isLatinLang } from './vietji'

const FOREIGN = /[぀-ヿ㐀-鿿豈-﫿가-힣ᄀ-ᇿ㄰-㆏々〆ー\u0E01-\u0E4E]/
const JOINS = /[ 　、。，．！？!?・…「」『』〜~,.]/
const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/
const KANA = /[぀-ヿ]/
const THAI = /[\u0E01-\u0E4E]/

/** The foreign text at position `pos` of a message's text, and its language; null when the tap is not on one. */
export function foreignAt(text: string, pos: number, lang: string): { text: string; lang: string } | null {
    if (!text) return null
    let p = Math.min(Math.max(pos, 0), text.length - 1)
    if (!FOREIGN.test(text[p]) && p > 0 && FOREIGN.test(text[p - 1])) p--
    if (FOREIGN.test(text[p])) {
        const joins = (c: string) => FOREIGN.test(c) || JOINS.test(c)
        let a = p, b = p + 1
        for (;;) {                                   // left, over foreign script, spaces between words and [readings]
            if (a > 0 && joins(text[a - 1])) { a--; continue }
            if (a > 0 && text[a - 1] === ']') { const o = text.lastIndexOf('[', a - 1); if (o >= 0 && a - o <= 42 && !text.slice(o, a).includes('\n')) { a = o; continue } }
            break
        }
        for (;;) {
            if (b < text.length && joins(text[b])) { b++; continue }
            if (b < text.length && text[b] === '[') { const c = text.indexOf(']', b); if (c >= 0 && c - b <= 41 && !text.slice(b, c).includes('\n')) { b = c + 1; continue } }
            break
        }
        const run = text.slice(a, b).replace(/\[[^\]\n]{1,40}\]/g, '').replace(/^[\s、。，,.!?！？」』]+|[\s「『]+$/g, '').trim()
        if (!run) return null
        const runLang = HANGUL.test(run) ? 'ko' : THAI.test(run) ? 'th' : KANA.test(run) ? 'ja' : lang === 'ja' ? 'ja' : 'zh'
        return { text: run, lang: runLang }
    }
    if (isLatinLang(lang)) {
        const open = text.lastIndexOf('«', p), close = text.indexOf('»', p)
        if (open < 0 || close < 0) return null
        if (text.slice(open, p).includes('»') || text.slice(p, close).includes('«')) return null
        const phrase = text.slice(open + 1, close).trim()
        return phrase ? { text: phrase, lang } : null
    }
    return null
}

const READING_MARK = 'letter-spacing:.03em'                 // part of the Việt-ji line's style (vietji.ts VJ_STYLE)

function skipped(node: Node, root: Element): boolean {
    for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
        if (el.tagName === 'RT' || el.tagName === 'RP') return true
        if ((el.getAttribute('style') ?? '').includes(READING_MARK)) return true
    }
    return false
}

/** The message's spoken text and where in it the point (x, y) falls. */
function textAtPoint(root: Element, x: number, y: number): { text: string; pos: number } | null {
    const doc = root.ownerDocument as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
    let node: Node | null = null, offset = 0
    if (doc.caretPositionFromPoint) {
        const c = doc.caretPositionFromPoint(x, y); if (c) { node = c.offsetNode; offset = c.offset }
    } else if (doc.caretRangeFromPoint) {
        const r = doc.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; offset = r.startOffset }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node) || skipped(node, root)) return null
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let text = '', pos = -1
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (skipped(n, root)) continue
        if (n === node) pos = text.length + offset
        text += n.textContent ?? ''
    }
    return pos < 0 ? null : { text, pos }
}

/** The foreign phrases of the line a speaker button ends (readings left out), joined: what the button reads. */
export function foreignOfLine(text: string, lang: string): string {
    const out: string[] = []
    if (isLatinLang(lang)) {
        for (const m of text.matchAll(/«([^»]+)»/g)) out.push(m[1].trim())
    }
    for (const m of text.matchAll(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7a3\u0e01-\u0e4e々〆ー][\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7a3\u0e01-\u0e4e々〆ー \u3000、。，！？!?・…〜~]*/g)) {
        const run = m[0].trim()
        if (run) out.push(run)
    }
    return out.join(' ')
}

/** Taps closer than MIN_GAP_MS, or more than PER_MINUTE in a minute, are dropped (the TTS server also limits). */
const MIN_GAP_MS = 300, PER_MINUTE = 20
const recent: number[] = []
export function allowTap(now = Date.now()): boolean {
    while (recent.length && now - recent[0] > 60_000) recent.shift()
    if (recent.length && now - recent[recent.length - 1] < MIN_GAP_MS) return false
    if (recent.length >= PER_MINUTE) return false
    recent.push(now)
    return true
}

let installed: ((e: MouseEvent) => void) | null = null

/** Listens for taps on chat messages (once for the page); getLang is read at each tap. */
export function installTapToSpeak(deps: StreamDeps, getLang: () => string) {
    if (installed) document.removeEventListener('click', installed, true)
    installed = (e: MouseEvent) => {
        const target = e.target as Element | null
        const root = target?.closest?.('.chattext')
        if (!root) return
        // the speaker button at the end of a line: read the line's foreign phrases
        if (target!.getAttribute('title') === 'Nghe' && target!.textContent === '🔊') {
            const block = target!.closest('p, div, li, blockquote') ?? root
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
            let text = ''
            for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!skipped(n, block)) text += n.textContent ?? ''
            const say = foreignOfLine(text, getLang())
            if (say && allowTap()) {
                const lang = /[\uac00-\ud7a3]/.test(say) ? 'ko' : /[\u0e01-\u0e4e]/.test(say) ? 'th' : /[\u3040-\u30ff]/.test(say) ? 'ja' : getLang()
                speakForeign(deps, say, lang).catch((err) => console.warn('[tts] speaker button failed', err))
            }
            return
        }
        if (target!.closest('a, button, input, textarea, select, summary, label')) return
        if (!(globalThis.getSelection?.()?.isCollapsed ?? true)) return      // selecting text, not tapping
        const at = textAtPoint(root, e.clientX, e.clientY)
        const hit = at && foreignAt(at.text, at.pos, getLang())
        if (!hit || !allowTap()) return
        speakForeign(deps, hit.text, hit.lang).catch((err) => console.warn('[tts] tap to speak failed', err))
    }
    document.addEventListener('click', installed, true)
    void warmVoice(deps, getLang())
}
