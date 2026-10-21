<script lang="ts">
    // The turns of this chat that the server is running (src/ts/process/turnClient.ts): the player's input, where the server is with
    // it, and the reply's words as they come. The chat itself changes only when the server has saved the turn.
    import { dismissTurn, turnViews, type TurnView } from 'src/ts/process/turnClient'

    interface Props { chatId: string, onstop: () => void, onresend: (text: string) => void }
    let { chatId, onstop, onresend }: Props = $props()

    let list = $derived(($turnViews[chatId] ?? []) as TurnView[])
    let now = $state(Date.now())
    $effect(() => {
        if (list.length === 0) return
        const timer = setInterval(() => (now = Date.now()), 1000)
        return () => clearInterval(timer)
    })

    function label(v: TurnView): string {
        switch (v.state) {
            case 'queued': return 'Đã gửi lên server, đang chờ tới lượt'
            case 'assembling': return v.attempt > 1 ? `Server đang dựng lượt (lần ${v.attempt})` : 'Server đang dựng lượt'
            case 'generating': return 'Server đang viết'
            case 'tidying': return 'Server đang hoàn thiện và lưu'
            case 'retrying': return `Model lỗi, server sẽ thử lại (lần ${v.attempt + 1})`
            case 'failed': return `Không xong: ${v.error ?? 'lỗi'}`
            default: return ''
        }
    }
    const what = (v: TurnView) => (v.kind === 'reroll' ? '(viết lại câu trả lời)' : v.kind === 'continue' ? '(viết tiếp)' : v.text)
</script>

<div class="ml-4 mr-2 mt-1 flex flex-col gap-1" role="status" aria-live="polite" data-turn-panel>
    {#each list as v (v.key)}
        <div class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2" data-turn-state={v.state}>
            {#if what(v)}
                <div class="truncate text-textcolor">{what(v)}</div>
            {/if}
            <div class="flex items-center gap-2">
                <span class="inline-block h-2 w-2 shrink-0 rounded-full {v.state === 'failed' ? 'bg-red-500' : v.state === 'retrying' ? 'bg-yellow-500 animate-pulse' : 'bg-green-500 animate-pulse'}"></span>
                <span class="min-w-0 grow truncate">{label(v)}</span>
                <span class="tabular-nums">{Math.max(0, Math.round((now - v.at) / 1000))}s</span>
                {#if v.state === 'failed'}
                    {#if v.kind === 'send'}
                        <button class="underline" onclick={() => { dismissTurn(chatId, v.key); onresend(v.text) }}>Gửi lại</button>
                    {/if}
                    <button class="underline" onclick={() => dismissTurn(chatId, v.key)}>Bỏ</button>
                {:else}
                    <button class="underline" onclick={onstop}>Dừng</button>
                {/if}
            </div>
            {#if v.partial}
                <div class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-textcolor">{v.partial}</div>
            {/if}
        </div>
    {/each}
</div>
