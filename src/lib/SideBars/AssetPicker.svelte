<script lang="ts">
    // "Từ Asset Manager": a thumbnail grid of the images the cards already hold (and stored images no card names). Tap one to add it to the
    // open card; the page does what Choose Files does with the bytes (CharConfig.svelte, entryFromLibrary).
    import { DBState } from 'src/ts/stores.svelte'
    import { forageStorage, getFileSrc } from 'src/ts/globalApi.svelte'
    import { collectLibrary, filterLibrary, MAX_SHOWN, type LibItem } from 'src/ts/process/assetLibrary'

    let { onpick, onclose }: { onpick: (items: LibItem[]) => void | Promise<void>, onclose: () => void } = $props()

    const vi = $derived(DBState.db.language === 'vi')
    const L = $derived(vi
        ? { title: 'Từ Asset Manager', search: 'Tìm theo tên hoặc thẻ…', loading: 'Đang tải danh sách…', none: 'Không có ảnh nào khớp.', more: 'Hiện thêm', close: 'Đóng', add: 'Thêm', picked: 'đã chọn', cards: 'thẻ' }
        : { title: 'From Asset Manager', search: 'Search by name or card…', loading: 'Loading the list…', none: 'No image matches.', more: 'Show more', close: 'Close', add: 'Add', picked: 'selected', cards: 'cards' })

    let q = $state('')
    let shown = $state(MAX_SHOWN)
    let stored: string[] | null = $state(null)
    let chosen: LibItem[] = $state([])
    let busy = $state(false)

    // the server lists every stored key; a failure only means the "stored, no card names it" part is missing
    $effect(() => {
        let live = true
        Promise.resolve(forageStorage.listItem()).then((k) => { if (live) stored = Array.isArray(k) ? k : [] }).catch(() => { if (live) stored = [] })
        return () => { live = false }
    })

    const all = $derived(collectLibrary(DBState.db.characters as never[], stored ?? []))
    const found = $derived(filterLibrary(all, q))
    const visible = $derived(found.slice(0, shown))
    const isChosen = (it: LibItem) => chosen.some((c) => c.path === it.path)
    const toggle = (it: LibItem) => { chosen = isChosen(it) ? chosen.filter((c) => c.path !== it.path) : [...chosen, it] }
</script>

<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" data-risu-asset-picker>
    <div class="bg-darkbg w-full sm:max-w-2xl max-h-[85vh] flex flex-col rounded-t-lg sm:rounded-lg border border-darkborderc">
        <div class="flex items-center justify-between p-3 border-b border-darkborderc">
            <h3 class="text-lg font-bold">{L.title}</h3>
            <button class="text-textcolor2 hover:text-green-500 px-2" onclick={onclose}>{L.close}</button>
        </div>
        <div class="p-3 pb-0">
            <input class="w-full bg-transparent border border-darkborderc rounded-md p-2" type="search" placeholder={L.search} bind:value={q} oninput={() => { shown = MAX_SHOWN }} />
        </div>
        <div class="overflow-y-auto p-3 flex-1">
            {#if stored === null}
                <p class="text-textcolor2 text-sm">{L.loading}</p>
            {:else if found.length === 0}
                <p class="text-textcolor2 text-sm">{L.none}</p>
            {:else}
                <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {#each visible as it (it.path)}
                        <button class="relative rounded-md overflow-hidden border text-left" class:border-green-500={isChosen(it)} class:border-darkborderc={!isChosen(it)} onclick={() => toggle(it)}>
                            {#await getFileSrc(it.path)}
                                <div class="aspect-square bg-darkbutton"></div>
                            {:then src}
                                <img class="aspect-square w-full object-cover" {src} alt={it.name} loading="lazy" />
                            {:catch}
                                <div class="aspect-square bg-darkbutton"></div>
                            {/await}
                            <span class="block text-xs truncate px-1 py-0.5">{it.name}</span>
                            {#if it.cards.length}<span class="block text-[10px] text-textcolor2 truncate px-1 pb-0.5">{it.cards.join(', ')}</span>{/if}
                            {#if isChosen(it)}<span class="absolute top-1 right-1 bg-green-600 text-white text-xs rounded px-1">✓</span>{/if}
                        </button>
                    {/each}
                </div>
                {#if found.length > shown}
                    <button class="mt-3 w-full text-sm text-textcolor2 hover:text-green-500" onclick={() => { shown += MAX_SHOWN }}>{L.more} ({found.length - shown})</button>
                {/if}
            {/if}
        </div>
        <div class="p-3 border-t border-darkborderc flex items-center justify-between gap-2">
            <span class="text-sm text-textcolor2">{chosen.length} {L.picked}</span>
            <button class="px-4 py-2 rounded-md bg-green-600 text-white disabled:opacity-40" disabled={chosen.length === 0 || busy}
                onclick={async () => { busy = true; try { await onpick(chosen) } finally { busy = false } }}>{L.add}</button>
        </div>
    </div>
</div>
