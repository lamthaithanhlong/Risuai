<script lang="ts">
    // Learning mode: phrases the learner can say, above the chat input. Typing the sound in Vietnamese letters (or a few words of
    // the meaning) narrows them; ↑/↓ move the choice, Tab (or a tap) puts it in the input, Esc hides the bar until the next key.
    // 📖 opens the notebook: every phrase met in this language, the hard ones (often wrong, or close in sound to a mistake) first.
    // Shown only when learning mode and its suggestions are on. `floating` sits it on top of a sticky input row (fixed textarea).
    import { DBState } from "src/ts/stores.svelte";
    import type { Chat } from "src/ts/storage/database.svelte";
    import { stripReadings, type LearningLang } from "src/ts/process/vietji";
    import { insertText, suggest, suggestionPool, type Suggestion } from "src/ts/process/vietjiSuggest";
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
    let pool = $derived(enabled ? suggestionPool({ lastReply, vocab: JSON.stringify(notebook.vocab), lang }) : [])
    let items = $derived(enabled ? suggest(value ?? '', pool) : [])
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
                        <span class="text-xs leading-tight" style="color:#f2c76b;font-weight:600">{hardTexts.has(s.text) ? '⚑ ' : ''}{s.vietji}</span>
                        <span class="text-sm leading-tight text-textcolor">{lang === 'es' || lang === 'fr' ? s.text : stripReadings(s.text)}</span>
                        <span class="text-xs leading-tight text-textcolor2">{s.meaning}</span>
                    </button>
                {/each}
            {/if}
        </div>
    </div>
{/if}
