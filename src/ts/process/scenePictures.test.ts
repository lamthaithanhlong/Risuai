import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { cardDrawsPictures, cardHasOwnPictures, pictureAllowed, planScenePicture, SCENE_ASK, SCENE_COOLDOWN_MS } from './scenePictures'

const T0 = 1_800_000_000_000
const char = (data: string) => ({ role: 'char', data })
const user = (data: string) => ({ role: 'user', data })
const REPLY = '[[img: A stone granary cellar at night, grain sacks beside a barred wooden door, a small oil lamp]]\n\nCánh cửa sáng trắng biến mất.'

describe('which stories get the built-in pictures', () => {
    it('a card whose script handles [[img:]] keeps its own (the Lua pattern or the text), one without gets them', () => {
        expect(cardDrawsPictures({ triggerscript: [{ effect: [{ type: 'triggerlua', code: 'string.find(text, "%[%[[iI][mM][gG]:%s*(.-)%]%]")' }] }] })).toBe(true)
        expect(cardDrawsPictures({ triggerscript: [{ effect: [{ type: 'triggerlua', code: '-- turns the [[img: …]] line into a picture' }] }] })).toBe(true)
        expect(cardDrawsPictures({ triggerscript: [] })).toBe(false)
        expect(cardDrawsPictures({})).toBe(false)
    })
    it('on the live save: the two story copies with a picture script keep it, their second copies get the built-in one', () => {
        const f = '/private/tmp/claude-501/dbprobe/triggers.json'
        if (!existsSync(f)) return
        const t = JSON.parse(readFileSync(f, 'utf8'))
        expect(cardDrawsPictures({ triggerscript: t['04103f68'] })).toBe(true)     // Shadow Slave
        expect(cardDrawsPictures({ triggerscript: t['22a987d8'] })).toBe(true)     // Lord of the Mysteries
        expect(cardDrawsPictures({ triggerscript: t['b64432e7'] })).toBe(false)    // their second copies
        expect(cardDrawsPictures({ triggerscript: t['88ff3da3'] })).toBe(false)
    })
})

it('on the live save: only the two second copies (no script, no library, no asset command) get the built-in pictures', () => {
    const f = '/private/tmp/claude-501/dbprobe/cards.json'
    if (!existsSync(f)) return
    const c = JSON.parse(readFileSync(f, 'utf8'))
    expect(cardHasOwnPictures(c['acdef4c3'])).toBe(true)        // Alternate Hunters: asset command + 2,450 images
    expect(cardHasOwnPictures(c['04103f68'])).toBe(true)
    expect(cardHasOwnPictures(c['22a987d8'])).toBe(true)
    expect(cardHasOwnPictures(c['b64432e7'])).toBe(false)
    expect(cardHasOwnPictures(c['88ff3da3'])).toBe(false)
    // portraits kept as Additional Assets are not a library
    expect(cardHasOwnPictures({ additionalAssets: [['Elise Moreau', 'a', 'webp']], extentions: { vjPortraits: { 'elise moreau': { name: 'Elise Moreau' } } } })).toBe(false)
})

describe('the script\'s rules', () => {
    it('a reply with a tag: the tag goes, the description is drawn', () => {
        const p = planScenePicture(REPLY, [user('Có')], 0, T0)!
        expect(p.cleaned).toBe('Cánh cửa sáng trắng biến mất.')
        expect(p.prompt).toMatch(/^A stone granary cellar/)
    })
    it('only the first tag is drawn and every tag is removed', () => {
        const p = planScenePicture(REPLY + '\n[[img: a second picture of the same cellar]]\nThêm.', [], 0, T0)!
        expect(p.cleaned).not.toContain('[[img')
        expect(p.prompt).toMatch(/^A stone granary/)
    })
    it('not drawn: a library image, a too short description, a picture in the two replies before, a cooldown', () => {
        expect(planScenePicture('{{image::cellar.jpg}}\n' + REPLY, [], 0, T0)!.prompt).toBe(null)
        expect(planScenePicture('[[img: cellar]]\nX', [], 0, T0)!.prompt).toBe(null)
        expect(planScenePicture(REPLY, [char('{{inlay::abc}}\nA'), user('b')], 0, T0)!.prompt).toBe(null)
        expect(planScenePicture(REPLY, [char('{{inlay::abc}}\nA'), user('b'), char('B'), user('c'), char('C'), user('d')], 0, T0)!.prompt).not.toBe(null)
        expect(planScenePicture(REPLY, [], T0 + SCENE_COOLDOWN_MS, T0)!.prompt).toBe(null)
        expect(planScenePicture('no tag here', [], 0, T0)).toBe(null)
    })
    it('the ask is only made when a picture is allowed', () => {
        expect(pictureAllowed([char('A'), user('b')], 0, T0)).toBe(true)
        expect(pictureAllowed([char('{{inlay::x}}A'), user('b'), char('B'), user('c')], 0, T0)).toBe(false)
        expect(pictureAllowed([], T0 + 1, T0)).toBe(false)
        expect(SCENE_ASK).toContain('[[img: DESCRIPTION]]')
    })
})
