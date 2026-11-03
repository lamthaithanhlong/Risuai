// @vitest-environment node
// server/node/assetsProxy.cjs: Risu's /api/assets/* reaches the asset manager (127.0.0.1:6110) only with risu-auth, and passes on
// nothing but the method, the path, the query and a JSON body.
import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const require = createRequire(import.meta.url)
const express = require('express')
const { mountAssets } = require('../../../server/node/assetsProxy.cjs')

const servers: http.Server[] = []
const listen = (s: http.Server) => new Promise<number>((r) => { servers.push(s); s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)) })
afterEach(() => { for (const s of servers.splice(0)) s.close() })

async function setup(targetUp = true) {
    const seen: { method: string, url: string, headers: http.IncomingHttpHeaders, body: string }[] = []
    let target = 'http://127.0.0.1:9'          // nothing listens on the discard port
    if (targetUp) {
        const port = await listen(http.createServer((req, res) => {
            let body = ''
            req.on('data', (c) => { body += c })
            req.on('end', () => {
                seen.push({ method: req.method!, url: req.url!, headers: req.headers, body })
                res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/json')
                res.end(req.url === '/' ? '<!doctype html><title>Asset Manager</title>' : JSON.stringify({ ok: true }))
            })
        }))
        target = `http://127.0.0.1:${port}`
    }
    const app = express()
    app.use(express.json())
    const auth = async (req: any, res: any) => {
        if (req.headers['risu-auth'] === 'good') return true
        res.status(400).send({ error: 'No auth header' })
        return false
    }
    mountAssets(app, { auth, limiter: (_req: any, _res: any, next: any) => next(), target })
    const port = await listen(http.createServer(app))
    return { seen, base: `http://127.0.0.1:${port}` }
}

describe('assetsProxy', () => {
    it('refuses a call without risu-auth and never reaches the asset manager', async () => {
        const { seen, base } = await setup()
        const r = await fetch(`${base}/api/assets/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":"x"}' })
        expect(r.status).toBe(400)
        expect((await fetch(`${base}/api/assets/meta`)).status).toBe(400)
        expect(seen).toEqual([])
    })
    it('forwards an authorized call: /api/assets/<rest> -> /api/<rest>, query and JSON body kept, risu-auth and cookies dropped', async () => {
        const { seen, base } = await setup()
        const g = await fetch(`${base}/api/assets/assets?card=zombie&type=character`, { headers: { 'risu-auth': 'good', Cookie: 'a=b' } })
        expect(g.status).toBe(200)
        const p = await fetch(`${base}/api/assets/save`, {
            method: 'POST', headers: { 'risu-auth': 'good', 'Content-Type': 'application/json', Origin: 'https://10.0.0.5:6443' },
            body: JSON.stringify({ id: 'zombie:characters/evelyn', sections: { Voice: 'Tớ đây.' } }),
        })
        expect(await p.json()).toEqual({ ok: true })
        expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /api/assets?card=zombie&type=character', 'POST /api/save'])
        expect(JSON.parse(seen[1].body)).toEqual({ id: 'zombie:characters/evelyn', sections: { Voice: 'Tớ đây.' } })
        for (const s of seen) {
            expect(s.headers['risu-auth']).toBeUndefined()
            expect(s.headers.cookie).toBeUndefined()
            expect(s.headers.origin).toBeUndefined()
        }
    })
    it('serves the page without a header (a frame cannot send one); the page holds no data', async () => {
        const { base } = await setup()
        const r = await fetch(`${base}/assets-ui/`)
        expect(r.status).toBe(200)
        expect(await r.text()).toContain('Asset Manager')
    })
    it('says the asset manager is down instead of hanging', async () => {
        const { base } = await setup(false)
        const r = await fetch(`${base}/api/assets/meta`, { headers: { 'risu-auth': 'good' } })
        expect(r.status).toBe(502)
        expect((await r.json()).error).toContain('com.risu.assets')
    })
})
