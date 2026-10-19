// One id per browser tab, so the server can tell two tabs of one browser apart (they share the signing key in IndexedDB).
// sessionStorage is per tab and survives a reload of that tab, which is what the server's merge base needs: a reload is the same
// page loading again, a second tab is a second page. Without sessionStorage (private mode quirks) one id per page load is used.
const KEY = 'risu-tab-id'
let fallback: string | null = null

export function tabId(): string {
    try {
        const stored = sessionStorage.getItem(KEY)
        if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) return stored
        const id = crypto.randomUUID()
        sessionStorage.setItem(KEY, id)
        return id
    } catch {
        fallback ??= crypto.randomUUID()
        return fallback
    }
}
