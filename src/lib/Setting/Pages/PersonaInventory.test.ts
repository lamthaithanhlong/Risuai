// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

const view = {
    persona: 'k', level: 12, rank: 2, slots_open: 3, max_storage: 3, stat_cap: 28, stat_caps: {},
    skills: [
        { id: 'wall-vibration-listening', name: 'wall-vibration-listening', tier: 'gold', mastery: 2500 },
        { id: 'rhythm-separation', name: 'Tách nhịp', tier: 'bronze', mastery: 100 },
        { id: 'void-eye-scan', name: '', tier: 'silver', mastery: 0 },
    ],
    items: [
        { id: 'rusty-knife', name: 'rusty-knife', tier: 'bronze', qty: 2 },
        { id: 'old-laptop', name: 'old-laptop', tier: 'silver', qty: 1 },
    ],
    slots: ['wall-vibration-listening', null, null, null, null, null, null, null, null, null, null],
    skill_count: 105, item_count: 2,
    item_slots: [null, 'rusty-knife', ...Array(9).fill(null)], item_slots_open: 3, item_slots_limit: null, item_slots_default: 3,
}
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { personas: [{}], selectedPersona: 0 } } }))
vi.mock('src/ts/storage/database.svelte', () => ({ getCurrentChat: () => ({ scriptstate: { $lvl: '{"l":12,"e":5}' } }) }))
vi.mock('src/ts/alert', () => ({ alertConfirm: async () => true }))
vi.mock('src/ts/util', () => ({ checkPersonaBinded: () => ({ name: 'k' }) }))
vi.mock('src/ts/process/statsGlue', () => ({ personaIdOf: () => 'k' }))
vi.mock('src/ts/storage/statsSave', () => ({ fetchLedger: async () => null }))
vi.mock('src/ts/storage/personaStore', async (orig) => ({
    ...(await orig<any>()),
    fetchPersona: async () => ({ ok: true, data: view }),
    equipSkill: vi.fn(async () => ({ ok: true })), unequipSkill: vi.fn(async () => ({ ok: true })), deleteEntry: vi.fn(async () => ({ ok: true })),
    equipItem: vi.fn(async () => ({ ok: true })), unequipItem: vi.fn(async () => ({ ok: true })), setItemSlots: vi.fn(async () => ({ ok: true })),
}))

import { mount, unmount, flushSync } from 'svelte'
import PersonaInventory from './PersonaInventory.svelte'
import * as store from 'src/ts/storage/personaStore'

const wait = () => new Promise((r) => setTimeout(r, 20))
let m: any
afterEach(() => { if (m) unmount(m); m = null; document.body.innerHTML = '' })
async function render() {
    const target = document.createElement('div'); document.body.appendChild(target)
    m = mount(PersonaInventory, { target }); await wait(); flushSync()
    return target
}
const KEBAB = /[a-z0-9]+(-[a-z0-9]+)+/
const q = (t: HTMLElement, id: string) => t.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

it('no kebab-case id is visible anywhere (text, title, aria-label, value), names are Vietnamese', async () => {
    const t = await render()
    t.querySelectorAll('[data-testid^="skill-slot-add"]').forEach((b) => (b as HTMLElement).click())
    flushSync()
    const seen = [t.textContent ?? '', ...[...t.querySelectorAll('[title],[aria-label],input')].map((e) => `${e.getAttribute('title')} ${e.getAttribute('aria-label')} ${(e as HTMLInputElement).value}`)]
    for (const s of seen) expect(s).not.toMatch(KEBAB)
    expect(t.textContent).toContain('Nghe rung tường')
    expect(t.textContent).toContain('Dao gỉ')
    expect(t.textContent).toContain('Quét mắt hư không')
})

it('only open slots are drawn, with ONE locked line each; headings and testids', async () => {
    const t = await render()
    expect(t.textContent).toContain('Slot kỹ năng · đang mở 1/3 (tối đa 11)')
    expect(t.textContent).toContain('Slot trang bị · đang mở 1/3 (tối đa 11)')
    expect(q(t, 'skill-locked-line')?.textContent).toBe('🔒 Mở thêm 1 slot ở Lv 21 (còn 8 slot khoá)')
    expect(q(t, 'item-locked-line')?.textContent).toContain('còn 8 slot khoá')
    expect(t.querySelectorAll('[data-testid^="skill-slot-"]:not([data-testid*="add"])').length).toBe(3)
    expect(q(t, 'item-slot-3')).toBeNull()
    expect(t.textContent).not.toContain('khoá ·')
    expect(q(t, 'item-unequip-1')).not.toBeNull()
})

it('the skills and items lists collapse; the full-storage labels show', async () => {
    const t = await render()
    expect(q(t, 'storage-full-skills')).not.toBeNull()
    expect(q(t, 'item-equip-old-laptop')).not.toBeNull()
    q(t, 'items-toggle')!.click(); flushSync()
    expect(q(t, 'item-equip-old-laptop')).toBeNull()
    q(t, 'items-toggle')!.click(); flushSync()
    expect(q(t, 'item-equip-old-laptop')).not.toBeNull()
    q(t, 'skills-toggle')!.click(); flushSync()
    expect(t.textContent).not.toContain('Tách nhịp · Đồng')
})

it('an empty slot "+ Gắn" opens a picker and picking equips; item row Gắn picks a slot', async () => {
    const t = await render()
    q(t, 'skill-slot-add-1')!.click(); flushSync()
    q(t, 'slot-pick-skill-rhythm-separation')!.click(); await wait()
    expect(store.equipSkill).toHaveBeenCalledWith('k', 1, 'rhythm-separation', 12)
    q(t, 'item-equip-old-laptop')!.click(); flushSync()
    q(t, 'item-slot-pick-1')!.click(); await wait()
    expect(store.equipItem).toHaveBeenCalledWith('k', 1, 'old-laptop', 12)
    q(t, 'item-slots-reset') // exists
})

it('the root never becomes a scroll container (it keeps its natural height in the settings column); one word, Gỡ, removes an equipped entry', async () => {
    const t = await render()
    const root = t.querySelector('[data-risu-persona-inventory]') as HTMLElement
    expect(root.className).not.toContain('overflow-x-hidden')
    expect(root.className).toContain('shrink-0')
    expect(q(t, 'item-unequip-1')!.textContent).toBe('Gỡ')
    expect(t.textContent).not.toContain('Bỏ gắn')
    expect(q(t, 'stat-caps')!.getAttribute('style')).toContain('min(140px, 100%)')
})
