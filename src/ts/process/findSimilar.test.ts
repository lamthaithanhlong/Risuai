// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { similar, similarTokens } from './findSimilar.mjs'

// the 12 finds one real gate run saved (names in English)
const TWELVE = ['Stairwell Rhythm', 'Evacuation Map Reading', 'Wipe Mark Reading', 'Background Separation', 'Wall-Voice Separation', 'Cloth Tape', 'Echo Direction', 'Keychain Flashlight', 'Sound Rhythm', 'Threshold Trace Reading', 'Dust Trace Reading', 'Cut-Resistant Work Gloves']
// the pairs that really are the same find under two names
const NEAR = new Set(['Sound Rhythm|Stairwell Rhythm', 'Dust Trace Reading|Threshold Trace Reading', 'Background Separation|Wall-Voice Separation'])
const key = (a: string, b: string) => [a, b].sort().join('|')
const EXTRA: [string, string][] = [['Stairwell Blind-Corner Check', 'Reflection Check'], ['Layered Listening', 'Floor Vibration Listening'], ['Floor Vibration Sense', 'Floor Vibration Listening'], ['Quiet Step', 'Quiet Breathing'], ['Night Vision Goggles', 'goggles, night vision'], ['Rusty Key', 'Rusty Crowbar'], ['Map Reading', 'Evacuation Map Reading'], ['Muffled Footsteps', 'Footstep Muffling']]

function pairs() {
    const out: [string, string][] = []
    for (let i = 0; i < TWELVE.length; i++) for (let j = i + 1; j < TWELVE.length; j++) out.push([TWELVE[i], TWELVE[j]])
    return [...out, ...EXTRA]
}

describe('similar (the same find under another English name)', () => {
    test('flags the rhythm pair the real run saved twice, and no pair of unrelated names among the 12', () => {
        expect(similar('Sound Rhythm', 'Stairwell Rhythm')).toBe(true)
        const flagged = pairs().filter(([a, b]) => similar(a, b)).map(([a, b]) => key(a, b)).filter((k) => !EXTRA.some(([a, b]) => key(a, b) === k))
        expect(new Set(flagged)).toEqual(NEAR)
    })
    test('shared first word alone is not enough; shared head noun or two shared words is', () => {
        expect(similar('Quiet Step', 'Quiet Breathing')).toBe(false)
        expect(similar('Rusty Key', 'Rusty Crowbar')).toBe(false)
        expect(similar('Night Vision Goggles', 'goggles, night vision')).toBe(true)
        expect(similar('Iron Will', 'Will of Iron')).toBe(true)
        expect(similar('Echo Direction', 'Echo Direction Sense')).toBe(true)
    })
    test('generic words are dropped unless nothing else is left; empty names are never similar', () => {
        expect(similarTokens('Trace Reading')).toEqual(['trace'])
        expect(similarTokens('Reading')).toEqual(['reading'])
        expect(similar('', 'Sound Rhythm')).toBe(false)
        expect(similar('Reading', 'Sense')).toBe(false)
    })
    test('a generic head noun alone is not a twin (w5c gate: "check" dropped a new find)', () => {
        expect(similar('Stairwell Blind-Corner Check', 'Reflection Check')).toBe(false)
        expect(similar('Layered Listening', 'Floor Vibration Listening')).toBe(false)
        expect(similarTokens('Stairwell Blind-Corner Check')).toEqual(['stairwell', 'blind', 'corner'])
        // still twins: the specific words are shared
        expect(similar('Floor Vibration Sense', 'Floor Vibration Listening')).toBe(true)
        expect(similar('Sound Rhythm', 'Stairwell Rhythm')).toBe(true)
        expect(similar('Stairwell Blind-Corner Check', 'Stairwell Corner Check')).toBe(true)
    })
    test('the Python rule (tools/assets/finds.py similar) agrees on every pair', () => {
        const tools = join(homedir(), 'Downloads', 'apocalypse-tham-hoa-zombie', 'tools', 'assets')
        if (!existsSync(join(tools, 'finds.py'))) return
        const all = pairs()
        const code = 'import sys,json\nsys.path.insert(0,sys.argv[1])\nimport finds\nprint(json.dumps([finds.similar(a,b) for a,b in json.load(sys.stdin)]))'
        const py = JSON.parse(execFileSync('python3', ['-c', code, tools], { input: JSON.stringify(all), encoding: 'utf8' }).trim().split('\n').at(-1) as string)
        expect(py).toEqual(all.map(([a, b]) => similar(a, b)))
        expect(py.filter(Boolean).length).toBeGreaterThanOrEqual(NEAR.size)
    })
})
