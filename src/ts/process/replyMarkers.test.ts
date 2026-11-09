import { describe, expect, test } from 'vitest'
import { stripMarkers } from './replyMarkers'

describe('stripMarkers', () => {
    test('removes §...§ wrappers keeping inner content', () => {
        expect(stripMarkers('Hello §world§!')).toBe('Hello world!')
        expect(stripMarkers('§start§ middle §end§')).toBe('start middle end')
        expect(stripMarkers('§only§')).toBe('only')
    })

    test('handles nested/adjacent §§', () => {
        expect(stripMarkers('§§')).toBe('')
        expect(stripMarkers('§a§§b§')).toBe('ab')
        expect(stripMarkers('§a§§b§§c§')).toBe('abc')
    })

    test('removes stray single §', () => {
        expect(stripMarkers('Hello § world')).toBe('Hello  world')
        expect(stripMarkers('§')).toBe('')
        expect(stripMarkers('a§b§c')).toBe('abc')
    })

    test('empty string returns empty', () => {
        expect(stripMarkers('')).toBe('')
    })

    test('string with no markers is identity', () => {
        expect(stripMarkers('Hello world')).toBe('Hello world')
        expect(stripMarkers('No markers here!')).toBe('No markers here!')
    })
})