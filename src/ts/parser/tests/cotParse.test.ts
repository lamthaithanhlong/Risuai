import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import { ParseMarkdown, trimMarkdown } from '../parser.svelte'

//#region module mocks

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => ({}),
    } as typeof import('../../storage/database.svelte'))
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    DBState: {
      db: {
        characters: [
          {
            chatPage: 0,
            chats: [{}],
            defaultVariables: '',
          },
        ],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

//#endregion

// On desktop (Tauri) getFileSrc resolves local assets to an asset: URL via
// convertFileSrc (globalApi.svelte.ts getFileSrc). DOMPurify must not strip
// the src of such images while keeping the path in alt, which renders every
// {{img::}}/{{image::}}/{{asset::}}/{{emotion::}} asset as broken text.
const assetUrl =
  'asset://localhost/Users/test/Library/Application%20Support/co.aiclient.risu/assets/pic.png'


const OPEN = '<Thoughts>'
const CLOSE = '</Thoughts>'

describe('ParseMarkdown and the chain-of-thought panel', () => {
  it('the thought text is not in the HTML, only the reply is', async () => {
    const html = await ParseMarkdown(`${OPEN}\nbí mật nghĩ thầm\n${CLOSE}\n*Khang cười* Ngồi đi.`, null, 'normal', 0)
    expect(html).toContain('Khang cười')
    expect(html).not.toContain('bí mật nghĩ thầm')
    expect(html).not.toContain('<details')
  })

  it('a thought still being written shows nothing of it', async () => {
    const html = await ParseMarkdown(`Trước. ${OPEN}đang nghĩ dở`, null, 'normal', 0)
    expect(html).toContain('Trước.')
    expect(html).not.toContain('đang nghĩ dở')
  })

  it('half an opening tag at the end of the stream is not shown', async () => {
    const html = await ParseMarkdown('Tôi bước tới. <Thoug', null, 'normal', 0)
    expect(html).toContain('Tôi bước tới.')
    expect(html).not.toContain('Thoug')
  })

  it('a reply without a thought is unchanged', async () => {
    const html = await ParseMarkdown('Chào em.', null, 'normal', 0)
    expect(html).toContain('Chào em.')
  })

  it('translation and cache modes never carry the thought', async () => {
    for (const mode of ['pretranslate', 'notrim', 'back'] as const) {
      const html = await ParseMarkdown(`${OPEN}bí mật${CLOSE}Trả lời.`, null, mode, 0)
      expect(html).toContain('Trả lời')
      expect(html).not.toContain('bí mật')
    }
  })

  it('a long thought does not make the display slower', async () => {
    const reply = 'Tôi bước lên phía trước. '.repeat(50)
    const thought = 'Tiếp tục vai trò Shadow Slave, kiểm tra quy tắc. '.repeat(220)
    const time = async (s: string) => { const t = performance.now(); for (let i = 0; i < 30; i++) await ParseMarkdown(s, null, 'normal', 0); return performance.now() - t }
    const long = `${OPEN}${thought}${CLOSE}${reply}`
    await time(reply); await time(long)
    // the fastest of interleaved rounds: a busy machine (the full suite runs files in parallel) only ever makes a round slower,
    // and one slow round of b failed this test 2 times in 20 full runs (2026-10-15)
    let a = Infinity, b = Infinity
    for (let r = 0; r < 5; r++) {
      a = Math.min(a, await time(reply))
      b = Math.min(b, await time(long))
    }
    expect(b).toBeLessThan(a * 3 + 20)
  })
})
