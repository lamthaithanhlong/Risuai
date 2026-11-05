<script lang="ts">
    // "Admin cho truyện này": the on/off switch of the global Admin for this card (adminGlobal.ts adminSwitchState / setAdminSwitch,
    // server/node/adminBridge.cjs POST /api/admin/switch -> the asset manager -> shared/_roles/global.json). A card listed in
    // global.json "locked" shows the switch disabled.
    import { adminCardOf, adminSwitchState, adminSwitchView, setAdminSwitch, type AdminSwitchState } from 'src/ts/process/adminGlobal'
    import { getNodeServerProxyAuth } from 'src/ts/storage/nodeStorage'

    interface Props { chara: { chaId?: string; type?: string; extentions?: Record<string, unknown> } }
    let { chara }: Props = $props()

    const deps = { fetch: (i: string, o?: RequestInit) => fetch(i, o), auth: getNodeServerProxyAuth, log: (m: string) => console.log(m), timeoutMs: 3000 }
    let card = $derived(adminCardOf(chara as never))
    let st: AdminSwitchState | null = $state(null)
    let busy = $state(false)
    let error = $state('')
    let view = $derived(adminSwitchView(st, busy))

    $effect(() => {
        const id = card
        st = null
        error = ''
        adminSwitchState(id, deps).then((s) => { if (id === card) st = s })
    })

    async function flip() {
        if (!st || view.disabled) return
        busy = true
        error = ''
        const id = card
        const r = await setAdminSwitch(id, st.state !== 'on', deps)
        busy = false
        if (id !== card) return
        if (r.state === 'unknown') {
            error = r.locked ? '' : (r.error ?? 'không đổi được')
            st = r.locked ? { ...st, locked: true } : st
            return
        }
        st = r
    }
</script>

<div class="flex items-center gap-2 mt-4 mb-2 text-textcolor" data-testid="admin-switch">
    <button
        type="button"
        role="switch"
        aria-checked={view.checked}
        aria-label="Admin cho truyện này"
        disabled={view.disabled}
        onclick={flip}
        class="relative w-10 h-5 rounded-full transition-colors duration-200 {view.checked ? 'bg-green-600' : 'bg-darkbutton'} {view.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} border border-darkborderc"
    >
        <span class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200 {view.checked ? 'left-5' : 'left-0.5'}"></span>
    </button>
    <span>Admin cho truyện này</span>
    <span class="text-textcolor2 text-sm">{st ? (st.state === 'on' ? 'bật' : st.state === 'off' ? 'tắt' : '') : ''}{view.note ? ` · ${view.note}` : ''}</span>
</div>
{#if error}
    <span class="text-red-500 text-sm">{error}</span>
{/if}
<span class="text-textcolor2 text-xs mb-4">{card}</span>
