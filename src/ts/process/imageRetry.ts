// A picture request to the router sometimes dies on the provider's side ("terminated (reset after 30s)", a dropped connection, a 5xx).
// Asking again a few seconds later usually works, and the reader only needs to see an error when it keeps failing. Slow limits
// ("reset after 30m") are not retried: waiting that long inside a chat reply is no use.

export type ImageResponse = { ok?: boolean; status?: number; data?: any }

const TRANSIENT = /terminated|timed? ?out|timeout|overloaded|temporar|unavailable|connection|socket|network|fetch failed|ECONN|EAI_AGAIN|bad gateway|gateway|\b5\d\d\b/i
const MAX_WAIT_SECONDS = 60

/** The error text of a response, whichever shape it has. */
export function imageErrorText(r: ImageResponse | null | undefined): string {
    if (!r) return 'no response'
    const d = r.data
    if (typeof d === 'string') return d
    const msg = d?.error?.message ?? d?.message ?? d?.error
    if (typeof msg === 'string') return msg
    try { return JSON.stringify(d ?? {}) } catch { return String(d) }
}

/** True when the response carries a picture. */
export function hasPicture(r: ImageResponse | null | undefined): boolean {
    return !!r?.data?.data?.[0]?.b64_json
}

/** How long to wait before asking again, in ms, or null when the failure is not worth a retry. */
export function retryDelayMs(r: ImageResponse | null | undefined): number | null {
    if (hasPicture(r)) return null
    const text = imageErrorText(r)
    const m = /reset after\s+(\d+)\s*(s|m|h)?/i.exec(text)
    if (m) {
        const seconds = Number(m[1]) * (m[2]?.toLowerCase() === 'h' ? 3600 : m[2]?.toLowerCase() === 'm' ? 60 : 1)
        return seconds <= MAX_WAIT_SECONDS ? (seconds + 3) * 1000 : null
    }
    if (r && r.ok === false && typeof r.status === 'number' && (r.status >= 500 || r.status === 429 || r.status === 0)) return 8000
    return TRANSIENT.test(text) ? 8000 : null
}

export type FallbackAttempt = { model: string; why: string }
export type FallbackResult = { response: ImageResponse; model: string; failures: FallbackAttempt[] }

/** "a, b ,,a" -> ["a", "b"] (order kept, empty and repeated names dropped). The primary model comes first. */
export function modelChain(primary: string, fallbacks: string | undefined): string[] {
    const out: string[] = []
    for (const m of [primary, ...(fallbacks ?? '').split(/[,\n]/)]) {
        const name = m.trim()
        if (name && !out.includes(name)) out.push(name)
    }
    return out
}

/** One line for the reader when every model failed: which models were tried and why each one failed. */
export function failureSummary(failures: FallbackAttempt[]): string {
    return 'Image generation failed on every model: ' + failures.map((f) => `${f.model}: ${f.why.slice(0, 140)}`).join(' | ')
}

/**
 * Tries the models in order; the first picture wins. A model that fails is skipped at once (a model-specific refusal such as "not
 * supported with this account" is not worth a wait). Only when every model failed and at least one failure looked temporary does it wait
 * the shortest stated time and go through the list again, up to `rounds` rounds in all.
 */
export async function requestWithFallback(
    models: string[],
    run: (model: string | undefined) => Promise<ImageResponse>,
    opts: { rounds?: number; sleep?: (ms: number) => Promise<void>; onFallback?: (model: string, why: string, next: string | undefined) => void } = {},
): Promise<FallbackResult> {
    const rounds = opts.rounds ?? 2
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const chain: (string | undefined)[] = models.length ? models : [undefined]   // no model configured: one plain request
    let failures: FallbackAttempt[] = []
    let last: ImageResponse = { ok: false, data: { error: { message: 'no attempt' } } }
    for (let round = 1; round <= rounds; round++) {
        failures = []
        let shortest: number | null = null
        for (let i = 0; i < chain.length; i++) {
            const model = chain[i]
            try {
                last = await run(model)
            } catch (e) {
                last = { ok: false, status: 0, data: { error: { message: `request failed: ${e instanceof Error ? e.message : String(e)}` } } }
            }
            if (hasPicture(last)) return { response: last, model: model ?? '', failures }
            const why = imageErrorText(last)
            failures.push({ model: model ?? '(default)', why })
            const wait = retryDelayMs(last)
            if (wait !== null && (shortest === null || wait < shortest)) shortest = wait
            opts.onFallback?.(model ?? '(default)', why.slice(0, 80), chain[i + 1])
        }
        if (shortest === null || round === rounds) break
        await sleep(shortest)
    }
    return { response: { ...last, ok: false, data: { error: { message: failureSummary(failures) } } }, model: '', failures }
}

/**
 * Reads a picture reply that came back as a stream. Asked with "Accept: text/event-stream", the router sends a progress event every few
 * seconds while the model draws (so no proxy or browser drops a connection that would otherwise sit silent for 30-60 s) and one
 * `event: done` whose data is the usual {data:[{b64_json}]} body. A router that ignores the header answers with plain JSON; that is read
 * as it is. A stream that ends without `done` was cut off and counts as a temporary failure.
 */
export function parseImageStream(text: string, status = 200): ImageResponse {
    const ok = status >= 200 && status < 300
    const trimmed = text.trimStart()
    if (trimmed.startsWith('{')) {
        try { return { ok, status, data: JSON.parse(trimmed) } } catch { /* fall through: not JSON after all */ }
    }
    let event = 'message'
    let done: any = undefined
    let error: string | undefined
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('event:')) { event = line.slice(6).trim(); continue }
        if (!line.startsWith('data:')) { if (line === '') event = 'message'; continue }
        const payload = line.slice(5).trim()
        if (event === 'done' || event === 'message') {
            try {
                const j = JSON.parse(payload)
                if (j?.data?.[0]?.b64_json) done = j
                else if (j?.error) error = typeof j.error === 'string' ? j.error : (j.error.message ?? JSON.stringify(j.error))
            } catch { /* a progress line or a partial chunk */ }
        } else if (event === 'error') {
            try { const j = JSON.parse(payload); error = j?.error?.message ?? j?.message ?? payload } catch { error = payload }
        }
    }
    if (done) return { ok: true, status, data: done }
    if (error) return { ok: false, status: ok ? 502 : status, data: { error: { message: error } } }
    if (!ok) return { ok: false, status, data: text.slice(0, 400) }
    return { ok: false, status: 0, data: { error: { message: 'picture stream ended without a picture (terminated)' } } }
}
