import { describe, expect, test } from 'vitest'
import { isPageRemoteFromLocalhost, shouldRouteViaServer } from './localNetwork'

describe('shouldRouteViaServer', () => {
    test('phone on the LAN address, API at localhost: go through the server', () => {
        expect(shouldRouteViaServer('http://localhost:20128/v1/chat/completions', '10.0.0.164', true)).toBe(true)
    })

    test('the Mac itself on localhost: direct, as before', () => {
        expect(shouldRouteViaServer('http://localhost:20128/v1/chat/completions', 'localhost', true)).toBe(false)
        expect(shouldRouteViaServer('http://127.0.0.1:20128/v1', '127.0.0.1', true)).toBe(false)
    })

    test('a public API is never routed through the server by this rule', () => {
        expect(shouldRouteViaServer('https://api.openai.com/v1/chat/completions', '10.0.0.164', true)).toBe(false)
    })

    test('without the Node server there is no proxy to reach the LAN, so nothing changes', () => {
        expect(shouldRouteViaServer('http://localhost:20128/v1', 'risuai.xyz', false)).toBe(false)
    })
})

describe('isPageRemoteFromLocalhost', () => {
    test('LAN addresses and host names are remote, loopback is not', () => {
        expect(isPageRemoteFromLocalhost('10.0.0.164')).toBe(true)
        expect(isPageRemoteFromLocalhost('Longs-Mac-mini.local')).toBe(true)
        expect(isPageRemoteFromLocalhost('localhost')).toBe(false)
        expect(isPageRemoteFromLocalhost('[::1]')).toBe(false)
        expect(isPageRemoteFromLocalhost('')).toBe(false)
    })
})
