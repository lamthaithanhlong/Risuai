<script lang="ts">
    // Learning mode: phrases the learner can say, above the chat input, each as its Vietnamese meaning (small) over the foreign
    // phrase (large) and its reading. Typing the sound in Vietnamese letters narrows them; typing in Vietnamese with marks ("có") looks the meaning up,
    // and when the notebook has nothing for it the model is asked for three ways to say it; ↑/↓ move the choice, Tab (or a tap) puts it in the input, Esc hides the bar until the next key.
    // 📖 opens the notebook: every phrase met in this language, the hard ones (often wrong, or close in sound to a mistake) first.
    // Shown only when learning mode and its suggestions are on. `floating` sits it on top of a sticky input row (fixed textarea).
    import { DBState } from "src/ts/stores.svelte";
    import type { Chat } from "src/ts/storage/database.svelte";
    import { KIND_LABEL, parseReplies, stripReadings, type LearningLang, type SuggestedReply } from "src/ts/process/vietji";
    import { insertText, looksVietnamese, suggest, suggestionPool, type Suggestion } from "src/ts/process/vietjiSuggest";
    import { howToSayPrompt } from "src/ts/process/learning";
    import { installTapToSpeak } from "src/ts/process/tapToSpeak";
    import { dictSuggestions, loadWordList, makeAsker, needsModel, toneless, type Dictionary } from "src/ts/process/vietjiDict";
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
    let typedViet = $derived(enabled && looksVietnamese(value ?? '') ? (value ?? '').trim() : '')
    // the offline word list answers first, at once; the model is asked only when it has nothing or only guessed a word
    let wordList = $state<Dictionary | null>(null)
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
    let fromList = $derived(wordListLang !== lang ? [] : typedViet ? dictSuggestions(typedViet, wordList?.words ?? null, lang)
        : typedAny ? toneless(typedAny, wordList, lang) : [])
    let listSure = $derived(fromList.length > 0 && !needsModel(typedViet, wordList))
    let pool = $derived(enabled ? suggestionPool({ lastReply, vocab: JSON.stringify(notebook.vocab), lang, dict: fromList, asked: askedFor === typedViet ? asked : [] }) : [])
    let items = $derived(enabled ? suggest(value ?? '', pool) : [])
    // what the notebook alone offers for it: two or more fitting phrases and the model is not asked
    let foundInBook = $derived(typedViet ? suggest(typedViet, suggestionPool({ lastReply, vocab: JSON.stringify(notebook.vocab), lang })).length : 0)
    const asker = makeAsker<SuggestedReply[]>(async (key) => {
        const [askLang, viet] = [key.slice(0, key.indexOf('|')) as LearningLang, key.slice(key.indexOf('|') + 1)]
        const { requestChatData } = await import("src/ts/process/request/request")
        const known = notebook.vocab.filter((v) => (v.ok ?? 0) > 0).map((v) => stripReadings(v.text))
        const res = await requestChatData({ formated: [{ role: 'user', content: howToSayPrompt(viet, askLang, known) }], bias: {}, useStreaming: false, noMultiGen: true }, 'model')
        return res.type === 'success' && typeof res.result === 'string' ? parseReplies(res.result) : []
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

    // a chat from before the notebook was per language brings its phrases in as soon as it is opened
    $effect(() => { if (enabled && chat) migrateChat(DBState.db, lang, chat) })
    $effect(() => { items; selected = 0 })
    $effect(() => { value; hidden = false })

    function choose(s: Suggestion) {
        value = insertText(s, lang)
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
        {#if bookOpen}
            <div class="max-h-72 overflow-y-auto rounded-md border border-darkborderc bg-darkbg p-2 text-sm" aria-label="Sổ từ">
                <div class="flex justify-between text-xs text-textcolor2 mb-1">
                    <span>Sổ từ · {notebook.vocab.length} cụm{hard.length ? ` · ⚑ ${hard.length} cần luyện` : ''}</span>
                    {#if recent !== null}<span>đúng {recent}% trong 10 lần gần nhất</span>{/if}
                </div>
                {#each book as v (v.text)}
                    <button class="w-full text-left flex items-baseline gap-2 py-0.5 border-b border-darkborderc/40 hover:bg-selected" onclick={() => choose({ ...v, source: 'heard' })}>
                        <span class="w-4 shrink-0" title={v.confusedWith.length ? `dễ nhầm với: ${v.confusedWith.join(', ')}` : v.rate >= 1 / 3 ? 'hay sai' : ''}>{v.weight > 0 ? '⚑' : ''}</span>
                        <span class="text-textcolor">{lang === 'es' || lang === 'fr' ? v.text : stripReadings(v.text)}</span>
                        <span class="text-xs" style="color:#f2c76b;font-weight:600">{v.vietji}</span>
                        <span class="text-xs text-textcolor2 grow truncate">{v.meaning}</span>
                        <span class="text-xs text-textcolor2 shrink-0">{v.ok ?? 0}✓ {v.bad ?? 0}✗{v.rate > 0 ? ` (${Math.round(v.rate * 100)}% sai)` : ''} · {nextReview(v.due)}</span>
                    </button>
                {/each}
                {#if notebook.mistakes.length}
                    <div class="text-xs text-textcolor2 mt-2">Lỗi hay gặp</div>
                    {#each notebook.mistakes.slice(0, 8) as m (m.wrong + m.right)}
                        <div class="text-xs"><s class="opacity-70">{m.wrong}</s> → <b>{m.right}</b> <span class="text-textcolor2">×{m.count}{m.why ? ` · ${m.why}` : ''}</span></div>
                    {/each}
                {/if}
            </div>
        {/if}
        <div class="flex gap-2 overflow-x-auto" role="listbox" aria-label="Gợi ý">
            <button class="shrink-0 px-2 rounded-md border border-darkborderc bg-darkbg hover:border-textcolor" title="Sổ từ" aria-pressed={bookOpen}
                onclick={() => { bookOpen = !bookOpen }}>📖{hard.length ? ' ⚑' : ''}</button>
            {#if !hidden}
                {#each items as s, i (s.text)}
                    <button
                        class={"shrink-0 flex flex-col items-start px-2 py-1 rounded-md border bg-darkbg hover:border-textcolor text-left " + (i === selected ? 'border-textcolor' : 'border-darkborderc')}
                        role="option"
                        aria-selected={i === selected}
                        title={i === selected ? 'Tab' : ''}
                        onclick={() => choose(s)}
                    >
                        <!-- the learner reads Vietnamese natively: it is the small hint, the foreign word is what they look at -->
                        <span class="text-xs leading-tight text-textcolor2">{hardTexts.has(s.text) ? '⚑ ' : ''}{s.meaning}{#if s.kind}<span> · {KIND_LABEL[s.kind]}</span>{/if}</span>
                        <span class={"leading-snug text-textcolor font-semibold " + (lang === 'es' || lang === 'fr' ? 'text-base' : 'text-xl')}>{lang === 'es' || lang === 'fr' ? s.text.replace(/[«»]/g, '').trim() : stripReadings(s.text)}</span>
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
