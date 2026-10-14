import { beforeEach, describe, expect, test } from 'vitest'
import { cotPanel, closeCoT, toggleCoT } from './cotPanel.svelte'

describe('thought panel show / hide', () => {
    beforeEach(() => closeCoT())

    test('the button shows the panel, pressing it again hides it', () => {
        toggleCoT(3)
        expect(cotPanel).toMatchObject({ open: true, chatID: 3, collapsed: false })
        toggleCoT(3)
        expect(cotPanel.open).toBe(false)
    })

    test('the button of another message switches the panel to that message instead of hiding it', () => {
        toggleCoT(3)
        toggleCoT(5)
        expect(cotPanel).toMatchObject({ open: true, chatID: 5 })
    })

    test('a collapsed panel is shown again by its button, not closed', () => {
        toggleCoT(3)
        cotPanel.collapsed = true
        toggleCoT(3)
        expect(cotPanel).toMatchObject({ open: true, collapsed: false })
    })

    test('closing clears the thought and the collapsed state', () => {
        toggleCoT(3)
        cotPanel.text = 'x'
        cotPanel.collapsed = true
        closeCoT()
        expect(cotPanel).toMatchObject({ open: false, text: '', collapsed: false })
    })
})
