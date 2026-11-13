// The working half of compact.ts: asks the model for the story memory, keeps the per-chat state, and serves the two chat commands.
import { v4 } from 'uuid'
import { getCurrentCharacter, getCurrentChat, getDatabase, type Chat } from '../../storage/database.svelte'
import { hypaV3ProgressStore } from '../../stores.svelte'
import { alertToast } from '../../alert'
import { brLog } from '../../brLog'
import { getUserName } from '../../util'
import { type ChatTokenizer } from '../../tokenizer'
import { type OpenAIChat } from '../index.svelte'
import { requestChatData } from '../request/request'
import { withRetry } from '../retry'
import { SUMMARY_RETRY_DELAYS_MS } from './summaryRetry'
import {
    CC_PROMPT, CC_TRIGGER_PERCENT, buildChunks, ccBudgets, ccInject, ccThreshold, ccWindow, chooseFoldAndTail, parseAutocompactArg,
    parseCompactArg, shouldAutoCompact, splitAtUpto, summaryProblem, type CcEntry, type CcState,
} from './compact'

const estimate = (text: string): number => Math.ceil((text ?? '').length / 3)
const clean = (s: string): string => (s ?? '').replace(/<Thoughts>[\s\S]*?<\/Thoughts>/g, '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
const progress = (open: boolean, sub = '') => hypaV3ProgressStore.set({ open, miniMsg: open ? '…' : '', msg: open ? '[Compact] Đang nén ngữ cảnh…' : '', subMsg: sub })
let busy = false

async function ask(formated: OpenAIChat[]): Promise<string> {
    const res = await withRetry(async () => {
        const r = await requestChatData({ formated, bias: {}, useStreaming: false, noMultiGen: true }, 'memory')
        if (r.type === 'streaming' || r.type === 'multiline') throw new Error('Unexpected response type')
        if (r.type === 'fail') throw new Error(r.result)
        return r
    }, { delaysMs: SUMMARY_RETRY_DELAYS_MS, onRetry: (error, attempt) => brLog(`compact: request failed (attempt ${attempt}), retrying: ${error}`) })
    return clean(res.result)
}

/** The new story memory: the previous one with the folded messages worked in, chunk by chunk. Throws rather than return a bad one. */
async function generate(previous: string, fold: CcEntry[], window: number): Promise<string> {
    const b = ccBudgets(window)
    const chunks = buildChunks(fold, b.chunkInput)
    if (!chunks.length) throw new Error('there is no transcript content to compact')
    const system = CC_PROMPT.replace('{{target_tokens}}', String(b.summaryTarget))
    let running = (previous ?? '').trim()
    for (let i = 0; i < chunks.length; i++) {
        progress(true, `${i + 1}/${chunks.length}`)
        running = await ask([
            { role: 'system', content: system },
            { role: 'system', content: `PREVIOUS COMPACTED CONTEXT:\n${running || '(none)'}` },
            { role: 'user', content: `NEW TRANSCRIPT TO FOLD IN (chunk ${i + 1}/${chunks.length}):\n${chunks[i]}` },
        ])
        const problem = summaryProblem(running, estimate(chunks[i]), estimate(running))
        if (problem) throw new Error(problem)
    }
    // the model ignored the size: one pass to tighten it, so the next turn does not compact again at once
    if (estimate(running) > Math.round(b.summaryTarget * 1.35)) {
        const tight = await ask([
            { role: 'system', content: `${system}\n\nThis is a final consolidation pass. Preserve all material facts while aggressively removing duplication.` },
            { role: 'user', content: `CONTEXT TO CONSOLIDATE:\n${running}` },
        ])
        if (tight && !summaryProblem(tight, estimate(running), estimate(tight))) running = tight
    }
    return running
}

async function applyState(chats: OpenAIChat[], currentTokens: number, state: CcState, tokenizer: ChatTokenizer) {
    const at = splitAtUpto(chats, state.upto)
    for (const c of chats.slice(0, at)) currentTokens -= await tokenizer.tokenizeChat(c)
    const memory: OpenAIChat = { role: 'system', content: ccInject(state.summary), memo: 'supaMemory' }
    currentTokens += await tokenizer.tokenizeChat(memory)
    return { chats: [memory, ...chats.slice(at)], currentTokens }
}

/**
 * Before the request is built: leaves the folded messages out and puts the story memory in their place; at 90% of the window it
 * first folds more. `chats` are the chat's messages only, `currentTokens` the whole request. A failure sends the turn as it was.
 */
export async function ccPhase(chats: OpenAIChat[], currentTokens: number, maxContextTokens: number, chat: Chat, tokenizer: ChatTokenizer,
    opts: { auto: boolean, autoTokens: number, userName: string, charName: string }): Promise<{ chats: OpenAIChat[], currentTokens: number, used: boolean }> {
    let state = chat.ccCompact
    let view = state?.summary ? await applyState(chats, currentTokens, state, tokenizer) : { chats, currentTokens }
    const window = ccWindow(maxContextTokens, opts.autoTokens)
    const live = state?.summary ? view.chats.slice(1) : view.chats
    if (!busy && shouldAutoCompact({ on: opts.auto, tokens: view.currentTokens, threshold: ccThreshold(window), visible: live.length, state })) {
        const entries: CcEntry[] = []
        for (const c of live) {
            entries.push({ id: c.memo ?? '', role: c.role === 'user' ? opts.userName : c.role === 'assistant' ? opts.charName : 'System',
                text: c.content ?? '', tokens: await tokenizer.tokenizeChat(c) })
        }
        const { fold, tail } = chooseFoldAndTail(entries, ccBudgets(window).keepRecent, false)
        while (fold.length && !fold[fold.length - 1].id) tail.unshift(fold.pop())
        if (fold.length) {
            busy = true
            try {
                const summary = await generate(state?.summary ?? '', fold, window)
                state = { summary, upto: fold[fold.length - 1].id, count: (state?.count ?? 0) + 1, at: Date.now(), trigger: 'auto',
                    folded: (state?.folded ?? 0) + fold.length, lastAutoMsgs: tail.length }
                chat.ccCompact = state
                const before = view.currentTokens
                view = await applyState(chats, currentTokens, state, tokenizer)
                brLog(`compact: automatic, folded ${fold.length} messages, ${before} -> ${view.currentTokens} tokens (window ${window})`)
                alertToast('Đã tự nén ngữ cảnh: tin cũ được thay bằng ký ức truyện.')
            } catch (error) {
                // nothing was folded: the turn goes out as it was, and the next tries wait for new messages
                chat.ccCompact = { ...(state ?? { summary: '', upto: '', count: 0, at: 0, trigger: 'auto' as const, folded: 0 }), snoozeUntilMsgs: live.length + 3 }
                brLog(`compact: automatic pass failed, turn sent uncompacted: ${error instanceof Error ? error.message : error}`)
            } finally {
                busy = false
                progress(false)
            }
        }
    }
    return { ...view, used: !!chat.ccCompact?.summary }
}

const stamp = (ms: number): string => (ms ? new Date(ms).toLocaleString() : 'chưa')

function statusLine(chat: Chat): string {
    const db = getDatabase()
    const s = chat.ccCompact
    const window = ccWindow(db.maxContext, db.autoCompactTokens)
    const auto = db.autoCompact === false ? 'tự nén: TẮT' : `tự nén ở ${ccThreshold(window)} token (${CC_TRIGGER_PERCENT}% của ${window})`
    if (!s?.summary) return `Chat này chưa nén lần nào (${chat.message.length} tin). ${auto}.`
    const left = chat.message.length - splitAtUpto(chat.message.map((m) => ({ memo: m.chatId })), s.upto)
    return `Đã nén ${s.count} lần, lần cuối ${stamp(s.at)} (${s.trigger === 'auto' ? 'tự động' : 'tay'}). ${s.folded} tin đã gộp vào ký ức, ${left} tin còn nguyên văn. `
        + `Ký ức truyện ~${estimate(s.summary)} token. ${auto}.`
}

/** /compact [status|reset]. Returns the line shown to the player. */
export async function compactCommand(arg: string): Promise<string> {
    const chat = getCurrentChat()
    if (!chat) return 'Chưa mở chat nào.'
    const what = parseCompactArg(arg)
    if (what === 'bad') return 'Cách dùng: /compact (nén ngay), /compact status (xem), /compact reset (bỏ ký ức đã nén, tin cũ trở lại ngữ cảnh).'
    if (what === 'status') return statusLine(chat)
    if (what === 'reset') {
        if (!chat.ccCompact) return 'Chat này chưa nén gì nên không có gì để bỏ.'
        chat.ccCompact = undefined
        return 'Đã bỏ ký ức nén của chat này. Mọi tin cũ vẫn còn và trở lại ngữ cảnh từ lượt sau.'
    }
    if (busy) return 'Đang nén rồi, đợi lượt đó xong.'
    const db = getDatabase()
    const char = getCurrentCharacter()
    for (const m of chat.message) if (!m.chatId) m.chatId = v4()
    const state = chat.ccCompact
    const from = state?.summary ? splitAtUpto(chat.message.map((m) => ({ memo: m.chatId })), state.upto) : 0
    const entries: CcEntry[] = chat.message.slice(from).map((m) => ({ id: m.chatId, role: m.role === 'user' ? getUserName() : (char?.name ?? 'Narrator'), text: m.data ?? '', tokens: estimate(m.data) }))
    const window = ccWindow(db.maxContext, db.autoCompactTokens)
    const { fold, tail } = chooseFoldAndTail(entries, ccBudgets(window).keepRecent, true)
    if (!fold.length) return 'Chưa có gì để nén: cần ít nhất ba tin chưa nén (hai tin mới nhất luôn được giữ nguyên văn).'
    busy = true
    try {
        const summary = await generate(state?.summary ?? '', fold, window)
        chat.ccCompact = { summary, upto: fold[fold.length - 1].id, count: (state?.count ?? 0) + 1, at: Date.now(), trigger: 'manual',
            folded: (state?.folded ?? 0) + fold.length, lastAutoMsgs: state?.lastAutoMsgs }
        brLog(`compact: manual, folded ${fold.length} messages into ~${estimate(summary)} tokens`)
        return `Đã gộp ${fold.length} tin vào ký ức truyện (~${estimate(summary)} token), giữ nguyên văn ${tail.length} tin mới nhất. Tin cũ vẫn nằm trong chat, chỉ không gửi cho model nữa.`
    } catch (error) {
        return `Nén không thành, chưa có gì thay đổi: ${error instanceof Error ? error.message : error}`
    } finally {
        busy = false
        progress(false)
    }
}

/** /autocompact [off|on|N]: the window automatic compaction works against. Returns the line shown to the player. */
export function autocompactCommand(arg: string): string {
    const db = getDatabase()
    const a = parseAutocompactArg(arg)
    if (a.kind === 'bad') return 'Cách dùng: /autocompact (xem), /autocompact 20000 hoặc 20k (đặt cửa sổ ngữ cảnh), /autocompact on, /autocompact off.'
    if (a.kind === 'off') db.autoCompact = false
    if (a.kind === 'on') db.autoCompact = true
    if (a.kind === 'set') { db.autoCompact = true; db.autoCompactTokens = a.tokens }
    if (db.autoCompact === false) return 'Autocompact đang TẮT. Chat đã nén vẫn dùng ký ức của nó; /compact vẫn chạy tay được.'
    const window = ccWindow(db.maxContext, db.autoCompactTokens)
    return `Autocompact đang BẬT: tự nén khi lượt gửi đạt ${ccThreshold(window)} token (${CC_TRIGGER_PERCENT}% của cửa sổ ${window}${db.autoCompactTokens > 0 ? '' : ', theo Max Context'}).`
}
