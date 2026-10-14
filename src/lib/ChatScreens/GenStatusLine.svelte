<script lang="ts">
    // One line above the input while a reply is on its way: sent, retrying, accepted, thinking, writing, with the seconds since sending.
    import { genStatus } from 'src/ts/process/genStatus.svelte'
    import { language } from 'src/lang'

    let now = $state(Date.now())
    $effect(() => {
        if (genStatus.phase === 'idle') {
            return
        }
        now = Date.now()
        const timer = setInterval(() => (now = Date.now()), 1000)
        return () => clearInterval(timer)
    })

    let seconds = $derived(Math.max(0, Math.round((now - genStatus.startedAt) / 1000)))
    let label = $derived.by(() => {
        switch (genStatus.phase) {
            case 'sent': return language.genSent
            case 'retrying': return language.genRetrying.replace('{reason}', genStatus.reason).replace('{n}', String(genStatus.attempt)).replace('{m}', String(genStatus.attempts))
            case 'accepted': return language.genAccepted
            case 'thinking': return language.genThinking
            case 'writing': return language.genWriting
            default: return ''
        }
    })
</script>

{#if genStatus.phase !== 'idle'}
    <div role="status" aria-live="polite" class="ml-4 mr-2 mt-1 flex items-center gap-2 text-sm text-textcolor2">
        <span class="inline-block h-2 w-2 shrink-0 rounded-full animate-pulse {genStatus.phase === 'retrying' ? 'bg-yellow-500' : 'bg-green-500'}"></span>
        <span class="min-w-0 truncate">{label}</span>
        <span class="tabular-nums">{seconds}s</span>
    </div>
{/if}
