<script lang="ts">
    // "Kho & Slot": the persona's skill/item storage and the 11 skill slots. The server is the only source of truth: nothing is kept here
    // and every action is followed by a fresh GET. Level comes from the open chat's $lvl, else Level 1.
    import { DBState } from 'src/ts/stores.svelte'
    import { getCurrentChat } from 'src/ts/storage/database.svelte'
    import { alertConfirm } from 'src/ts/alert'
    import { personaIdOf } from 'src/ts/process/statsGlue'
    import { checkPersonaBinded } from 'src/ts/util'
    import { fetchPersona, deleteEntry, equipSkill, unequipSkill, equipItem, unequipItem, setItemSlots, type PersonaData } from 'src/ts/storage/personaStore'
    import { buildInventory, entryDetail, defaultEffectPrefs, parseEffectPrefs, effectShown, setEffectShown, setEffectMode, EFFECT_PREFS_KEY, type EffectPrefs, parseLvl, reasonText, deleteWarning, deletePlan, withLedgerMastery, itemEquipBlock, parseItemSlotsLimit, TIERS, TIER_LABEL, TIER_CLASS, type Filter } from 'src/ts/process/personaView'
    import { fetchLedger } from 'src/ts/storage/statsSave'

    let data: PersonaData | null = $state(null)
    let error = $state('')
    let note = $state('')
    let filter: Filter = $state('all')
    let picking: string | null = $state(null) // skill id waiting for a slot choice
    let pickingItem: string | null = $state(null) // item id waiting for an item slot choice
    let limitText = $state('')
    let slotPick: { kind: 'skill' | 'item', slot: number } | null = $state(null)
    let skillsOpen = $state(true)
    let itemsOpen = $state(true)
    let busy = $state(false)
    let tick = $state(0)
    // show/hide of each entry's công dụng, kept per browser (every storage access may throw: the page works without it)
    function loadPrefs(): EffectPrefs { try { return parseEffectPrefs(localStorage.getItem(EFFECT_PREFS_KEY)) } catch { return defaultEffectPrefs() } }
    let prefs: EffectPrefs = $state(loadPrefs())
    function savePrefs(p: EffectPrefs) { prefs = p; try { localStorage.setItem(EFFECT_PREFS_KEY, JSON.stringify(p)) } catch { /* not kept */ } }
    const countOf = (kind: 'skill' | 'item') => (kind === 'skill' ? data?.skills.length : data?.items.length) ?? 0
    const shown = (kind: 'skill' | 'item', id: string) => effectShown(prefs, kind, id, countOf(kind))
    const toggleEffect = (kind: 'skill' | 'item', id: string) => savePrefs(setEffectShown(prefs, kind, id, !shown(kind, id), countOf(kind)))
    const inlineOf = (kind: 'skill' | 'item', id: string) => (data ? entryDetail(data, kind, id) : null)
    // the one open detail block: which entry, and where it was clicked (a card of the slot grid or a row of the list)
    let detail: { kind: 'skill' | 'item', id: string, src: 'card' | 'row' } | null = $state(null)
    const det = $derived(data && detail ? entryDetail(data, detail.kind, detail.id) : null)
    // a click on a button inside the card/row (Gắn, Gỡ, Xoá, a slot chip) is that button's, never the detail's
    function toggleDetail(e: Event, kind: 'skill' | 'item', id: string, src: 'card' | 'row') {
        if ((e.target as HTMLElement | null)?.closest?.('button, input, a')) return
        const closing = detail && detail.kind === kind && detail.id === id && detail.src === src
        detail = closing ? null : { kind, id, src }
        if (!closing && !shown(kind, id)) toggleEffect(kind, id)
    }
    const onKey = (e: KeyboardEvent, kind: 'skill' | 'item', id: string, src: 'card' | 'row') => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleDetail(e, kind, id, src) } }

    const persona = $derived(personaIdOf(checkPersonaBinded() ?? DBState.db.personas?.[DBState.db.selectedPersona]))
    const lvl = $derived.by(() => { tick; return parseLvl((getCurrentChat()?.scriptstate as any)?.$lvl) })
    const inv = $derived(data ? buildInventory(data, lvl, filter) : null)

    async function reload() {
        // the mastery shown is the persona's event ledger (loot base + the gains of every reply, a regenerated one counted once); the store's own if it is down
        const ask = fetchLedger(persona)
        const r = await fetchPersona(persona, lvl.level)
        const led = await ask
        if (r.ok) { data = withLedgerMastery(r.data, led?.skills); error = '' } else { data = null; error = reasonText(String((r as { reason?: string }).reason)) }
    }
    $effect(() => { persona; lvl.level; reload() })

    async function act(fn: () => Promise<{ ok: boolean, reason?: string }>) {
        if (busy) return
        busy = true; note = ''
        const r = await fn()
        if (!r.ok) note = reasonText(String(r.reason))
        picking = null; pickingItem = null; slotPick = null
        await reload()
        busy = false
    }
    const equip = (id: string, slot: number) => act(() => equipSkill(persona, slot, id, lvl.level))
    const unequip = (slot: number) => act(() => unequipSkill(persona, slot, lvl.level))
    const equipI = (id: string, slot: number) => act(() => equipItem(persona, slot, id, lvl.level))
    const unequipI = (slot: number) => act(() => unequipItem(persona, slot, lvl.level))
    function applyLimit() {
        const n = parseItemSlotsLimit(limitText)
        if (n === null) { note = 'Số slot item phải là số nguyên từ 1 đến 11'; return }
        act(() => setItemSlots(persona, n, lvl.level))
    }
    const resetLimit = () => act(() => setItemSlots(persona, null, lvl.level))
    // the box shows the server's number again after every reload
    $effect(() => { limitText = String(inv?.itemSlotsOpen ?? '') })
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

