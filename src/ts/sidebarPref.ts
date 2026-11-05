// Remembers, per device, whether the character sidebar is open.
// UI-only: lives in localStorage, never in the persisted database.
export const SIDEBAR_KEY = 'risu-sidebar-open'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function defaultStore(): Store | undefined {
    try {
        return typeof localStorage === 'undefined' ? undefined : localStorage
    } catch {
        return undefined
    }
}

/** true / false when the user chose before, null when nothing usable is saved. */
export function loadSidebarOpen(storage: Store | undefined = defaultStore()): boolean | null {
    try {
        const v = storage?.getItem(SIDEBAR_KEY)
        if (v === '1') return true
        if (v === '0') return false
    } catch {}
    return null
}

export function saveSidebarOpen(open: boolean, storage: Store | undefined = defaultStore()): void {
    try {
        storage?.setItem(SIDEBAR_KEY, open ? '1' : '0')
    } catch {}
}
