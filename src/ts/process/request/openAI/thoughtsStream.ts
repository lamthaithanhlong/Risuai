export const THINKING_PLACEHOLDER = '<Thoughts>\n…\n</Thoughts>\n'

/**
 * The message text while a reply streams in. The model's reasoning goes into the message as an open <Thoughts> block as it is
 * written, so the thought panel shows it live; the chat only shows the reply (splitCoT takes the thought out before the reply is
 * parsed, so growing thought text costs the chat nothing). When the first word of the reply arrives the block is closed and the
 * reply follows it. A reasoning-only stream never produces a reply text, so it stays an open block, which the empty-reply guard
 * treats as "no reply yet".
 */
export function composeStreamChunk(reasoning: string, readed: Record<string, string>): Record<string, string> {
    if (!reasoning) {
        return readed
    }
    const hasReply = Object.entries(readed).some(([key, value]) => key !== '__tool_calls' && !!value)
    const chunk: Record<string, string> = {
        "0": hasReply ? `<Thoughts>\n${reasoning}\n</Thoughts>\n${readed["0"] ?? ''}` : `<Thoughts>\n${reasoning}`,
    }
    if (readed["__tool_calls"]) {
        chunk["__tool_calls"] = readed["__tool_calls"]
    }
    return chunk
}
