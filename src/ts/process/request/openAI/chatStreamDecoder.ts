// Decodes the Server-Sent-Events body of an OpenAI-style chat completion into the text read so far.
//
// The first version of this (inside getTranStream) rebuilt the whole reply from the whole buffer on every network chunk. That is
// quadratic: measured on a Mac, 900 chunks (a 3 000-character reply with its reasoning) cost 239 ms of parsing, 2 000 chunks 1.2 s,
// 4 000 chunks 4.6 s, and a phone is several times slower, so a long reply made the screen lag behind the model. This decoder
// keeps its state between chunks and handles each event once. The framing (chunks cut anywhere, CRLF, "data:" with or without a
// space, comments) is done by eventsource-parser, which follows the SSE specification.
//
// Not EventSource itself: the browser's EventSource only sends GET without headers or a body, and a chat completion is a POST with
// an Authorization header.
import { createParser } from 'eventsource-parser'

export interface ChatStreamState {
    /** reply text per choice index ("0" when there is a single choice), plus "__tool_calls" as JSON when the model calls tools */
    readed: Record<string, string>
    /** reasoning that arrived as reasoning_content / reasoning */
    reasoning: string
    /** the reasoning came as a structured field (so <think> tags in the reply are not reasoning) */
    reasoningFromStructured: boolean
    /** the [DONE] event has been seen */
    done: boolean
}

export interface ChatStreamDecoder {
    feed(chunk: Uint8Array): void
    state(): ChatStreamState
}

/** When a provider re-sends the whole text so far instead of a delta, take it as it is; otherwise append. */
export function appendStreamingFragment(current: string, incoming?: string): string {
    if (!incoming) {
        return current
    }
    if (incoming.length > current.length && incoming.startsWith(current)) {
        return incoming
    }
    return current + incoming
}

export function createChatStreamDecoder(options: { multiGen?: boolean } = {}): ChatStreamDecoder {
    const textDecoder = new TextDecoder('utf-8')
    const st: ChatStreamState = { readed: {}, reasoning: '', reasoningFromStructured: false, done: false }

    const applyLine = (rawChunk: string) => {
        if (st.done) {
            return
        }
        if (rawChunk === '[DONE]') {
            st.done = true
            return
        }
        try {
            const choices = JSON.parse(rawChunk).choices
            for (const choice of choices) {
                const chunk = choice.delta.content ?? choice.text
                if (chunk) {
                    if (options.multiGen) {
                        const ind = choice.index.toString()
                        if (!st.readed[ind]) {
                            st.readed[ind] = ''
                        }
                        st.readed[ind] = appendStreamingFragment(st.readed[ind], chunk)
                    } else {
                        if (!st.readed['0']) {
                            st.readed['0'] = ''
                        }
                        st.readed['0'] = appendStreamingFragment(st.readed['0'], chunk)
                    }
                }
                if (choice?.delta?.tool_calls) {
                    if (!st.readed['__tool_calls']) {
                        st.readed['__tool_calls'] = JSON.stringify({})
                    }
                    const toolCallsData = JSON.parse(st.readed['__tool_calls'])
                    for (const toolCall of choice.delta.tool_calls) {
                        const index = toolCall.index ?? 0
                        if (!toolCallsData[index]) {
                            toolCallsData[index] = {
                                id: toolCall.id || null,
                                type: 'function',
                                function: { name: null, arguments: '' },
                            }
                        }
                        if (toolCall.id) {
                            toolCallsData[index].id = toolCall.id
                        }
                        if (toolCall.function?.name) {
                            toolCallsData[index].function.name = toolCall.function.name
                        }
                        if (toolCall.function?.arguments) {
                            toolCallsData[index].function.arguments = appendStreamingFragment(toolCallsData[index].function.arguments, toolCall.function.arguments)
                        }
                    }
                    st.readed['__tool_calls'] = JSON.stringify(toolCallsData)
                }
                const reasoningChunk = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
                if (reasoningChunk) {
                    st.reasoningFromStructured = true
                    st.reasoning = appendStreamingFragment(st.reasoning, reasoningChunk)
                }
            }
        } catch (error) {
            // a line that is not a chat delta (usage frame, keep-alive, provider note) is skipped, as before
        }
    }

    const parser = createParser({
        onEvent(event) {
            // one event normally has one data line; keep treating each line of a multi-line event on its own, as before
            for (const line of event.data.split('\n')) {
                applyLine(line)
            }
        },
    })

    return {
        feed(chunk) {
            parser.feed(textDecoder.decode(chunk, { stream: true }))
        },
        state() {
            return st
        },
    }
}
