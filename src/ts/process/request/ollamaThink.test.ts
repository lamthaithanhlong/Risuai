import { describe, expect, it } from 'vitest'
import { ollamaNeedsProsePass } from './ollamaThink'

describe('ollamaNeedsProsePass', () => {
    it('requests a prose pass only when generation ended in thinking', () => {
        expect(ollamaNeedsProsePass('', 'nghĩ', 'length')).toBe(true)
        expect(ollamaNeedsProsePass('', 'nghĩ', 'stop')).toBe(false)
        expect(ollamaNeedsProsePass('', '', 'length')).toBe(false)
        expect(ollamaNeedsProsePass('reply', 'nghĩ', 'length')).toBe(false)
    })
})
