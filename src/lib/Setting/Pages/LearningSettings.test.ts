// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { learningMode: true, learningLang: 'th', learningReadings: true } } }))

import { mount, tick } from 'svelte'
import LearningSettings from './LearningSettings.svelte'

it('offers Thai as a language to learn, and shows its sample with the reading', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mount(LearningSettings, { target, props: {} })
    await tick()
    const options = [...target.querySelectorAll('option')].map((o) => `${o.getAttribute('value')}=${o.textContent?.trim()}`)
    expect(options).toContain('th=ภาษาไทย — tiếng Thái')
    const sample = target.querySelector('div.p-3.rounded-md')?.textContent ?? ''
    expect(sample).toContain('xạ-oặt')                         // สวัสดี read underneath
    expect(sample).toContain('Xin chào, cái này bao nhiêu?')
})
