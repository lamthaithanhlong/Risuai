// Each chat keeps its own unsent input (its "draft"). The chat screen has one input box for whichever chat is open, so without this
// the words typed or dictated in one chat stayed in the box when the player opened another, and a dictation that came back after the
// switch landed in the chat that happened to be open. The drafts live in localStorage under draftKey(character, chat): the box shows
// the open chat's draft, a switch puts the box back under the chat it belongs to, a send clears it, and text meant for a chat that is
// not open (a late dictation, a failed send put back) goes straight to that chat's stored draft.
//
// Every storage access is wrapped: a private window, a full quota or blocked site data only lose the drafts, never the input.
// The rules are checked in specs/input (Draft.tla, DraftKey.als, DraftKey.dfy, uppaal/).

import { appendText } from './dictation'

export interface DraftStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

export const DRAFT_PREFIX = 'risu-draft:'

/**
 * The storage key of one chat's draft, or null without a character or a chat id (ids are given when a character loads,
 * characters.ts; a page number would point at another chat once an import shifts the list). Both ids are encoded, so ':' never
 * appears inside a part: plain concatenation made ("a:b", "c") and ("a", "b:c") one key. The character is part of the key because
 * chat ids are not unique across characters (an "all chats" export imported into another character keeps its ids).
 */
export function draftKey(chaId: string | undefined | null, chatId: string | undefined | null): string | null {
    if (!chaId || !chatId) return null
    // encodeURIComponent throws on a lone surrogate: such an id gets no draft rather than breaking the chat screen
    try { return DRAFT_PREFIX + encodeURIComponent(chaId) + ':' + encodeURIComponent(chatId) } catch { return null }
}

/** The page's localStorage, or null where reading it throws (blocked site data). */
export function browserDraftStorage(): DraftStorage | null {
    try { return globalThis.localStorage ?? null } catch { return null }
}

export function readDraft(storage: DraftStorage | null, key: string | null): string {
    if (!storage || !key) return ''
    try { return storage.getItem(key) ?? '' } catch { return '' }
}

/** Stores a chat's draft; an empty one removes the key. */
export function writeDraft(storage: DraftStorage | null, key: string | null, text: string): void {
    if (!storage || !key) return
    try {
        if (text) storage.setItem(key, text)
        else storage.removeItem(key)
    } catch { /* quota or blocked: the box still holds the text */ }
}

/**
 * The input box's bookkeeping: which chat the text in the box belongs to (`owner`), the box's text as last told (`update`), and the
 * stored drafts of the others. Methods that change what the box should show return its new text, and tell the listeners too: a
 * dictation that comes back after the chat screen was taken down and made again reaches the new screen's box that way (sharedDraftBook).
 */
export function createDraftBook(storage: DraftStorage | null) {
    let owner: string | null = null
    let box = ''
    const listeners = new Set<(text: string) => void>()
    const show = (text: string) => {
        box = text
        writeDraft(storage, owner, text)
        for (const fn of listeners) { try { fn(text) } catch { /* a screen gone mid-call */ } }
        return text
    }
    return {
        get owner() { return owner },
        get box() { return box },
        /** The box now shows chat `key`: the text it held goes back under its own chat, and `key`'s draft comes out. */
        open(key: string | null, current: string): string {
            if (key === owner) return current
            writeDraft(storage, owner, current)
            owner = key
            box = readDraft(storage, key)
            return box
        },
        /** The box changed (typing, dictation, a send clearing it). */
        update(text: string): void {
            box = text
            writeDraft(storage, owner, text)
        },
        /** Drops a chat's draft. */
        clear(key: string | null): void {
            writeDraft(storage, key, '')
            if (key !== null && key === owner) box = ''
        },
        /** A send from chat `key` took `sent`: out of the box when that chat is open, else out of its stored draft (afterSend). */
        took(key: string | null, sent: string, current: string = box): string {
            if (key === owner) return show(afterSend(current, sent))
            writeDraft(storage, key, afterSend(readDraft(storage, key), sent))
            return current
        },
        /** Words for chat `target` (a dictation that came back): into the box when that chat is open, else into its stored draft. */
        deliver(target: string | null, text: string, current: string = box): string {
            if (target === owner) return show(appendText(current, text))
            writeDraft(storage, target, appendText(readDraft(storage, target), text))
            return current
        },
        /** A send that failed gives its text back to its chat, unless that chat has new words by now. */
        putBack(target: string | null, text: string, current: string = box): string {
            if (target === owner) return current !== '' ? current : show(text)
            if (readDraft(storage, target) === '') writeDraft(storage, target, text)
            return current
        },
        /** The screen goes away: the box's text stays stored under its chat, and later words go to storage. */
        close(current: string): void {
            writeDraft(storage, owner, current)
            owner = null
            box = ''
        },
        /** Called with the box's new text whenever the book changes it; returns the unsubscribe. */
        listen(fn: (text: string) => void): () => void {
            listeners.add(fn)
            return () => { listeners.delete(fn) }
        },
    }
}

let shared: ReturnType<typeof createDraftBook> | null = null
/** The page's one book (one chat screen at a time). A screen taken down and made again (phone: home and back) keeps it, so a
 *  dictation still being transcribed when the old screen went away lands in the new screen's box. */
export function sharedDraftBook() {
    return shared ??= createDraftBook(browserDraftStorage())
}

export type DraftBook = ReturnType<typeof createDraftBook>

/**
 * What stays in the box once a send took `sent` out of it: the words typed or dictated during the send's awaits stay (clearing the
 * whole box lost them). A box the player edited meanwhile is left as it is: a word sent twice by hand beats a word lost.
 */
export function afterSend(box: string, sent: string): string {
    if (box === sent) return ''
    if (sent !== '' && box.startsWith(sent)) return box.slice(sent.length).trimStart()
    return box
}

/**
 * The input box's height: grows with its text up to a cap, then scrolls inside. Uncapped, a two-minute dictation made the box
 * thousands of pixels tall: the row filled the screen and pushed the mic and send buttons out of it.
 */
export function inputBoxHeight(scrollHeight: number, viewportHeight: number): { height: number; scrolls: boolean } {
    const cap = Math.max(88, Math.floor((viewportHeight > 0 ? viewportHeight : 800) * 0.4))
    const h = Math.max(0, Math.ceil(scrollHeight))
    return h > cap ? { height: cap, scrolls: true } : { height: h, scrolls: false }
}
