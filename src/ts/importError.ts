/**
 * The error shown when a RisuRealm download or import fails. It used to be the bare string "Error while importing",
 * with the real cause only in the browser console, which nobody can read on a phone. Keep the prefix, add the cause,
 * and keep the Error (with its stack) so the dialog's "Show Error Details" has something to show.
 */
export function describeImportError(error: unknown): Error {
    const base = error instanceof Error ? error : new Error(typeof error === 'string' ? error : safeJson(error))
    const detail = new Error(`Error while importing: ${base.message || base.name || 'unknown error'}${reasons(base)}`, { cause: base })
    if (base.stack) {
        detail.stack = `${detail.message}\n--- cause ---\n${base.stack}`
    }
    return detail
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}

/** An AggregateError ("Failed to save 565 assets") hides every individual reason: list the distinct ones with counts. */
function reasons(error: Error): string {
    const inner = (error as { errors?: unknown }).errors
    if (!Array.isArray(inner) || inner.length === 0) {
        return ''
    }
    const counts = new Map<string, number>()
    for (const e of inner) {
        const text = e instanceof Error ? (e.message || e.name) : typeof e === 'string' ? e : safeJson(e)
        counts.set(text, (counts.get(text) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    const more = counts.size - top.length
    return ' [' + top.map(([text, n]) => `${text.slice(0, 160)} x${n}`).join('; ') + (more > 0 ? `; +${more} other reasons` : '') + ']'
}
