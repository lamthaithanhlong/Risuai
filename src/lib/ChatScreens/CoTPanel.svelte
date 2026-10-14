<script lang="ts">
    // The model's chain of thought, apart from the chat. It is plain text (no markdown, scripts or translation) and is only
    // built while open, so a long thought costs the chat nothing.
    import { tick } from 'svelte'
    import { XIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { selectedCharID } from 'src/ts/stores.svelte'
    import { cotPanel, closeCoT } from 'src/ts/process/cotPanel.svelte'

    let body = $state<HTMLElement | null>(null)

    // a different character means a different chat: the open thought no longer belongs to anything on screen
    let lastChar = $selectedCharID
    $effect(() => {
        const c = $selectedCharID
        if (c !== lastChar) {
            lastChar = c
            closeCoT()
        }
    })

    // follow the end of the thought while it is being written
    $effect(() => {
        cotPanel.text
        if (cotPanel.open && cotPanel.thinking && body) {
            tick().then(() => body && (body.scrollTop = body.scrollHeight))
        }
    })
</script>

{#if cotPanel.open}
    <div class="cot-panel fixed z-40 left-0 right-0 bottom-0 max-h-[60vh] flex flex-col bg-darkbg text-textcolor border-t border-darkborderc rounded-t-lg shadow-lg md:left-auto md:right-4 md:bottom-20 md:w-[28rem] md:border md:rounded-lg">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-darkborderc">
            <span class="font-bold grow">{language.cot}</span>
            {#if cotPanel.thinking}
                <span class="text-sm text-textcolor2 animate-pulse">{language.cotThinking}</span>
            {/if}
            <button class="text-textcolor2 hover:text-textcolor p-1" title={language.close} onclick={closeCoT}>
                <XIcon size={18} />
            </button>
        </div>
        <div bind:this={body} class="overflow-y-auto p-3 text-sm text-textcolor2 whitespace-pre-wrap break-words">
            {#if cotPanel.text}
                {cotPanel.text}
            {:else}
                {cotPanel.thinking ? '…' : language.cotEmpty}
            {/if}
        </div>
    </div>
{/if}
