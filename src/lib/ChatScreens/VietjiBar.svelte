<script lang="ts">
    // Learning mode: phrases the learner can say, above the chat input, each as its Vietnamese meaning (small) over the foreign
    // phrase (large) and its reading. Typing the sound in Vietnamese letters narrows them; typing in Vietnamese with marks ("có") looks the meaning up,
    // and when the notebook has nothing for it the model is asked for three ways to say it; ↑/↓ move the choice, Tab (or a tap) puts it in the input, Esc hides the bar until the next key.
    // 📖 opens the notebook: every phrase met in this language, the hard ones (often wrong, or close in sound to a mistake) first.
    // Shown only when learning mode and its suggestions are on. `floating` sits it on top of a sticky input row (fixed textarea).
    import { DBState } from "src/ts/stores.svelte";
    import type { Chat } from "src/ts/storage/database.svelte";
    import { KIND_LABEL, isLatinLang, parseReplies, setEnglishReadings, setHanReadings, setKanjiReadings, setThaiWords, stripReadings, type LearningLang, type SuggestedReply } from "src/ts/process/vietji";
    import { ReloadGUIPointer } from "src/ts/stores.svelte";
    import { insertText, looksVietnamese, soundMatch, suggest, suggestionPool, type Suggestion } from "src/ts/process/vietjiSuggest";
    import { howToSayPrompt } from "src/ts/process/learning";
    import { installTapToSpeak } from "src/ts/process/tapToSpeak";
    import { allowCoach, detailAsker, filledHtml, sentBefore, readInline, installDetailButton, type Detail } from "src/ts/process/grammarCoach";
    import { phraseVietji } from "src/ts/process/vietji";
    import { mixChips, repliesOrThrow } from "src/ts/process/vietjiSuggest";
    import { rememberThought, thoughtFor } from "src/ts/process/learningThought";
    import { buildEnglishIndex, buildKanaIndex, buildKoreanIndex, buildSoundIndex, buildThaiIndex, commitOnSpace, imeSuggestions, isSoundTyping, jaSuggestions, englishTail, type KanaIndex, type SoundIndex } from "src/ts/process/vietjiIme";
    import { composeSuggestions, dictSuggestions, loadWordList, makeAsker, needsModel, toneless, vietnameseTail, type Dictionary } from "src/ts/process/vietjiDict";
    import { migrateChat, readNotebook } from "src/ts/process/learningStore";
    import { errorRate, flagged } from "src/ts/process/learningMemory";

    interface Props {
        value: string
        chat: Chat | undefined
        input?: HTMLTextAreaElement | null
        floating?: boolean
    }
    let { value = $bindable(), chat, input = null, floating = false }: Props = $props()

    let lang = $derived((DBState.db.learningLang ?? 'ja') as LearningLang)
    let enabled = $derived(!!DBState.db.learningMode && DBState.db.learningSuggest !== false)
    let notebook = $derived(enabled ? readNotebook(DBState.db, lang) : { vocab: [], mistakes: [], history: [] })
    let hard = $derived(flagged(notebook.vocab, notebook.mistakes))
    let hardTexts = $derived(new Set(hard.map((h) => h.text)))
    let lastReply = $derived(chat?.message?.findLast((m) => m.role === 'char')?.data ?? '')
    // typed in Vietnamese and nothing in the notebook fits: the model is asked for three ways to say it (after a pause in typing)
    let askedFor = $state('')
    let asked = $state<SuggestedReply[]>([])
    let asking = $state(false)
    // what is on offer before any lookup: the sound of one of these, even with tone marks, is not Vietnamese to look up
    let offered = $derived(enabled ? suggestionPool({ lastReply, vocab: JSON.stringify(notebook.vocab), lang }) : [])
    // Chinese sound typing, word by word (vietjiIme.ts): the index is built from the pinyin list once it has loaded
    let soundIndex = $state<SoundIndex | null>(null)
    let koIndex = $state<SoundIndex | null>(null)
    let kanaIndex = $state<KanaIndex | null>(null)
    let wordList = $state<Dictionary | null>(null)
    // building a sentence: words already written in the language, then Vietnamese at the end ("我 想 cô ấy"): only that end is
    // looked up (and asked about), and its chips keep what is before it
    let vietSet = $derived(new Set(Object.keys(wordList?.words ?? {})))
    let enIndex = $state<SoundIndex | null>(null)
    let thIndex = $state<SoundIndex | null>(null)
    let enSound = $derived(lang === 'en' && !!englishTail(value ?? '').sound)
    let soundTyping = $derived((lang === 'zh' && isSoundTyping(value ?? '', soundIndex, vietSet)) || (lang === 'ko' && isSoundTyping(value ?? '', koIndex, vietSet))
        || (enSound && isSoundTyping(value ?? '', enIndex, vietSet)) || (lang === 'th' && isSoundTyping(value ?? '', thIndex, vietSet)))
    let composing = $derived(enabled ? vietnameseTail(value ?? '', vietSet) : { head: '', tail: '' })
    let composeMode = $derived(!!composing.head.trim() && !!composing.tail)
    let typedViet = $derived(!enabled || soundTyping ? '' : composeMode ? composing.tail
        : looksVietnamese(value ?? '') && !soundMatch(value ?? '', offered) ? (value ?? '').trim() : '')
    // the offline word list answers first, at once; the model is asked only when it has nothing or only guessed a word
    let wordListLang = $state('')
    let listReady = $state(false)
    let typedAny = $derived(enabled && /\p{L}/u.test(value ?? '') ? (value ?? '').trim() : '')
    $effect(() => {
        // loaded as soon as the bar shows, not on the first key: a 1-2 MB list took longer than the first word to arrive
        if (!enabled || wordListLang === lang) return
        const want = lang
        wordListLang = want
        wordList = null
        listReady = false
        loadWordList(want).then((w) => { if (lang === want) { wordList = w; listReady = true } })
    })
    // the sound of an offered answer is not a word to look up, with or without tone marks (喜欢 再 增加 蚊帐 for "ùa lái tảng mẩn")
    let fromList = $derived(wordListLang !== lang ? [] : typedViet ? dictSuggestions(typedViet, wordList?.words ?? null, lang, 6, wordList?.verbs)
        : typedAny && !soundMatch(typedAny, offered) && !soundTyping ? toneless(typedAny, wordList, lang) : [])
    let listSure = $derived(fromList.length > 0 && !needsModel(typedViet, wordList))
    let pool = $derived(enabled ? suggestionPool({ lastReply, vocab: JSON.stringify(notebook.vocab), lang, dict: fromList, asked: askedFor === typedViet ? asked : [] }) : [])
    // a Chinese word's Vietnamese meaning, from the word list read backwards (我 → tôi), for the sound-typing chips
    let meaningOfZh = $derived.by(() => {
        // the most used Vietnamese word wins (我 → tôi, not "bản thân"), by the list's everyday order
        const back = new Map<string, string>()
        if ((lang === 'zh' || lang === 'en') && wordList) {
            const rank = new Map((wordList.order ?? []).map((w, i) => [w, i]))
            const vis = Object.keys(wordList.words).sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9))
            for (const vi of vis) {
                const w = stripReadings(wordList.words[vi][0] ?? '')
                if (w && !back.has(w)) back.set(w, vi)
            }
        }
        return (w: string) => back.get(w) ?? ''
    })
    let imeItems = $derived(!enabled ? [] : lang === 'zh' ? imeSuggestions(value ?? '', soundIndex, meaningOfZh)
        : lang === 'en' ? (enSound ? imeSuggestions(value ?? '', enIndex, meaningOfZh) : [])
        : lang === 'ko' ? imeSuggestions(value ?? '', koIndex) : lang === 'ja' ? jaSuggestions(value ?? '', kanaIndex)
        : lang === 'th' ? imeSuggestions(value ?? '', thIndex) : [])

    // the Korean and Japanese sound typing: built once the lists are here (Korean: the word list plus the dictionary's words,
    // so dictionary forms like 먹다 are known; Japanese: the kanji list and its kana words)
    $effect(() => {
        if (!enabled || lang !== 'ko' || koIndex || !wordList) return
        const more = Object.values(wordList.words).flat()
        fetch('/dict/ko-words.json').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.words) koIndex = buildKoreanIndex(d.words, more) }).catch(() => {})
    })
    $effect(() => {
        if (!enabled || lang !== 'ja' || kanaIndex) return
        fetch('/dict/ja-kanji.json').then((r) => r.ok ? r.json() : null)
            .then((d) => { if (d?.words) kanaIndex = buildKanaIndex(d.words, d.kana ?? []) }).catch(() => {})
    })

    // typed right, written at once: at the space, a word whose sound reads exactly as one word becomes its characters
    let vietnameseWords = $derived(vietSet)
    $effect(() => {
        const v = value ?? ''
        if (!enabled || DBState.db.learningAutoWrite === false || !v.endsWith(' ')) return
        const next = commitOnSpace(v, lang, { zh: soundIndex, ko: koIndex, ja: kanaIndex, en: enIndex, vietnamese: vietnameseWords })
        if (next !== null && next !== v) value = next
    })
    let items = $derived.by(() => {
        if (!enabled) return []
        // in a sentence being built, a chip for the Vietnamese end replaces only that end
        const compose = composeMode ? composeSuggestions(value ?? '', wordList, lang) : []
        const keepHead = (x: Suggestion) => (composeMode && x.replace === undefined && (x.source === 'asked' || x.source === 'dict')
            ? { ...x, replace: composing.head.replace(/(?<=[\u3040-\u30ff\u3400-\u9fff\u0E01-\u0E4E])\s+$/, '') + stripReadings(x.text).replace(/[«»]/g, '').trim() } : x)
        // while composing, the list's own chips for the Vietnamese end are the compose chips: the whole-input ones would repeat them
        const rest = [...compose, ...suggest(composeMode ? composing.tail : value ?? '', pool).filter((x) => !(composeMode && x.source === 'dict')).map(keepHead)]
        // an offered answer that starts with the typed sound is most likely what is being typed: it goes first
        const offeredHit = soundMatch(value ?? '', offered) ? rest.filter((s) => s.source === 'reply' || s.source === 'heard' || s.source === 'starter') : []
        // at most four of them, so the word-by-word chips (我 alone) still have room
        const both = mixChips(rest, imeItems, offeredHit, { soundTyping, listSure })
        // one chip per outcome: the same characters can come from two places (冷静 from the compose chips and the list), and the
        // each block is keyed by this (reported: Svelte each_key_duplicate when it was keyed by the text)
        const seen = new Set<string>()
        return both.filter((s) => !seen.has(s.replace ?? s.text) && !!seen.add(s.replace ?? s.text)).slice(0, 6)
    })
    // what the notebook alone offers for it: two or more fitting phrases and the model is not asked
    let foundInBook = $derived(typedViet ? suggest(typedViet, suggestionPool({ lastReply, vocab: JSON.stringify(notebook.vocab), lang })).length : 0)
    const asker = makeAsker<SuggestedReply[]>(async (key) => {
        const [askLang, viet] = [key.slice(0, key.indexOf('|')) as LearningLang, key.slice(key.indexOf('|') + 1)]
        const { requestChatData } = await import("src/ts/process/request/request")
        const known = notebook.vocab.filter((v) => (v.ok ?? 0) > 0).map((v) => stripReadings(v.text))
        const res = await requestChatData({ formated: [{ role: 'user', content: howToSayPrompt(viet, askLang, known) }], bias: {}, useStreaming: false, noMultiGen: true }, 'model')
        return repliesOrThrow(res)
    })

    // docs/specs/VietjiBar.tla: wait for the word list before the pause timer (else a text the list knows is asked when the
    // list is slow), and share a request still out instead of asking again
    $effect(() => {
        const viet = typedViet
        if (!viet || viet.length < 2 || viet.length > 120 || foundInBook >= 2 || !listReady || listSure) { asking = false; return }
        const key = `${lang}|${viet}`
        const hit = asker.cached(key)
        if (hit) { asked = hit; askedFor = viet; return }
        let live = true
        const show = (p: Promise<SuggestedReply[]>) => {
            asking = true
            p.then((got) => { if (live) { asked = got; askedFor = viet } })
                .catch((e) => console.warn('[vietji] how-to-say request failed', e))
                .finally(() => { if (live) asking = false })
        }
        if (asker.pending(key)) { show(asker.ask(key)); return () => { live = false } }
        const timer = setTimeout(() => show(asker.ask(key)), 900)
        return () => { live = false; clearTimeout(timer) }
    })
    let selected = $state(0)
    let hidden = $state(false)
    let bookOpen = $state(false)

    // the notebook: hard phrases first (heaviest flag), then the rest, most practised last
    let book = $derived.by(() => {
        const rest = notebook.vocab.filter((v) => !hardTexts.has(v.text))
        return [...hard, ...rest.map((v) => ({ ...v, rate: errorRate(v), confusedWith: [] as string[], weight: 0 }))]
    })
    const recent = $derived.by(() => {
        const last = notebook.history.slice(-10)
        return last.length >= 3 ? Math.round(100 * last.filter(Boolean).length / last.length) : null
    })
    const nextReview = (due?: number) => due === undefined ? 'mới gặp' : due <= Date.now() ? 'ôn ngay' : new Date(due).toLocaleDateString()

    // tap a foreign word in a message to hear it, through this Risu server's local TTS (only when Risu runs on its server)
    $effect(() => {
        if (!enabled || !(globalThis as typeof globalThis & { __NODE__?: boolean }).__NODE__) return
        const want = lang
        installTapToSpeak({
            fetch: (input, init) => fetch(input, init),
            auth: async () => (await import('src/ts/storage/nodeStorage')).getNodeServerProxyAuth(),
        }, () => want)
    })

    // readings for Han the model wrote without brackets: pinyin while learning Chinese, kana while learning Japanese (never the
    // other's); the shown messages are drawn again once the list is here
    const READING_LISTS: Record<string, { file: string; set: (w: Record<string, string> | null) => void }> = {
        zh: { file: '/dict/zh-pinyin.json', set: setHanReadings },
        ja: { file: '/dict/ja-kanji.json', set: setKanjiReadings },
        en: { file: '/dict/en-vietji.json', set: setEnglishReadings },
        th: { file: '/dict/th-words.json', set: setThaiWords },        // word boundaries and the readings rules miss
    }
    const readingLists = new Map<string, Promise<Record<string, string> | null>>()
    $effect(() => {
        for (const [l, r] of Object.entries(READING_LISTS)) if (!enabled || lang !== l) r.set(null)
        const list = enabled ? READING_LISTS[lang] : undefined
        if (!list) return
        const want = lang
        if (!readingLists.has(want)) {
            readingLists.set(want, fetch(list.file).then((r) => r.ok ? r.json() : null).then((d) => d?.words ?? null)
                .catch(() => { readingLists.delete(want); return null }))
        }
        readingLists.get(want)!.then((words) => {
            if (words && lang === want) { list.set(words); ReloadGUIPointer.update((v) => v + 1) }
            if (words && want === 'zh' && !soundIndex) setTimeout(() => { soundIndex = buildSoundIndex(words) }, 0)
            if (words && want === 'en' && !enIndex) setTimeout(() => { enIndex = buildEnglishIndex(words) }, 0)
            if (words && want === 'th' && !thIndex) setTimeout(() => { thIndex = buildThaiIndex(words) }, 0)
        })
    })

    // "🔍 Chi tiết" under a reply's grammar note: the player's whole sentence before that reply, taught in steps, asked of the
    // model once per sentence when pressed (the note itself may fix only one word of it)
    let detail = $state<{ sent: string; data: Detail | null; loading: boolean; error: string } | null>(null)
    const askDetail = detailAsker(async (prompt) => {
        const { requestChatData } = await import("src/ts/process/request/request")
        const res = await requestChatData({ formated: [{ role: 'user', content: prompt }], bias: {}, useStreaming: false, noMultiGen: true }, 'model')
        return res.type === 'success' && typeof res.result === 'string' ? res.result : null
    })
    $effect(() => {
        if (!enabled) return
        return installDetailButton((fix, wrote, at) => {
            const sent = sentBefore(chat?.message, at) || wrote || fix
            const key = JSON.stringify([lang, sent, wrote ? `${wrote} → ${fix}` : '', thoughtFor(sent) ?? ''])
            const cached = askDetail.cached(key)
            detail = { sent, data: cached ?? null, loading: !cached, error: '' }
            if (cached) return
            if (!allowCoach()) { detail = { ...detail, loading: false, error: 'Bấm nhiều quá, đợi chút rồi bấm lại.' }; return }
            askDetail.ask(key).then((d) => {
                if (detail?.sent === sent) detail = { ...detail, data: d, loading: false, error: '' }
            }).catch(() => { if (detail?.sent === sent) detail = { ...detail, loading: false, error: 'Chưa phân tích được câu này — bấm 🔍 lần nữa để thử lại.' } })
        })
    })

    // a chat from before the notebook was per language brings its phrases in as soon as it is opened
    $effect(() => { if (enabled && chat) migrateChat(DBState.db, lang, chat) })
    $effect(() => { items; selected = 0 })
    $effect(() => { value; hidden = false })

    // the Vietnamese behind each picked word, so the check after sending corrects toward what was meant (learningThought.ts)
    let thought: string[] = []
    function choose(s: Suggestion) {
        const viet = typedViet || (s.source === 'reply' || s.source === 'heard' || s.source === 'starter' ? s.meaning ?? '' : '')
        if (!composeMode) thought = []
        value = insertText(s, lang)
        if (viet) { thought.push(viet); rememberThought(value ?? '', thought.join(' ')) }
        input?.focus()
    }

    $effect(() => {
        if (!input) return
        const onKey = (e: KeyboardEvent) => {
            if (hidden || items.length === 0 || e.isComposing) return
            const oneLine = !(value ?? '').includes('\n')
            if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                choose(items[Math.min(selected, items.length - 1)])
            } else if (oneLine && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                const step = e.key === 'ArrowDown' ? 1 : -1
                selected = (selected + step + items.length) % items.length
            } else if (e.key === 'Escape') {
                hidden = true
                bookOpen = false
            }
        }
        input.addEventListener('keydown', onKey)
        return () => input.removeEventListener('keydown', onKey)
    })
