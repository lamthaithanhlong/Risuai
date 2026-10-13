// A page that registers a service worker reloads once when the worker does not answer yet (first visit, the worker is
// not controlling the page). If it still does not answer after that reload it never will on this device (self-signed
// HTTPS on iOS, a webview), and reloading again is a loop that looks like "loading forever". This allows the reload
// once per browser session and says no the second time, so the app runs without the worker instead.

const KEY = 'risu-sw-reload'

export function takeSwReload(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): boolean {
    try {
        if (!storage || storage.getItem(KEY) === '1') {
            return false
        }
        storage.setItem(KEY, '1')
        return true
    } catch {
        return false           // no storage to remember the reload in: never risk a loop
    }
}

export function clearSwReload(storage: Pick<Storage, 'removeItem'> | undefined) {
    try {
        storage?.removeItem(KEY)
    } catch {}
}
