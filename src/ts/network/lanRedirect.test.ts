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

describe('only a private LAN host is redirected (Host header injection)', () => {
    const { lanRedirectTarget, isPrivateLanHost } = require('../../../server/node/lanRedirect.cjs')
    test('the Mac LAN address and .local names are sent on', () => {
        expect(lanRedirectTarget('10.0.0.164:6001', '10.0.0.7', '/x', 6443)).toBe('https://10.0.0.164:6443/x')
        expect(lanRedirectTarget('192.168.1.20:6001', '192.168.1.5', '/', 6443)).toBe('https://192.168.1.20:6443/')
        expect(lanRedirectTarget('Longs-Mac-mini.local:6001', '10.0.0.7', '/', 6443)).toBe('https://longs-mac-mini.local:6443/')
    })
    test('a Host that names another site is never an open redirect', () => {
        expect(lanRedirectTarget('evil.example.com', '10.0.0.7', '/', 6443)).toBeNull()
        expect(lanRedirectTarget('8.8.8.8:6001', '10.0.0.7', '/', 6443)).toBeNull()
        expect(lanRedirectTarget('evil.com@10.0.0.1', '10.0.0.7', '/', 6443)).toBeNull()
    })
    test('address ranges', () => {
        expect(isPrivateLanHost('172.16.0.1')).toBe(true)
        expect(isPrivateLanHost('172.32.0.1')).toBe(false)
        expect(isPrivateLanHost('10.0.0.256')).toBe(false)
        expect(isPrivateLanHost('169.254.1.1')).toBe(true)
    })
})