</script>

{#if enabled}
    <div class={"flex flex-col shrink-0 px-4 pb-1 gap-1 " + (floating ? 'absolute bottom-full left-0 right-0 pt-1 bg-bgcolor' : 'mb-1')}>
        {#if detail}
            <div class="max-h-96 overflow-y-auto rounded-md border border-darkborderc bg-darkbg p-2 text-sm" aria-label="Ngữ pháp chi tiết">
                <div class="flex justify-between items-start gap-2 mb-1">
                    <div><span class="text-xs" style="color:#8fb8ff;font-weight:600">Ngữ pháp chi tiết · câu bạn gửi</span>
                        <div class="text-base mt-0.5">{@html filledHtml(detail.sent, detail.data?.pieces.filter((p) => p.ok).map((p) => p.piece) ?? [], detail.data?.pieces.filter((p) => !p.ok).map((p) => p.piece) ?? [])}</div></div>
                    <button class="text-textcolor2 hover:text-textcolor" title="Đóng" onclick={() => { detail = null }}>✕</button>
                </div>
                {#if detail.loading}
                    <div class="text-xs text-textcolor2">đang phân tích câu của bạn…</div>
                {:else if detail.error}
                    <div class="text-xs text-textcolor2">{detail.error}</div>
                {:else if detail.data}
                    {@const d = detail.data}
                    {@const right = d.pieces.filter((p) => p.ok)}
                    <div class="text-xs mt-2" style="color:#8fb8ff;font-weight:600">① Câu này chưa đúng ngữ pháp. Sườn đúng là:</div>
                    <div class="text-sm">{@html readInline(d.frame)}</div>
                    {#if d.heard}<div class="text-xs text-textcolor2">(viết như bạn, người ta sẽ hiểu: «{d.heard}»)</div>{/if}
                    <div class="text-xs mt-2" style="color:#8fb8ff;font-weight:600">② Từ vựng trong câu bạn — <span class="text-green-500">xanh là đúng</span>, <span class="text-red-500">đỏ là sai</span></div>
                    <table class="w-full text-xs">
                        <tbody>
                        {#each d.pieces as p, k (p.piece + '#' + k)}
                            <tr class="border-b border-darkborderc/40 align-top">
                                <td class="py-0.5 pr-2 text-base font-semibold whitespace-nowrap {p.ok ? 'text-green-500' : 'text-red-500'}">{p.ok ? '✓' : '✗'} {p.piece}</td>
                                <td class="py-0.5 pr-2 whitespace-nowrap" style="color:#f2c76b;font-weight:600">{phraseVietji(p.piece) ?? ''}</td>
                                <td class="py-0.5 pr-2 text-textcolor2 whitespace-nowrap">{p.kind}</td>
                                <td class="py-0.5 pr-2 text-textcolor">{@html readInline(p.heard)}{#if !p.ok && p.why}<span class="text-red-500"> · {@html readInline(p.why)}</span>{/if}</td>
                            </tr>
                        {/each}
                        </tbody>
                    </table>
                    {#if d.filled}
                        <div class="text-xs mt-2" style="color:#8fb8ff;font-weight:600">③ Gắn chữ đúng của bạn vào sườn</div>
                        <div class="text-base">{@html filledHtml(d.filled, right.map((p) => p.piece))}</div>
                        {#if right.length}<div class="text-xs text-green-500">OK, mấy chữ này bạn đúng rồi: {right.map((p) => p.piece).join(', ')}</div>{/if}
                    {/if}
                    {#if d.order || d.adds.length}
                        <div class="text-xs mt-2" style="color:#8fb8ff;font-weight:600">④ Còn sai, còn thiếu — cần sửa thêm</div>
                        {#if d.order}<div class="text-xs">↔ {@html readInline(d.order)}</div>{/if}
                        {#each d.adds as x, k (k)}
                            <div class="text-xs">+ <b class="text-sm">{@html readInline(x.add)}</b>{#if x.why} — {@html readInline(x.why)}{/if}</div>
                        {/each}
                    {/if}
                    <div class="text-xs mt-2" style="color:#8fb8ff;font-weight:600">⑤ Câu hoàn chỉnh</div>
                    <div class="text-lg font-semibold">{@html filledHtml(d.final)}</div>
                    {#if d.meaning}<div class="text-xs text-textcolor2">= {d.meaning}</div>{/if}
                {/if}
            </div>
        {/if}
        {#if bookOpen}
            <div class="max-h-72 overflow-y-auto rounded-md border border-darkborderc bg-darkbg p-2 text-sm" aria-label="Sổ từ">
                <div class="flex justify-between text-xs text-textcolor2 mb-1">
                    <span>Sổ từ · {notebook.vocab.length} cụm{hard.length ? ` · ⚑ ${hard.length} cần luyện` : ''}</span>
                    {#if recent !== null}<span>đúng {recent}% trong 10 lần gần nhất</span>{/if}
                </div>
                {#each book as v, k (v.text + '#' + k)}
                    <button class="w-full text-left flex items-baseline gap-2 py-0.5 border-b border-darkborderc/40 hover:bg-selected" onclick={() => choose({ ...v, source: 'heard' })}>
                        <span class="w-4 shrink-0" title={v.confusedWith.length ? `dễ nhầm với: ${v.confusedWith.join(', ')}` : v.rate >= 1 / 3 ? 'hay sai' : ''}>{v.weight > 0 ? '⚑' : ''}</span>
                        <span class="text-textcolor">{isLatinLang(lang) ? v.text : stripReadings(v.text)}</span>
                        <span class="text-xs" style="color:#f2c76b;font-weight:600">{v.vietji}</span>
                        <span class="text-xs text-textcolor2 grow truncate">{v.meaning}</span>
                        <span class="text-xs text-textcolor2 shrink-0">{v.ok ?? 0}✓ {v.bad ?? 0}✗{v.rate > 0 ? ` (${Math.round(v.rate * 100)}% sai)` : ''} · {nextReview(v.due)}</span>
                    </button>
                {/each}
                {#if notebook.mistakes.length}
                    <div class="text-xs text-textcolor2 mt-2">Lỗi hay gặp</div>
                    {#each notebook.mistakes.slice(0, 8) as m, k (m.wrong + '→' + m.right + '#' + k)}
                        <div class="text-xs"><s class="opacity-70">{m.wrong}</s> → <b>{m.right}</b> <span class="text-textcolor2">×{m.count}{m.why ? ` · ${m.why}` : ''}</span></div>
                    {/each}
                {/if}
            </div>
        {/if}
        <div class="flex gap-2 overflow-x-auto" role="listbox" aria-label="Gợi ý">
            <button class="shrink-0 px-2 rounded-md border border-darkborderc bg-darkbg hover:border-textcolor" title="Sổ từ" aria-pressed={bookOpen}
                onclick={() => { bookOpen = !bookOpen }}>📖{hard.length ? ' ⚑' : ''}</button>
            {#if !hidden}
                {#each items as s, i (s.replace ?? s.text)}
                    <button
                        class={"shrink-0 flex flex-col items-start px-2 py-1 rounded-md border bg-darkbg hover:border-textcolor text-left " + (i === selected ? 'border-textcolor' : 'border-darkborderc')}
                        role="option"
                        aria-selected={i === selected}
                        title={i === selected ? 'Tab' : ''}
                        onclick={() => choose(s)}
                    >
                        <!-- the learner reads Vietnamese natively: it is the small hint, the foreign word is what they look at -->
                        <span class="text-xs leading-tight text-textcolor2">{hardTexts.has(s.text) ? '⚑ ' : ''}{s.meaning}{#if s.kind}<span> · {KIND_LABEL[s.kind]}</span>{/if}</span>
                        <span class={"leading-snug text-textcolor font-semibold " + (isLatinLang(lang) ? 'text-base' : 'text-xl')}>{isLatinLang(lang) ? s.text.replace(/[«»]/g, '').trim() : stripReadings(s.text)}</span>
                        <span class="text-xs leading-tight" style="color:#f2c76b;font-weight:600">{s.vietji}</span>
                    </button>
                {/each}
                {#if asking}
                    <span class="shrink-0 self-center text-xs text-textcolor2 px-2">đang tìm cách nói “{typedViet}”…</span>
                {:else if typedViet && !items.length}
                    <span class="shrink-0 self-center text-xs text-textcolor2 px-2">gõ tiếp hoặc dừng tay để tìm cách nói</span>
                {/if}
            {/if}
        </div>
    </div>
{/if}