{#snippet effectToggle(kind, id)}
    <button class="text-xs text-textcolor2 hover:text-green-500 self-start" data-testid="effect-toggle-{id}" aria-expanded={shown(kind, id)} onclick={() => toggleEffect(kind, id)}>Công dụng {shown(kind, id) ? '▴' : '▾'}</button>
{/snippet}
{#snippet effectInline(kind, id)}
    {#if shown(kind, id) && !(detail && detail.kind === kind && detail.id === id)}
        {@const d = inlineOf(kind, id)}
        {#if d}
            <div class="inline-effect text-xs break-words" data-testid="effect-inline-{id}">
                {#if kind === 'skill'}<div>{d.rule}</div>{/if}
                <div>Công dụng: {d.effect}</div>
                {#if d.conditions}<div>Điều kiện: {d.conditions}</div>{/if}
            </div>
        {/if}
    {/if}
{/snippet}
{#snippet allButtons(kind)}
    <span class="flex gap-1 flex-wrap">
        <button class="chip on" data-testid="effects-show-all-{kind}s" onclick={() => savePrefs(setEffectMode(prefs, kind, 'all'))}>Hiện hết công dụng</button>
        <button class="chip on" data-testid="effects-hide-all-{kind}s" onclick={() => savePrefs(setEffectMode(prefs, kind, 'none'))}>Ẩn hết công dụng</button>
    </span>
{/snippet}
{#snippet detailBlock()}
    {#if det}
        <div class="detail rounded-md bg-darkbg p-2 text-sm mt-1 {det.cls}" data-testid="entry-detail" role="group" aria-label="Chi tiết {det.name}" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
            <div class="flex justify-between gap-2 items-start">
                <div class="min-w-0 break-words"><span class="font-bold">{det.name}</span> <span class="tchip">{det.tierLabel}</span></div>
                <button class="text-textcolor2 hover:text-red-500" data-testid="entry-detail-close" aria-label="Đóng chi tiết" onclick={(e) => { e.stopPropagation(); detail = null }}>✕</button>
            </div>
            <div class="text-xs mt-1 break-words" data-testid="entry-detail-stat">{det.stat}</div>
            <div class="text-xs break-words" data-testid="entry-detail-rule">{det.rule}</div>
            <div class="mt-1 break-words" data-testid="entry-detail-effect">Công dụng: {det.effect}</div>
            {#if det.conditions}<div class="break-words" data-testid="entry-detail-conditions">Điều kiện: {det.conditions}</div>{/if}
        </div>
    {/if}
{/snippet}

<div class="inv-root mt-4 w-full max-w-full shrink-0 rounded-md border border-darkborderc p-4" data-risu-persona-inventory>
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

        <h4 class="mt-4 mb-1 font-bold">{inv.skillHeading}</h4>
        <div class="grid gap-2 cards">
            {#each inv.openSkillSlots as c (c.index)}
                <div class="card bg-darkbg {c.tier ? TIER_CLASS[c.tier] : ''}" class:clickable={!!c.skillId} data-slot={c.index} data-testid="skill-slot-{c.index}" role={c.skillId ? 'button' : undefined} tabindex={c.skillId ? 0 : undefined} onclick={c.skillId ? (e) => toggleDetail(e, 'skill', c.skillId as string, 'card') : undefined} onkeydown={c.skillId ? (e) => onKey(e, 'skill', c.skillId as string, 'card') : undefined}>
                    <div class="text-xs text-textcolor2">Slot {c.index + 1}</div>
                    {#if c.skillId}
                        <div class="name">{c.name}</div>
                        {#if c.tier}<span class="tchip">{TIER_LABEL[c.tier]}</span>{/if}
                        <div class="bar" data-testid="skill-expbar-{c.skillId}"><div style="width: {c.prog?.barPct ?? 0}%"></div></div>
                        <div class="text-xs" data-testid="skill-level-{c.skillId}">{c.prog?.text ?? ''}</div>
                        <button class="text-textcolor2 hover:text-red-500" disabled={busy} onclick={() => unequip(c.index)}>Gỡ</button>
                        {@render effectToggle('skill', c.skillId)}{@render effectInline('skill', c.skillId)}
                    {:else}
                        <button class="hover:text-green-500" disabled={busy} data-testid="skill-slot-add-{c.index}" onclick={() => slotPick = slotPick?.kind === 'skill' && slotPick.slot === c.index ? null : { kind: 'skill', slot: c.index }}>+ Gắn</button>
                    {/if}
                </div>
            {/each}
        </div>
        {#if detail?.src === 'card' && detail.kind === 'skill'}{@render detailBlock()}{/if}
        {#if slotPick?.kind === 'skill'}
            <div class="flex gap-1 flex-wrap mt-1 text-xs" data-testid="skill-slot-picker">
                {#if inv.pickableSkills.length === 0}<span class="text-textcolor2">Không còn kỹ năng nào để gắn</span>{/if}
                {#each inv.pickableSkills as k (k.id)}<button class="chip on" disabled={busy} data-testid="slot-pick-skill-{k.id}" onclick={() => equip(k.id, (slotPick as any).slot)}>{k.text}</button>{/each}
            </div>
        {/if}
        {#if inv.skillLockedLine}<p class="text-sm text-textcolor2 mt-1" data-testid="skill-locked-line">{inv.skillLockedLine}</p>{/if}

        <h4 class="mt-4 mb-1 font-bold">{inv.itemHeading}</h4>
        <div class="grid gap-2 cards">
            {#each inv.openItemSlots as c (c.index)}
                <div class="card bg-darkbg {c.tier ? TIER_CLASS[c.tier] : ''}" class:clickable={!!c.itemId} data-testid="item-slot-{c.index}" role={c.itemId ? 'button' : undefined} tabindex={c.itemId ? 0 : undefined} onclick={c.itemId ? (e) => toggleDetail(e, 'item', c.itemId as string, 'card') : undefined} onkeydown={c.itemId ? (e) => onKey(e, 'item', c.itemId as string, 'card') : undefined}>
                    <div class="text-xs text-textcolor2">Slot {c.index + 1}</div>
                    {#if c.itemId}
                        <div class="name">{c.name}</div>
                        {#if c.tier}<span class="tchip">{TIER_LABEL[c.tier]}</span>{/if}
                        <div class="text-xs">× {c.qty}</div>
                        <button class="text-textcolor2 hover:text-red-500" disabled={busy} data-testid="item-unequip-{c.index}" onclick={() => unequipI(c.index)}>Gỡ</button>
                        {@render effectToggle('item', c.itemId)}{@render effectInline('item', c.itemId)}
                    {:else}
                        <button class="hover:text-green-500" disabled={busy} data-testid="item-slot-add-{c.index}" onclick={() => slotPick = slotPick?.kind === 'item' && slotPick.slot === c.index ? null : { kind: 'item', slot: c.index }}>+ Gắn</button>
                    {/if}
                </div>
            {/each}
        </div>
        {#if detail?.src === 'card' && detail.kind === 'item'}{@render detailBlock()}{/if}
        {#if slotPick?.kind === 'item'}
            <div class="flex gap-1 flex-wrap mt-1 text-xs" data-testid="item-slot-picker">
                {#if inv.pickableItems.length === 0}<span class="text-textcolor2">Không còn vật phẩm nào để gắn</span>{/if}
                {#each inv.pickableItems as k (k.id)}<button class="chip on" disabled={busy} data-testid="slot-pick-item-{k.id}" onclick={() => equipI(k.id, (slotPick as any).slot)}>{k.name} · {k.label}</button>{/each}
            </div>
        {/if}
        {#if inv.itemLockedLine}<p class="text-sm text-textcolor2 mt-1" data-testid="item-locked-line">{inv.itemLockedLine}</p>{/if}
        <div class="flex gap-2 flex-wrap mt-2 items-center text-sm">
            <label for="item-slots-limit">Số slot item:</label>
            <input id="item-slots-limit" class="w-16 rounded bg-darkbg p-1 text-center" type="number" min="1" max="11" bind:value={limitText} data-testid="item-slots-limit" />
            <button class="chip on" disabled={busy} data-testid="item-slots-apply" onclick={applyLimit}>Đặt</button>
            <span class="text-textcolor2">(mặc định {inv.itemSlotsDefault})</span>
            <button class="chip" disabled={busy || inv.itemSlotsLimit === null} data-testid="item-slots-reset" onclick={resetLimit}>Về mặc định</button>
        </div>

        <div class="flex gap-1 flex-wrap mt-4 items-center">
            <button class="chip {filter === 'all' ? 'on' : ''}" onclick={() => filter = 'all'}>Tất cả</button>
            {#each TIERS as t}
                <button class="chip {TIER_CLASS[t]} {filter === t ? 'on' : ''}" onclick={() => filter = t}>{TIER_LABEL[t]}</button>
            {/each}
        </div>
        {#if note}<p class="text-sm text-red-500 mt-2" data-note>{note}</p>{/if}

        <div class="flex items-center justify-between mt-3">
            <h4 class="font-bold">Kỹ năng: {inv.skillCount}</h4>
            <button class="text-textcolor2" data-testid="skills-toggle" aria-expanded={skillsOpen} onclick={() => skillsOpen = !skillsOpen}>{skillsOpen ? 'Thu gọn ▲' : 'Mở rộng ▼'}</button>
        </div>
        <div class="mb-1">{@render allButtons('skill')}</div>
        {#if inv.skillsFull}<p class="text-sm text-red-500" data-testid="storage-full-skills">Kho kỹ năng đầy: không nhận thêm kỹ năng mới</p>{/if}
        {#if skillsOpen}
        {#if inv.skills.length === 0}<p class="text-sm text-textcolor2">Không có kỹ năng nào.</p>{/if}
        <ul class="flex flex-col gap-1">
            {#each inv.skills as k (k.id)}
                <li class="rounded-md bg-darkbg p-2 text-sm clickable" data-testid="skill-row-{k.id}" role="button" tabindex="0" onclick={(e) => toggleDetail(e, 'skill', k.id, 'row')} onkeydown={(e) => onKey(e, 'skill', k.id, 'row')}>
                    <div class="flex justify-between flex-wrap gap-1">
                        <div class="{k.cls} min-w-0 break-words"><span data-testid="skill-level-{k.id}">{k.text}</span><div class="bar" data-testid="skill-expbar-{k.id}"><div style="width: {k.prog.barPct}%"></div></div>{#if k.slot !== null} <span class="text-green-500">· slot {k.slot + 1}</span>{/if}</div>
                        <span class="flex gap-2">
                            {#if k.slot === null}<button class="hover:text-green-500" disabled={busy} onclick={() => picking = picking === k.id ? null : k.id}>Gắn</button>
                            {:else}<button class="hover:text-green-500" disabled={busy} onclick={() => unequip(k.slot as number)}>Gỡ</button>{/if}
                            <button class="hover:text-red-500" disabled={busy} onclick={() => remove('skill', k.id, k.name, k.slot)}>Xoá</button>
                        </span>
                    </div>
                    {@render effectToggle('skill', k.id)}{@render effectInline('skill', k.id)}
                    {#if detail?.src === 'row' && detail.kind === 'skill' && detail.id === k.id}{@render detailBlock()}{/if}
                    {#if picking === k.id}
                        <div class="flex gap-1 flex-wrap mt-1 text-xs">
                            {#if inv.freeOpenSlots.length === 0}<span class="text-textcolor2">Không còn slot trống đã mở</span>{/if}
                            {#each inv.freeOpenSlots as s}<button class="chip on" disabled={busy} onclick={() => equip(k.id, s)}>Slot {s + 1}</button>{/each}
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>
        {/if}

        <div class="flex items-center justify-between mt-3">
            <h4 class="font-bold">Vật phẩm: {inv.itemCount}</h4>
            <button class="text-textcolor2" data-testid="items-toggle" aria-expanded={itemsOpen} onclick={() => itemsOpen = !itemsOpen}>{itemsOpen ? 'Thu gọn ▲' : 'Mở rộng ▼'}</button>
        </div>
        <div class="mb-1">{@render allButtons('item')}</div>
        {#if inv.itemsFull}<p class="text-sm text-red-500" data-testid="storage-full-items">Kho vật phẩm đầy: không nhận thêm vật phẩm mới</p>{/if}
        {#if itemsOpen}
        {#if inv.items.length === 0}<p class="text-sm text-textcolor2">Không có vật phẩm nào.</p>{/if}
        <ul class="flex flex-col gap-1">
            {#each inv.items as i (i.id)}
                {@const block = itemEquipBlock(inv, i.slot)}
                <li class="rounded-md bg-darkbg p-2 text-sm clickable" data-testid="item-row-{i.id}" role="button" tabindex="0" onclick={(e) => toggleDetail(e, 'item', i.id, 'row')} onkeydown={(e) => onKey(e, 'item', i.id, 'row')}>
                    <div class="flex justify-between flex-wrap gap-1">
                        <span class="{i.cls} min-w-0 break-words">{i.name} × {i.qty} · {i.label}{#if i.slot !== null} <span class="text-green-500" data-testid="item-equipped-{i.id}">· Đã gắn (slot {i.slot + 1})</span>{/if}</span>
                        <span class="flex gap-2">
                            <button class="hover:text-green-500 disabled:opacity-40" disabled={busy || block !== null} title={block ?? ''} data-testid="item-equip-{i.id}" onclick={() => pickingItem = pickingItem === i.id ? null : i.id}>Gắn</button>
                            <button class="hover:text-red-500" disabled={busy} onclick={() => remove('item', i.id, i.name, null)}>Xoá</button>
                        </span>
                    </div>
                    {#if block !== null && i.slot === null}<div class="text-xs text-textcolor2">{block}</div>{/if}
                    {@render effectToggle('item', i.id)}{@render effectInline('item', i.id)}
                    {#if detail?.src === 'row' && detail.kind === 'item' && detail.id === i.id}{@render detailBlock()}{/if}
                    {#if pickingItem === i.id}
                        <div class="flex gap-1 flex-wrap mt-1 text-xs">
                            {#each inv.freeOpenItemSlots as s}
                                {@const cur = inv.itemSlots[s]}
                                <button class="chip on" disabled={busy} data-testid="item-slot-pick-{s}" onclick={() => equipI(i.id, s)}>Slot {s + 1}: {cur.itemId ? `${cur.name} (thay)` : 'trống'}</button>
                            {/each}
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>
        {/if}

        <h4 class="mt-3 mb-1 font-bold">Trần chỉ số ở {inv.rankName.split(' ')[0]}</h4>
        <div class="grid gap-2" data-testid="stat-caps" style="grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr))">
            {#each inv.caps as c (c.key)}<div class="rounded-md bg-darkbg p-2 text-sm flex justify-between flex-wrap gap-x-2 min-w-0"><span class="min-w-0 break-words">{c.label}</span><span class="font-mono">{c.cap}</span></div>{/each}
        </div>
    {:else}
        <p class="text-sm text-textcolor2 mt-2">Đang tải…</p>
    {/if}
</div>

<style>
    /* clip, not hidden: `hidden` makes the root a scroll container, and a flex column then shrinks it to a few hundred px with its own scroll */
    .inv-root { overflow-x: clip; flex-shrink: 0; min-height: auto }
    button, input { min-height: 44px; min-width: 44px }
    .cards { grid-template-columns: repeat(auto-fill, minmax(min(120px, 100%), 1fr)) }
    .card { border-radius: 0.375rem; padding: 0.5rem; font-size: 0.875rem; min-width: 0; min-height: 7.5rem; display: flex; flex-direction: column; gap: 0.25rem }
    .inline-effect { overflow-wrap: anywhere; min-width: 0; max-width: 100% }
    .clickable { cursor: pointer }
    .detail { overflow-wrap: anywhere; min-width: 0; max-width: 100%; border: 1px solid currentColor }
    .name { overflow-wrap: anywhere }
    .tchip { align-self: flex-start; border: 1px solid currentColor; border-radius: 9999px; padding: 0 0.5rem; font-size: 0.7rem }
    .bar { height: 6px; border-radius: 3px; background: rgba(128,128,128,.3); overflow: hidden }
    .bar > div { height: 100%; background: currentColor }
    .chip { border: 1px solid currentColor; border-radius: 9999px; padding: 0 0.8rem; font-size: 0.75rem; opacity: 0.6 }
    .chip.on { opacity: 1; font-weight: 700 }
    .tier-bronze { color: #cd7f32 }
    .tier-silver { color: #c0c0c0 }
    .tier-gold { color: #f5c518 }
    .tier-platinum { color: #5fd3d3 }
    .tier-diamond { color: #7fb5ff }
</style>
