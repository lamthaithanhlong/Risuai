// Follows the character and chat a reply is being generated for, by id (specs/core/ChatSlot.tla).
//
// sendChat reads the selected character and chat once and then awaits for a long time (memory summarization, the model request,
// streaming) before it writes into DBState.db.characters[c].chats[h]. The sidebar's "New Chat" does chats.unshift(...) and a chat or
// character can be deleted meanwhile, so the indices read at the start can point at another chat: the reply, the memory summary and
// the trigger results then land in a chat they do not belong to, and `chats[h] = currentChat` overwrites a different chat.
// TLC found the 3-step trace: start generating, press New Chat, the reply lands in the new chat.
//
// `char` and `chat` are always the current indices of the original character and chat. A chat that no longer exists throws, which
// is better than writing into whatever is at its old position.

type Room = { chaId?: string, chats: { id?: string }[] }

export class ChatSlotGone extends Error {
    constructor(what: 'character' | 'chat') {
        super(`The ${what} this reply was generated for was removed while it was being generated`)
        this.name = 'ChatSlotGone'
    }
}

export class ChatSlot {
    private ci = -1
    private hi = -1
    private charId: string | undefined
    private chatId: string | undefined

    constructor(private db: () => { characters: Room[] } | undefined) {}

    init(charIndex: number, chatIndex: number) {
        const room = this.db()?.characters?.[charIndex]
        this.ci = charIndex
        this.hi = chatIndex
        this.charId = room?.chaId
        this.chatId = room?.chats?.[chatIndex]?.id
    }

    // -1 until init(), as the plain variable it replaces was
    get char(): number {
        if (this.ci < 0) {
            return -1
        }
        const chars = this.db()?.characters ?? []
        if (this.charId === undefined || chars[this.ci]?.chaId === this.charId) {
            return this.ci
        }
        const found = chars.findIndex((c) => c?.chaId === this.charId)
        if (found < 0) {
            throw new ChatSlotGone('character')
        }
        this.ci = found
        return found
    }

    get chat(): number {
        if (this.hi < 0) {
            return -1
        }
        const chats = this.db()?.characters?.[this.char]?.chats ?? []
        if (this.chatId === undefined || chats[this.hi]?.id === this.chatId) {
            return this.hi
        }
        const found = chats.findIndex((c) => c?.id === this.chatId)
        if (found < 0) {
            throw new ChatSlotGone('chat')
        }
        this.hi = found
        return found
    }
}
