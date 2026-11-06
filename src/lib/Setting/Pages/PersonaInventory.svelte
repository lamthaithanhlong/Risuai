<script lang="ts">
    // "Kho & Slot": the persona's skill/item storage and the 11 skill slots. The server is the only source of truth: nothing is kept here
    // and every action is followed by a fresh GET. Level comes from the open chat's $lvl, else Level 1.
    import { DBState } from 'src/ts/stores.svelte'
    import { getCurrentChat } from 'src/ts/storage/database.svelte'
    import { alertConfirm } from 'src/ts/alert'
    import { personaIdOf } from 'src/ts/process/statsGlue'
    import { checkPersonaBinded } from 'src/ts/util'
    import { fetchPersona, deleteEntry, equipSkill, unequipSkill, type PersonaData } from 'src/ts/storage/personaStore'
    import { buildInventory, parseLvl, reasonText, deleteWarning, deletePlan, withLedgerMastery, TIERS, TIER_LABEL, TIER_CLASS, type Filter } from 'src/ts/process/personaView'
    import { fetchLedger } from 'src/ts/storage/statsSave'

    let data: PersonaData | null = $state(null)
    let error = $state('')
    let note = $state('')
    let filter: Filter = $state('all')
    let picking: string | null = $state(null) // skill id waiting for a slot choice
    let busy = $state(false)
    let tick = $state(0)

    const persona = $derived(personaIdOf(checkPersonaBinded() ?? DBState.db.personas?.[DBState.db.selectedPersona]))
    const lvl = $derived.by(() => { tick; return parseLvl((getCurrentChat()?.scriptstate as any)?.$lvl) })
    const inv = $derived(data ? buildInventory(data, lvl, filter) : null)

    async function reload() {
        // the mastery shown is the persona's event ledger (loot base + the gains of every reply, a regenerated one counted once); the store's own if it is down
        const ask = fetchLedger(persona)
        const r = await fetchPersona(persona, lvl.level)
        const led = await ask
        if (r.ok) { data = withLedgerMastery(r.data, led?.skills); error = '' } else { data = null; error = reasonText(r.reason) }
    }
    $effect(() => { persona; lvl.level; reload() })

    async function act(fn: () => Promise<{ ok: boolean, reason?: string }>) {
        if (busy) return
        busy = true; note = ''
        const r = await fn()
        if (!r.ok) note = reasonText(String(r.reason))
        picking = null
        await reload()
        busy = false
    }
    const equip = (id: string, slot: number) => act(() => equipSkill(persona, slot, id, lvl.level))
    const unequip = (slot: number) => act(() => unequipSkill(persona, slot, lvl.level))
    async function remove(kind: 'skill' | 'item', id: string, name: string, slot: number | null) {
        if (!await alertConfirm(deleteWarning(name, slot))) return
        await act(async () => {
            for (const step of deletePlan(kind, slot)) {
                const r = step === 'unequip' ? await unequipSkill(persona, slot as number, lvl.level) : await deleteEntry(persona, kind, id, lvl.level)
                if (!r.ok) return r
            }
            return { ok: true }
        })
    }
</script>

