import { THINKING_PLACEHOLDER } from './request/openAI/thoughtsStream'
import { splitCoT } from '../parser/cot'

/** Shown in place of a reply that never arrived, so it does not sit on "Thinking..." for good. */
export const NO_REPLY_NOTE = '*(Không nhận được phản hồi từ AI. Bấm reroll để thử lại.)*'

/** Appended to reply text that was saved while it streamed and then cut off, so it is not mistaken for the answer. */
export const PARTIAL_NOTE = '\n\n*(Phản hồi bị cắt dở, chưa nhận đủ. Bấm reroll để thử lại.)*'

/**
 * What to keep of the last bot message of a chat that was still streaming when the page died (the saved chat has
 * isStreaming = true: Risu clears it in a finally block, so only a dead page leaves it set). Nothing visible: the
 * "no reply" note. Some text: the text, marked as cut off. Already settled: unchanged.
 */
export function settleInterrupted(data: string | undefined): string {
    const text = data ?? ''
    if (visibleReply(text) === '') {
        return NO_REPLY_NOTE
    }
    if (text.endsWith(PARTIAL_NOTE) || text.endsWith(NO_REPLY_NOTE)) {
        return text
    }
    return text + PARTIAL_NOTE
}

interface LoadedChat {
    isStreaming?: boolean
    message?: { role: string, data: string }[]
}

/**
 * Applied to every chat when the saved data is loaded. A reply that was cut off while streaming (isStreaming still
 * set) is marked; the "Thinking..." stand-in left by an earlier build becomes the no-reply note. A chat that was
 * not streaming is left exactly as it is, however its last message looks.
 */
export function settleChatOnLoad(chat: LoadedChat): void {
    const messages = chat.message ?? []
    for (const m of messages) {
        if (m.role === 'char' && isStalledPlaceholder(m.data)) {
            m.data = NO_REPLY_NOTE
        }
    }
    const last = messages.at(-1)
    if (chat.isStreaming === true && last?.role === 'char') {
        last.data = settleInterrupted(last.data)
    }
}

/** A bot message that is only the "Thinking..." stand-in: the stream died before any word of the reply. */
export function isStalledPlaceholder(data: string | undefined): boolean {
    return !!data && data.trim() === THINKING_PLACEHOLDER.trim()
}

/** The part of a bot message the reader sees: everything except the model's reasoning block. */
export function visibleReply(data: string): string {
    // <Thoughts> and <think> blocks both count as reasoning; a thought that was never closed is still being written
    return splitCoT(data).main.trim()
}

export const MAX_EMPTY_REPLY_RETRIES = 2

/**
 * A reply that arrives with no words (the stream was cut while the model was still thinking: a locked phone, a dropped
 * connection) is worth asking for again; a few tries, then the owner sees whatever there is.
 */
export function shouldRetryEmptyReply(role: string | undefined, data: string | undefined, retriesDone: number): boolean {
    return role === 'char' && visibleReply(data ?? '') === '' && retriesDone < MAX_EMPTY_REPLY_RETRIES
}
