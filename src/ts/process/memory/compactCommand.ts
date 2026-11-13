// The two chat commands of compact.ts: /compact (summarise now) and /autocompact (the limit). See compact.ts for why.
import { v4 } from 'uuid'
import { getCurrentChat, getDatabase } from '../../storage/database.svelte'
import { hypaV3ProgressStore } from '../../stores.svelte'
import { brLog } from '../../brLog'
import { type OpenAIChat } from '../index.svelte'
import { getCurrentHypaV3Preset, summarize, type SerializableHypaV3Data } from './hypav3'
import { sanitizeHypaV3Settings } from './hypaSettings'
import { AUTOCOMPACT_MIN, parseAutocompactArg, pickCompactChunks } from './compact'

/** /compact: summarise every message but the last few into HypaV3 summaries now. Returns the line shown to the player. */
export async function compactNow(): Promise<string> {
    const db = getDatabase()
    const chat = getCurrentChat()
    if (!chat) return 'Chưa mở chat nào để nén.'
    if (!db.hypaV3) return 'HypaMemory V3 đang tắt (Cài đặt → Bot khác → Bộ nhớ dài hạn). Bật nó rồi gõ /compact lại.'
    const settings = sanitizeHypaV3Settings(getCurrentHypaV3Preset().settings)
    for (const m of chat.message) if (!m.chatId) m.chatId = v4()
    const data: SerializableHypaV3Data = chat.hypaV3Data ?? { summaries: [] }
    const covered = new Set(data.summaries.flatMap((s) => s.chatMemos ?? []))
    const chunks = pickCompactChunks(chat.message, covered, settings.queryChatCount, settings.maxChatsPerSummary)
    if (chunks.length === 0) return `Chưa có gì để nén: chat có ${chat.message.length} tin, ${settings.queryChatCount} tin cuối luôn được giữ nguyên.`

    let done = 0, msgs = 0, failed = ''
    try {
        for (const chunk of chunks) {
            hypaV3ProgressStore.set({ open: true, miniMsg: `${chunks.length - done}`, msg: '[HypaV3] Đang nén…', subMsg: `${done}/${chunks.length} đoạn` })
            const oai: OpenAIChat[] = chunk.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.data, memo: m.chatId }))
            const text = (await summarize(oai) ?? '').trim()
            if (!text) { failed = 'model tóm tắt trả về rỗng'; break }
            // saved chunk by chunk: a failure later keeps what is already summarised, and the next /compact continues after it
            data.summaries.push({ text, chatMemos: chunk.map((m) => m.chatId), isImportant: false })
            chat.hypaV3Data = data
            done++; msgs += chunk.length
        }
    } catch (error) {
        failed = error instanceof Error ? error.message : String(error)
    } finally {
        hypaV3ProgressStore.set({ open: false, miniMsg: '', msg: '', subMsg: '' })
    }
    brLog(`compact: ${done}/${chunks.length} chunks, ${msgs} messages${failed ? ', stopped: ' + failed : ''}`)
    const head = `Đã nén ${msgs} tin thành ${done} bản tóm tắt (chat giờ có ${data.summaries.length}).`
    return failed ? `${head} Dừng giữa chừng: ${failed}. Gõ /compact lần nữa để nén tiếp.` : `${head} Từ lượt sau các tin đó được thay bằng bản tóm tắt.`
}

/** /autocompact [off|on|N]: the limit the memory phase compacts at. Returns the line shown to the player. */
export function autocompactCommand(arg: string): string {
    const db = getDatabase()
    const a = parseAutocompactArg(arg)
    const now = () => db.autoCompact === false ? 'Autocompact đang TẮT: thẻ nào tắt công tắc nhớ sẽ bị cắt tin cũ khi đầy.'
        : db.autoCompactTokens > 0 ? `Autocompact đang BẬT: nén khi lượt gửi vượt ${Math.max(AUTOCOMPACT_MIN, db.autoCompactTokens)} token (và không bao giờ quá Max Context ${db.maxContext}).`
            : `Autocompact đang BẬT: nén khi lượt gửi vượt Max Context (${db.maxContext} token).`
    if (a.kind === 'bad') return 'Cách dùng: /autocompact (xem), /autocompact 20000 hoặc 20k (đặt ngưỡng token), /autocompact on, /autocompact off.'
    if (a.kind === 'off') db.autoCompact = false
    if (a.kind === 'on') db.autoCompact = true
    if (a.kind === 'set') { db.autoCompact = true; db.autoCompactTokens = a.tokens }
    return now() + (db.hypaV3 ? '' : ' Lưu ý: HypaMemory V3 đang tắt nên chưa có gì chạy.')
}
