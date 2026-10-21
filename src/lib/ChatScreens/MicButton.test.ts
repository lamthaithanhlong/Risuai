// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('src/ts/storage/nodeStorage', () => ({ getNodeServerProxyAuth: async () => 'token' }))

import { mount, tick, unmount } from 'svelte'
import MicButton from './MicButton.svelte'
import { MIC_HINT } from 'src/ts/process/dictation'

const wait = () => new Promise((r) => setTimeout(r, 0))
class FakeRecorder {
    state = 'inactive'; ondataavailable: any = null; onstop: any = null; onerror: any = null
    constructor(public s: any, public mimeType: string) {}
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['a']) }); this.onstop?.() }
}
let mounted: any[] = []
afterEach(() => { mounted.forEach((m) => unmount(m)); mounted = []; document.body.innerHTML = '' })

function setup(reply: () => Promise<Response> = async () => new Response(JSON.stringify({ text: 'xin chào' }))) {
    const target = document.createElement('div'); document.body.appendChild(target)
    const texts: string[] = []
    const timers: (() => void)[] = []
    mounted.push(mount(MicButton, { target, props: {
        onText: (t: string) => texts.push(t),
        deps: {
            getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
            createRecorder: (s: any, m: string) => new FakeRecorder(s, m),
            isTypeSupported: () => true,
            fetch: async (u: string) => u.endsWith('/warm') ? new Response('{}') : reply(),
            auth: async () => 'token',
            setInterval: (fn: () => void) => { timers.push(fn); return 1 },
            clearInterval: () => {},
        } as any,
    } }))
    const btn = () => target.querySelector('button.stt-mic') as HTMLButtonElement
    return { target, btn, texts, second: () => timers.forEach((f) => f()) }
}

it('shows the mic at rest, with the hint that the iPhone keyboard dictation works too', async () => {
    const { btn } = setup(); await tick()
    expect(btn().getAttribute('aria-label')).toBe('Nói để nhập chữ')
    expect(btn().getAttribute('title')).toBe(MIC_HINT)
    expect(MIC_HINT).toContain('Bàn phím iPhone')
    expect(btn().classList.contains('stt-recording')).toBe(false)
    expect(btn().disabled).toBe(false)
})

it('turns into a stop button with a running clock while recording, then a disabled spinner, then back', async () => {
    let release: (r: Response) => void = () => {}
    const { btn, target, texts, second } = setup(() => new Promise<Response>((r) => { release = r }))
    btn().click(); await wait(); await tick()
    expect(btn().classList.contains('stt-recording')).toBe(true)
    expect(btn().getAttribute('aria-label')).toBe('Dừng ghi âm')
    expect(btn().getAttribute('aria-pressed')).toBe('true')
    second(); second(); second(); await tick()
    expect(target.querySelector('.stt-clock')?.textContent).toBe('0:03')
    btn().click(); await wait(); await tick()
    expect(btn().classList.contains('stt-transcribing')).toBe(true)
    expect(btn().disabled).toBe(true)
    release(new Response(JSON.stringify({ text: 'xin chào' }))); await wait(); await wait(); await tick()
    expect(texts).toEqual(['xin chào'])
    expect(btn().classList.contains('stt-recording')).toBe(false)
    expect(btn().disabled).toBe(false)
    expect(target.querySelector('.stt-error')).toBeNull()
})

it('shows the message when the server cannot transcribe and there is no other recogniser', async () => {
    const { btn, target } = setup(async () => new Response(JSON.stringify({ error: { code: 'unavailable' } }), { status: 503 }))
    btn().click(); await wait(); await tick()
    btn().click(); await wait(); await wait(); await tick()
    expect(target.querySelector('.stt-error')?.textContent).toContain('Máy chủ chưa chép giọng được')
})
