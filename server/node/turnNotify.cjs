// A push notification to the owner's phone when an Async turn ends (owner, 2026-10-20: "Mỗi lần xong bắn Notification trên mobile").
// Through ntfy (https://ntfy.sh, an app on the iPhone subscribed to one topic): RISU_NOTIFY_URL=https://ntfy.sh/<topic>. Unset: nothing
// is sent. Only the card's name and the outcome leave the machine, never the story's text; tapping the notification opens
// RISU_NOTIFY_CLICK (the phone's address of the app).

/** RISU_NOTIFY_URL / RISU_NOTIFY_CLICK, else ~/.risu-lan/notify.json {"url": "...", "click": "..."} (kept across restarts by any session) */
function notifyConfig(file = require('path').join(require('os').homedir(), '.risu-lan', 'notify.json')) {
    let saved = {};
    try { saved = JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch { /* none */ }
    return { url: process.env.RISU_NOTIFY_URL || saved.url || '', click: process.env.RISU_NOTIFY_CLICK || saved.click || '' };
}

/** Saves the settings page's choice: {server, topic, click} -> notify.json {url, click}. Throws a TypeError for a bad value. */
function saveNotifyConfig({ server, topic, click }, file = require('path').join(require('os').homedir(), '.risu-lan', 'notify.json')) {
    const s = String(server ?? '').trim().replace(/\/+$/, '')
    const t = String(topic ?? '').trim()
    const c = String(click ?? '').trim()
    if (t === '' && s === '') {
        require('fs').writeFileSync(file, JSON.stringify({ url: '', click: c }) + '\n', { mode: 0o600 })
        return { url: '', click: c }
    }
    if (!/^https?:\/\/[^\s/]+$/.test(s)) throw new TypeError('server must be like https://ntfy.sh')
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(t)) throw new TypeError('topic: 6-64 letters, digits, - or _')
    if (c && !/^https?:\/\/\S+$/.test(c)) throw new TypeError('the link must start with http(s)://')
    const conf = { url: `${s}/${t}`, click: c }
    require('fs').writeFileSync(file, JSON.stringify(conf) + '\n', { mode: 0o600 })
    return conf
}

/** {server, topic, click} for the settings page */
function splitNotifyConfig(conf) {
    if (!conf.url) return { server: 'https://ntfy.sh', topic: '', click: conf.click || '', enabled: false }
    const u = new URL(conf.url)
    return { server: u.origin, topic: u.pathname.replace(/^\/+|\/+$/g, ''), click: conf.click || '', enabled: true }
}

function createTurnNotifier(opts = {}) {
    // read on every push: the settings page changes it without a restart
    const conf = () => (opts.url !== undefined ? { url: opts.url, click: opts.click ?? '' } : notifyConfig(opts.file));
    const fetchFn = opts.fetch ?? globalThis.fetch;
    const log = opts.log ?? ((...a) => console.log('[Notify]', ...a));
    const nameOf = opts.nameOf ?? (() => '');
    const sent = new Set();

    function message(turn, state) {
        const name = String(nameOf(turn.cha) || 'Risu').slice(0, 60);
        if (state === 'saved') return { title: `${name}: xong lượt`, body: turn.kind === 'reroll' ? 'Câu trả lời mới đã sẵn sàng.' : 'Câu trả lời đã sẵn sàng.', tags: 'white_check_mark', priority: '3' };
        return { title: `${name}: lượt không xong`, body: 'Server đã thử lại mà không được. Mở app để gửi lại.', tags: 'warning', priority: '4' };
    }

    return {
        get enabled() { return !!conf().url; },
        /** state event of a turn: notify once for saved / failed (a retry is not an end) */
        async onState(turn, state) {
            const { url, click } = conf();
            if (!url || !turn || !['saved', 'failed'].includes(state)) return false;
            const id = `${turn.key}:${state}`;
            if (sent.has(id)) return false;
            sent.add(id);
            if (sent.size > 500) sent.delete(sent.values().next().value);
            const m = message(turn, state);
            try {
                // ntfy's JSON publish (POST to the server's root, the topic in the body): a Vietnamese title cannot go in an HTTP header
                const u = new URL(url);
                const topic = u.pathname.replace(/^\/+|\/+$/g, '');
                const body = { topic, title: m.title, message: m.body, tags: [m.tags], priority: Number(m.priority), ...(click ? { click } : {}) };
                const res = await fetchFn(`${u.origin}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
                if (!res.ok) log(`push for ${turn.key} answered ${res.status}`);
                return res.ok;
            } catch (error) {
                log(`push for ${turn.key} failed: ${String(error?.message || error).slice(0, 200)}`);
                return false;
            }
        },
    };
}

module.exports = { createTurnNotifier, notifyConfig, saveNotifyConfig, splitNotifyConfig };
