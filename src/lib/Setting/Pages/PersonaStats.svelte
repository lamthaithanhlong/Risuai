<script lang="ts">
    // "Chỉ số & Kỹ năng": the selected persona's six stats, skill slots and skill mastery. Read-only: equipping stays a chat command at a
    // resting point. Numbers come from the persona's global store (fetchCurrent); the open chat fills what the store lacks.
    import { DBState } from 'src/ts/stores.svelte'
    import { getCurrentChat } from 'src/ts/storage/database.svelte'
    import { fetchCurrent, fetchLedger, type Current } from 'src/ts/storage/statsSave'
    import { personaIdOf } from 'src/ts/process/statsGlue'
    import { buildView, fetchFindNames, type FindNames } from 'src/ts/process/personaStats'
    import { checkPersonaBinded } from 'src/ts/util'

    const vi = $derived(DBState.db.language === 'vi')
    const L = $derived(vi
        ? { title: 'Chỉ số & Kỹ năng', stats: 'Chỉ số', slots: 'Ô kỹ năng', skills: 'Kỹ năng', none: 'Chưa có chỉ số nào: chỉ số tăng khi chơi truyện có luật tăng trưởng.', noSkills: 'Chưa có kỹ năng.', equipped: 'đang gắn', cap: 'trần', hint: 'Chỉ số tăng nhờ dùng trong truyện. Đổi kỹ năng bằng lệnh trong chat lúc nghỉ ngơi.', store: 'Từ kho chung của persona', chat: 'Từ cuộc trò chuyện đang mở' }
        : { title: 'Stats & Skills', stats: 'Stats', slots: 'Skill slots', skills: 'Skills', none: 'No stats yet: they grow while playing a story that has the growth rules.', noSkills: 'No skills yet.', equipped: 'equipped', cap: 'cap', hint: 'Stats grow through use in the story. Change skills with a chat command at a resting point.', store: "From the persona's global store", chat: 'From the open chat' })

    let current: Current | null = $state(null)
    let ledgerSkills: Record<string, number> | null = $state(null)   // the persona's event ledger's mastery (GET /api/persona/state), null when it has none
    let names: FindNames = $state({})
    let tick = $state(0)

    const persona = $derived(personaIdOf(checkPersonaBinded() ?? DBState.db.personas?.[DBState.db.selectedPersona]))

    $effect(() => {
        const id = persona
        let live = true
        fetchCurrent(id).then((c) => { if (live) current = c })
        fetchLedger(id).then((l) => { if (live) ledgerSkills = l && l.event_count > 0 ? l.skills ?? null : null })
        fetchFindNames().then((n) => { if (live) names = n })
        return () => { live = false }
    })

    // the chat's own values refresh when the page is shown again
    const view = $derived.by(() => { tick; return buildView(current, getCurrentChat()?.scriptstate, names, ledgerSkills) })
</script>

<div class="mt-4 w-full max-w-full rounded-md border border-darkborderc p-4" data-risu-persona-stats>
    <div class="flex items-center justify-between flex-wrap gap-2">
        <h3 class="text-xl font-bold">{L.title}</h3>
        <button class="text-xs text-textcolor2 hover:text-green-500" onclick={() => { tick++; fetchCurrent(persona).then((c) => { current = c }); fetchLedger(persona).then((l) => { ledgerSkills = l && l.event_count > 0 ? l.skills ?? null : null }) }}>↻</button>
    </div>
    <p class="text-xs text-textcolor2 mb-2">{L.hint}{#if view.source !== 'none'} · {view.source === 'store' ? L.store : L.chat}{/if}</p>

    {#if view.source === 'none'}
        <p class="text-sm text-textcolor2">{L.none}</p>
    {/if}

    <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
        {#each view.stats as s (s.key)}
            <div class="rounded-md bg-darkbg p-2">
                <div class="flex justify-between text-sm"><span>{vi ? s.vi : s.en}</span><span class="font-mono">{s.pct}</span></div>
                <div class="h-1.5 mt-1 rounded bg-darkborderc overflow-hidden"><div class="h-full bg-green-500" style="width: {Math.round(s.bar * 100)}%"></div></div>
            </div>
        {/each}
    </div>

    <h4 class="mt-4 mb-1 font-bold">{L.slots}: {view.slots.used}/{view.slots.total}</h4>
    <h4 class="mt-2 mb-1 font-bold">{L.skills}</h4>
    {#if view.skills.length === 0}
        <p class="text-sm text-textcolor2">{L.noSkills}</p>
    {:else}
        <ul class="flex flex-col gap-1">
            {#each view.skills as k (k.id)}
                <li class="rounded-md bg-darkbg p-2">
                    <div class="flex justify-between flex-wrap gap-1 text-sm">
                        <span>{k.name}{#if k.equipped} <span class="text-green-500">· {L.equipped}</span>{/if}</span>
                        <span class="font-mono">{k.pct} · {vi ? k.tier.vi : k.tier.en}</span>
                    </div>
                    <div class="h-1.5 mt-1 rounded bg-darkborderc overflow-hidden"><div class="h-full {k.capped ? 'bg-yellow-500' : 'bg-green-500'}" style="width: {Math.round(k.m / 100)}%"></div></div>
                    <div class="text-xs text-textcolor2 mt-0.5">{L.cap} {k.capPct}</div>
                </li>
            {/each}
        </ul>
    {/if}
</div>
