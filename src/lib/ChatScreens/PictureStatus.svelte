<script lang="ts">
    // One line under a message while its picture is on the server's queue: drawing, trying again, or failed (with "try again").
    // The picture itself arrives in the message; a message whose picture came shows nothing here. See pictureWatch.svelte.ts.
    import { language } from 'src/lang'
    import { getCurrentChat } from 'src/ts/storage/database.svelte'
    import { pictureWatch, retryPicture, stopPicture } from 'src/ts/process/pictureWatch.svelte'

    let { idx = -1 }: { idx?: number } = $props()
    const info = $derived.by(() => {
        const id = idx >= 0 ? getCurrentChat()?.message?.[idx]?.chatId : undefined
        return id ? pictureWatch.byMessage[id] : undefined
    })

    let now = $state(Date.now())
    $effect(() => {
        if (!info) return
        const timer = setInterval(() => (now = Date.now()), 1000)
        return () => clearInterval(timer)
    })
    const seconds = $derived(info?.since ? Math.max(0, Math.round((now - info.since) / 1000)) : 0)
    const wait = $derived(info?.nextAt ? Math.max(0, Math.round((info.nextAt - now) / 1000)) : 0)
</script>

{#if info}
    <div role="status" aria-live="polite" class="picture-status mt-1 flex flex-wrap items-center gap-2 text-sm text-textcolor2">
        <span class="inline-block h-2 w-2 shrink-0 rounded-full {info.state === 'failed' ? 'bg-red-500' : info.state === 'retrying' ? 'bg-yellow-500 animate-pulse' : 'bg-blue-400 animate-pulse'}"></span>
        {#if info.state === 'drawing'}
            <span class="min-w-0">{language.pictureDrawing}</span>
            <span class="tabular-nums">{seconds}s</span>
        {:else if info.state === 'retrying'}
            <span class="min-w-0">{language.pictureRetrying.replace('{n}', String(info.attempt + 1))}</span>
            <span class="tabular-nums">{wait}s</span>
        {:else}
            <span class="min-w-0" title={info.error}>{language.pictureFailed}</span>
            <button class="underline hover:text-blue-500 picture-retry" onclick={() => retryPicture(info.jobId)}>{language.pictureRetry}</button>
        {/if}
        {#if info.state !== 'failed'}
            <button class="underline hover:text-blue-500 picture-stop" onclick={() => stopPicture(info.jobId)}>{language.pictureStop}</button>
        {/if}
    </div>
{/if}
