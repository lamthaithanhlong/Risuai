// The learner's notebook: phrases met, mistakes, right/wrong history, kept per language in the database instead of per chat,
// so a new chat (or another story) brings back what was learned. Chats from before keep their own copy in chat variables;
// the first reply in such a chat merges it into the notebook once ($vj_migrated).

import type { Chat } from '../storage/database.svelte'
import { readVocab } from './vietji'
import type { Mistake, VocabItem } from './learningMemory'

export type Notebook = { vocab: VocabItem[]; mistakes: Mistake[]; history: boolean[] }
type Stored = { vocab?: string; mistakes?: string; history?: string }
export type NotebookHost = { learningNotebook?: { [lang: string]: Stored } }

const list = <T>(raw: string | undefined): T[] => {
    try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function readNotebook(db: NotebookHost, lang: string): Notebook {
    const s = db.learningNotebook?.[lang] ?? {}
    return { vocab: readVocab<VocabItem>(s.vocab), mistakes: list<Mistake>(s.mistakes), history: list<boolean>(s.history) }
}

export function writeNotebook(db: NotebookHost, lang: string, nb: Notebook): void {
    db.learningNotebook ??= {}
    db.learningNotebook[lang] = {
        vocab: JSON.stringify(nb.vocab.slice(0, 600)),
        mistakes: JSON.stringify(nb.mistakes.slice(0, 60)),
        history: JSON.stringify(nb.history.slice(-60)),
    }
}

/** The item with more practice wins when the same phrase is in both lists. */
function better(a: VocabItem, b: VocabItem): VocabItem {
    return ((a.ok ?? 0) + (a.bad ?? 0)) >= ((b.ok ?? 0) + (b.bad ?? 0)) ? a : b
}

/** Merges a chat's older notebook (chat variables) into the language notebook, once per chat. */
export function migrateChat(db: NotebookHost, lang: string, chat: Chat | undefined, keys = { vocab: '$vj_vocab', mistakes: '$vj_mistakes', history: '$vj_history', done: '$vj_migrated' }): boolean {
    const ss = chat?.scriptstate
    if (!ss || ss[keys.done] === '1') return false
    const nb = readNotebook(db, lang)
    const byText = new Map(nb.vocab.map((v) => [v.text, v]))
    for (const v of readVocab<VocabItem>(ss[keys.vocab] as string)) {
        const have = byText.get(v.text)
        byText.set(v.text, have ? better(have, v) : v)
    }
    const mistakes = [...nb.mistakes]
    for (const m of list<Mistake>(ss[keys.mistakes] as string)) {
        const same = mistakes.find((x) => x.wrong === m.wrong && x.right === m.right)
        if (same) { same.count += m.count; same.last = Math.max(same.last, m.last) } else mistakes.push(m)
    }
    writeNotebook(db, lang, {
        vocab: [...byText.values()],
        mistakes: mistakes.sort((a, b) => b.count - a.count || b.last - a.last),
        history: [...nb.history, ...list<boolean>(ss[keys.history] as string)],
    })
    ss[keys.done] = '1'
    return true
}