<div class="mt-4 w-full max-w-full rounded-md border border-darkborderc p-4" data-risu-persona-inventory>
    <div class="flex items-center justify-between flex-wrap gap-2">
        <h3 class="text-xl font-bold">Kho & Slot</h3>
        <button class="text-xs text-textcolor2 hover:text-green-500" onclick={() => { tick++; reload() }}>↻</button>
    </div>
    {#if error}
        <p class="text-sm text-red-500 mt-2">{error}</p>
    {:else if inv}
        <div class="mt-2 rounded-md bg-darkbg p-2">
            <div class="flex justify-between text-sm flex-wrap"><span class="font-bold">{inv.rankName}</span><span class="font-mono">Level {inv.level} · EXP {inv.exp} / {inv.need}</span></div>
            <div class="h-1.5 mt-1 rounded bg-darkborderc overflow-hidden"><div class="h-full bg-green-500" style="width: {inv.expPct}%"></div></div>
        </div>

        <h4 class="mt-4 mb-1 font-bold">Slot kỹ năng: {inv.slotText}</h4>
        <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))">
            {#each inv.slots as c (c.index)}
                <div class="rounded-md p-2 text-sm {c.open ? 'bg-darkbg' : 'bg-darkbg opacity-40'} {c.tier ? TIER_CLASS[c.tier] : ''}" data-slot={c.index}>
                    <div class="text-xs text-textcolor2">Slot {c.index + 1}{#if !c.open} · khoá{/if}</div>
                    {#if !c.open}<div>🔒</div>
                    {:else if c.skillId}
                        <div class="truncate">{c.name}</div>
                        <button class="text-xs text-textcolor2 hover:text-red-500" disabled={busy} onclick={() => unequip(c.index)}>Gỡ</button>
                    {:else}<div class="text-textcolor2">Trống</div>{/if}
                </div>
            {/each}
        </div>

        <div class="flex gap-1 flex-wrap mt-4 items-center">
            <button class="chip {filter === 'all' ? 'on' : ''}" onclick={() => filter = 'all'}>Tất cả</button>
            {#each TIERS as t}
                <button class="chip {TIER_CLASS[t]} {filter === t ? 'on' : ''}" onclick={() => filter = t}>{TIER_LABEL[t]}</button>
            {/each}
        </div>
        {#if note}<p class="text-sm text-red-500 mt-2" data-note>{note}</p>{/if}

        <h4 class="mt-3 mb-1 font-bold">Kỹ năng: {inv.skillCount}</h4>
        {#if inv.skills.length === 0}<p class="text-sm text-textcolor2">Không có kỹ năng nào.</p>{/if}
        <ul class="flex flex-col gap-1">
            {#each inv.skills as k (k.id)}
                <li class="rounded-md bg-darkbg p-2 text-sm">
                    <div class="flex justify-between flex-wrap gap-1">
                        <span class={k.cls}>{k.name} · {k.label}{#if k.slot !== null} <span class="text-green-500">· slot {k.slot + 1}</span>{/if}</span>
                        <span class="flex gap-2">
                            {#if k.slot === null}<button class="hover:text-green-500" disabled={busy} onclick={() => picking = picking === k.id ? null : k.id}>Gắn</button>
                            {:else}<button class="hover:text-green-500" disabled={busy} onclick={() => unequip(k.slot as number)}>Gỡ</button>{/if}
                            <button class="hover:text-red-500" disabled={busy} onclick={() => remove('skill', k.id, k.name, k.slot)}>Xoá</button>
                        </span>
                    </div>
                    {#if picking === k.id}
                        <div class="flex gap-1 flex-wrap mt-1 text-xs">
                            {#if inv.freeOpenSlots.length === 0}<span class="text-textcolor2">Không còn slot trống đã mở</span>{/if}
                            {#each inv.freeOpenSlots as s}<button class="chip on" disabled={busy} onclick={() => equip(k.id, s)}>Slot {s + 1}</button>{/each}
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>

        <h4 class="mt-3 mb-1 font-bold">Vật phẩm: {inv.itemCount}</h4>
        {#if inv.items.length === 0}<p class="text-sm text-textcolor2">Không có vật phẩm nào.</p>{/if}
        <ul class="flex flex-col gap-1">
            {#each inv.items as i (i.id)}
                <li class="rounded-md bg-darkbg p-2 text-sm flex justify-between flex-wrap gap-1">
                    <span class={i.cls}>{i.name} × {i.qty} · {i.label}</span>
                    <button class="hover:text-red-500" disabled={busy} onclick={() => remove('item', i.id, i.name, null)}>Xoá</button>
                </li>
            {/each}
        </ul>

        <h4 class="mt-3 mb-1 font-bold">Trần chỉ số ở {inv.rankName.split(' ')[0]}</h4>
        <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))">
            {#each inv.caps as c (c.key)}<div class="rounded-md bg-darkbg p-2 text-sm flex justify-between"><span>{c.label}</span><span class="font-mono">{c.cap}</span></div>{/each}
        </div>
    {:else}
        <p class="text-sm text-textcolor2 mt-2">Đang tải…</p>
    {/if}
</div>

<style>
    .chip { border: 1px solid currentColor; border-radius: 9999px; padding: 0 0.6rem; font-size: 0.75rem; opacity: 0.6 }
    .chip.on { opacity: 1; font-weight: 700 }
    .tier-bronze { color: #cd7f32 }
    .tier-silver { color: #c0c0c0 }
    .tier-gold { color: #f5c518 }
    .tier-platinum { color: #5fd3d3 }
    .tier-diamond { color: #7fb5ff }
</style>
