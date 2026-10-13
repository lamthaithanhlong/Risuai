const VIETNAMESE_LETTERS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/gi
const CJK_LETTERS = /[぀-ヿ一-鿿가-힣]/g
const ANY_LETTER = /[^\W\d_]/gu

/**
 * True when the text is already Vietnamese, so translating it to Vietnamese would only spend a model call
 * (measured 13-43 s on a reasoning model for a 20-character sentence) to get the same words back.
 * Vietnamese prose is 23-35% letters that only Vietnamese has (ă â đ ê ô ơ ư and tone marks); English has none.
 * Markup is ignored; text with Korean/Japanese/Chinese in it is left to be translated.
 */
export function looksVietnamese(text: string): boolean {
    const plain = text
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<Thoughts>[\s\S]*?<\/Thoughts>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
    const letters = plain.match(ANY_LETTER)?.length ?? 0
    if (letters < 6) {
        return false
    }
    const cjk = plain.match(CJK_LETTERS)?.length ?? 0
    const vietnamese = plain.match(VIETNAMESE_LETTERS)?.length ?? 0
    return cjk / letters < 0.1 && vietnamese / letters >= 0.15
}

// ---------------------------------------------------------------------------------------------------------------------
// Korean / Japanese / Chinese passages inside a message that is otherwise Vietnamese.
//
// looksVietnamese says "do not spend a model call on this message". A reply written in Vietnamese that quotes a line of Korean
// dialogue or a Korean system label passes that test, and the whole message was skipped, so the Korean stayed on screen
// (the orange quote and "헌터 전용 단말기" in the box). Such a message now has only its foreign passages translated.

const CJK_ONE = /[぀-ヿ一-鿿가-힣]/
// What may sit inside one passage between its CJK letters: spaces, digits and the punctuation that belongs to a quote.
const RUN_FILLER = /[\s\d…\.,!?~·\-—:;'"“”‘’「」『』（）()、。！？]/

export interface ForeignRun {
    start: number
    end: number
    text: string
}

/** The CJK passages of the visible text (tags, attributes and <style> blocks are not touched). */
export function findForeignRuns(html: string): ForeignRun[] {
    const runs: ForeignRun[] = []
    const hidden = /<style[\s\S]*?<\/style>|<[^>]+>/gi
    let from = 0
    const scan = (segStart: number, segEnd: number) => {
        const seg = html.slice(segStart, segEnd)
        let i = 0
        while (i < seg.length) {
            if (!CJK_ONE.test(seg[i])) {
                i++
                continue
            }
            let last = i                      // last CJK letter of this passage
            let j = i + 1
            while (j < seg.length && seg[j] !== '\n') {
                if (CJK_ONE.test(seg[j])) {
                    last = j
                } else if (!RUN_FILLER.test(seg[j])) {
                    break
                }
                j++
            }
            runs.push({ start: segStart + i, end: segStart + last + 1, text: seg.slice(i, last + 1) })
            i = last + 1
        }
    }
    for (let m = hidden.exec(html); m; m = hidden.exec(html)) {
        scan(from, m.index)
        from = m.index + m[0].length
    }
    scan(from, html.length)
    return runs
}

export function applyForeignRuns(html: string, runs: ForeignRun[], replacements: string[]): string {
    let out = html
    for (let k = runs.length - 1; k >= 0; k--) {
        const r = replacements[k]
        if (r) {
            out = out.slice(0, runs[k].start) + r + out.slice(runs[k].end)
        }
    }
    return out
}

/**
 * Translates only the CJK passages of a mostly-Vietnamese message. All passages go in one request as a numbered list
 * ([[1]] …); if the answer does not come back as a clean numbered list, each passage is asked alone. A passage that
 * cannot be translated is left as it was.
 */
export async function translateForeignRuns(
    body: string,
    translateBatch: (listing: string) => Promise<string>,
    translateOne: (run: string) => Promise<string>,
): Promise<string> {
    const runs = findForeignRuns(body)
    if (runs.length === 0) {
        return body
    }
    const listing = runs.map((r, i) => `[[${i + 1}]] ${r.text}`).join('\n')
    let results: string[] | null = null
    try {
        const answer = await translateBatch(listing)
        const found: string[] = []
        for (const line of answer.split('\n')) {
            const m = /^\s*\[\[(\d+)\]\]\s*(.*\S)\s*$/.exec(line)
            if (m) {
                found[Number(m[1]) - 1] = m[2]
            }
        }
        if (found.length === runs.length && found.every((t) => !!t && !CJK_ONE.test(t))) {
            results = found
        }
    } catch {
        results = null
    }
    if (!results) {
        results = []
        for (const r of runs) {
            try {
                const t = (await translateOne(r.text)).trim()
                results.push(t && !CJK_ONE.test(t) ? t : '')
            } catch {
                results.push('')
            }
        }
    }
    return applyForeignRuns(body, runs, results)
}
