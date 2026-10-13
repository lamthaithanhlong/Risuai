export const THINKING_PLACEHOLDER = '<Thoughts>\n…\n</Thoughts>\n'

/**
 * The message text while a reply streams in. Until the first word of the reply arrives, the visible
 * result is just a "Thinking..." line, so the thoughts are not put into the message at all: a constant
 * string means the message is not re-parsed and re-rendered on every network read (that was the jerking).
 * The finished message still gets the full thoughts, from the end-of-stream chunk.
 */
export function composeStreamChunk(reasoning: string, readed: Record<string, string>): Record<string, string> {
    if (!reasoning) {
        return readed
    }
    const hasReply = Object.entries(readed).some(([key, value]) => key !== '__tool_calls' && !!value)
    const chunk: Record<string, string> = {
        "0": hasReply ? `<Thoughts>\n${reasoning}\n</Thoughts>\n${readed["0"] ?? ''}` : THINKING_PLACEHOLDER,
    }
    if (readed["__tool_calls"]) {
        chunk["__tool_calls"] = readed["__tool_calls"]
    }
    return chunk
}
