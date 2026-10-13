import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

const { lanRedirectTarget } = createRequire(import.meta.url)('../../../server/node/lanRedirect.cjs') as {
    lanRedirectTarget: (host: string | undefined, remote: string | undefined, url: string, port: number) => string | null
}

describe('lanRedirectTarget', () => {
    test('the phone opening the LAN address over http is sent to https', () => {
        expect(lanRedirectTarget('10.0.0.164:6001', '::ffff:10.0.0.51', '/', 6443)).toBe('https://10.0.0.164:6443/')
        expect(lanRedirectTarget('Longs-Mac-mini.local:6001', '::ffff:10.0.0.51', '/api/read?x=1', 6443)).toBe('https://longs-mac-mini.local:6443/api/read?x=1')
    })

    test('the Mac on localhost keeps plain http', () => {
        expect(lanRedirectTarget('localhost:6001', '::1', '/', 6443)).toBeNull()
        expect(lanRedirectTarget('127.0.0.1:6001', '::ffff:127.0.0.1', '/', 6443)).toBeNull()
    })

    test('the https front connects from loopback, so it is never redirected (no loop)', () => {
        expect(lanRedirectTarget('10.0.0.164:6443', '::ffff:127.0.0.1', '/', 6443)).toBeNull()
    })

    test('missing host header is served normally', () => {
        expect(lanRedirectTarget(undefined, '::ffff:10.0.0.51', '/', 6443)).toBeNull()
    })
})
