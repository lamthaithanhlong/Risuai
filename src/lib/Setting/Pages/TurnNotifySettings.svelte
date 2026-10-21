<script lang="ts">
    // Where the server sends a push when an Async turn ends (server/node/turnNotify.cjs, kept in ~/.risu-lan/notify.json on the server).
    // ntfy: install the ntfy app, subscribe to the topic shown here.
    import { getNodeServerProxyAuth } from 'src/ts/storage/nodeStorage'

    let server = $state('https://ntfy.sh')
    let topic = $state('')
    let click = $state('')
    let status = $state('')
    let loaded = $state(false)
    let runsTurns = $state(false)

    async function call(method: string, path: string, body?: unknown) {
        const res = await fetch(path, {
            method,
            headers: { 'risu-auth': await getNodeServerProxyAuth(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        return json
    }

    $effect(() => {
        if (loaded) return
        loaded = true
        call('GET', '/api/turns/notify').then((c) => {
            server = c.server || 'https://ntfy.sh'
            topic = c.topic || ''
            click = c.click || `${location.origin}/`
            runsTurns = !!c.serverRunsTurns
        }).catch((e) => { status = `Không đọc được: ${e.message}` })
    })

    function newTopic() {
        const bytes = crypto.getRandomValues(new Uint8Array(8))
        topic = 'risu-' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    async function save() {
        status = 'Đang lưu…'
        try {
            const c = await call('PUT', '/api/turns/notify', { server, topic, click })
            status = c.enabled ? 'Đã lưu. Server dùng ngay, không cần khởi động lại.' : 'Đã tắt thông báo.'
        } catch (e) {
            status = `Không lưu được: ${(e as Error).message}`
        }
    }

    async function test() {
        status = 'Đang gửi thử…'
        try {
            const r = await call('POST', '/api/turns/notify/test')
            status = r.ok ? 'Đã gửi thử. Xem thông báo trong app ntfy.' : 'ntfy không nhận, kiểm lại server/topic.'
        } catch (e) {
            status = `Không gửi được: ${(e as Error).message}`
        }
    }
</script>

<div class="mt-2 mb-4 flex flex-col gap-2 rounded-md border border-darkborderc p-3 text-textcolor" data-turn-notify-settings>
    <span class="font-semibold">Thông báo khi xong lượt (Async turn)</span>
    <span class="text-sm text-textcolor2">
        Cài app <b>ntfy</b> trên điện thoại, bấm + rồi subscribe đúng topic dưới đây. Mỗi lượt xong hoặc lỗi hẳn, server báo một lần;
        chỉ có tên thẻ và trạng thái, không có chữ trong truyện. Ai biết topic thì đọc được tên thẻ: đừng chia sẻ topic.
    </span>
    {#if !runsTurns && loaded}
        <span class="text-sm text-yellow-500">Server này chưa chạy được lượt (thiếu Playwright hoặc RISU_TURNS=0): chưa có gì để báo.</span>
    {/if}
    <label class="flex flex-col text-sm">Server ntfy
        <input class="rounded-md border border-darkborderc bg-transparent p-2 text-base" bind:value={server} placeholder="https://ntfy.sh" />
    </label>
    <label class="flex flex-col text-sm">Topic
        <div class="flex gap-2">
            <input class="grow rounded-md border border-darkborderc bg-transparent p-2 text-base select-all" bind:value={topic} placeholder="risu-…" />
            <button class="rounded-md border border-darkborderc px-3 hover:bg-selected" onclick={newTopic}>Tạo mới</button>
        </div>
    </label>
    <label class="flex flex-col text-sm">Chạm vào thông báo thì mở
        <input class="rounded-md border border-darkborderc bg-transparent p-2 text-base" bind:value={click} placeholder="https://10.0.0.164:6443/" />
    </label>
    <div class="flex gap-2">
        <button class="rounded-md border border-darkborderc px-3 py-1 hover:bg-selected" onclick={save}>Lưu</button>
        <button class="rounded-md border border-darkborderc px-3 py-1 hover:bg-selected" onclick={test}>Gửi thử</button>
    </div>
    {#if status}<span class="text-sm text-textcolor2">{status}</span>{/if}
</div>
