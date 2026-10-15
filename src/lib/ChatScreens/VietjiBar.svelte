<script lang="ts">
    // Learning mode: phrases the learner can say, above the chat input. Typing the sound in Vietnamese letters (or a few words of
    // the meaning) narrows them; ↑/↓ move the choice, Tab (or a tap) puts it in the input, Esc hides the bar until the next key.
    // Shown only when learning mode and its suggestions are on. `floating` sits it on top of a sticky input row (fixed textarea).
    import { DBState } from "src/ts/stores.svelte";
    import type { Chat } from "src/ts/storage/database.svelte";
    import { VOCAB_VAR } from "src/ts/process/learning";
    import { stripReadings, type LearningLang } from "src/ts/process/vietji";
    import { insertText, suggest, suggestionPool, type Suggestion } from "src/ts/process/vietjiSuggest";

    interface Props {
        value: string
        chat: Chat | undefined
        input?: HTMLTextAreaElement | null
        floating?: boolean
    }
    let { value = $bindable(), chat, input = null, floating = false }: Props = $props()

    let lang = $derived((DBState.db.learningLang ?? 'ja') as LearningLang)
    let enabled = $derived(!!DBState.db.learningMode && DBState.db.learningSuggest !== false)
    let lastReply = $derived(chat?.message?.findLast((m) => m.role === 'char')?.data ?? '')
    let pool = $derived(enabled ? suggestionPool({ lastReply, vocab: chat?.scriptstate?.[VOCAB_VAR] as string, lang }) : [])
    let items = $derived(enabled ? suggest(value ?? '', pool) : [])
    let selected = $state(0)
    let hidden = $state(false)

    // a new list starts at its first item; typing shows a bar hidden with Esc again
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
            }
        }
        input.addEventListener('keydown', onKey)
        return () => input.removeEventListener('keydown', onKey)
    })
</script>

{#if enabled && !hidden && items.length > 0}
    <div class={"flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 " + (floating ? 'absolute bottom-full left-0 right-0 pt-1 bg-bgcolor' : 'mb-1')}
        role="listbox" aria-label="Gợi ý">
        {#each items as s, i (s.text)}
            <button
                class={"shrink-0 flex flex-col items-start px-2 py-1 rounded-md border bg-darkbg hover:border-textcolor text-left " + (i === selected ? 'border-textcolor' : 'border-darkborderc')}
                role="option"
                aria-selected={i === selected}
                title={i === selected ? 'Tab' : ''}
                onclick={() => choose(s)}
            >
                <span class="text-xs leading-tight" style="color:#f2c76b;font-weight:600">{s.vietji}</span>
                <span class="text-sm leading-tight text-textcolor">{lang === 'es' ? s.text : stripReadings(s.text)}</span>
                <span class="text-xs leading-tight text-textcolor2">{s.meaning}</span>
            </button>
        {/each}
    </div>
{/if}
