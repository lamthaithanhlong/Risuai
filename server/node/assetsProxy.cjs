// The asset manager of the owner's cards (apocalypse-tham-hoa-zombie/tools/assets, a Python server on 127.0.0.1:6110, launchd
// com.risu.assets) inside Risu: Settings > Asset Manager shows its page in a frame, and its calls come through here.
//
// Why behind checkAuth: :6001 is also the phone's server (lan-tls pipes :6443 into it from localhost, so every LAN request looks
// like 127.0.0.1 here), and the asset manager writes the lore files and restarts this server on Push live. Only a page signed in to
// Risu reaches it; :6110 itself stays loopback only.
//
//   GET  /assets-ui/            the page (static HTML, no data, so no header needed: a frame cannot send one)
//   ANY  /api/assets/<rest>     -> http://127.0.0.1:6110/api/<rest>, risu-auth required
const DEFAULT_TARGET = process.env.RISU_ASSETS_URL || 'http://127.0.0.1:6110'

function mountAssets(app, { auth, limiter, target = DEFAULT_TARGET, fetch = globalThis.fetch, log = () => {} }) {
    const down = (res, e) => {
        log(`[Assets] ${e.message}`)
        res.status(502).send({ error: 'the asset manager is not running (launchd com.risu.assets, 127.0.0.1:6110)' })
    }
    app.get(['/assets-ui', '/assets-ui/'], limiter, async (req, res) => {
        try {
            const r = await fetch(`${target}/`)
            res.status(r.status).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-store').send(await r.text())
        } catch (e) { down(res, e) }
    })
    app.all(/^\/api\/assets\/(.+)$/, limiter, async (req, res) => {
        if (!await auth(req, res)) return
        const rest = req.params[0]
        const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
        const post = req.method === 'POST'
        try {
            // only the method, the path and a JSON body go on: no cookie, no risu-auth, no Origin (the Python side checks Host/Origin)
            const r = await fetch(`${target}/api/${rest}${query}`, {
                method: post ? 'POST' : 'GET',
                headers: post ? { 'Content-Type': 'application/json' } : {},
                body: post ? JSON.stringify(req.body ?? {}) : undefined,
            })
            res.status(r.status).set('Content-Type', 'application/json; charset=utf-8').set('Cache-Control', 'no-store').send(await r.text())
        } catch (e) { down(res, e) }
    })
}

module.exports = { mountAssets }
