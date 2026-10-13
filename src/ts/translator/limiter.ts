/**
 * Runs at most `max` tasks at once and starts the rest in the order they were asked for.
 * Opening a chat asks for ~30 translations together; the newest messages are asked first, so they finish first
 * and the owner is not left with a screen of raw text while old messages queue ahead of them.
 */
export function createLimiter(max: number) {
    let running = 0
    const waiting: (() => void)[] = []

    const release = () => {
        running--
        waiting.shift()?.()
    }

    return async function run<T>(task: () => Promise<T>): Promise<T> {
        if (running >= max) {
            await new Promise<void>((resolve) => waiting.push(resolve))
        }
        running++
        try {
            return await task()
        } finally {
            release()
        }
    }
}

/** The leading <Thoughts> block of a reply (the model's reasoning) and what follows it. */
export function splitThoughts(text: string): { thoughts: string, body: string } {
    const m = text.match(/^\s*<Thoughts>[\s\S]*?<\/Thoughts>\n*/)
    return m ? { thoughts: m[0], body: text.slice(m[0].length) } : { thoughts: '', body: text }
}
