// The turn worker: runs the turns of turnQueue.cjs in a page of the app that the server owns, so a turn goes on when the player's
// phone does not (another app, the screen locked, Wi-Fi gone). The page is the real client (dist/) in headless Chromium: the same
// helpers, prompt, Lua triggers, tidy and save as on the phone, in a browser that is never frozen. It is opened at
// http://worker.localhost:<port>: a host that is not "localhost" to the app (localNetwork.ts isPageRemoteFromLocalhost), so its
// model requests go through the server's durable stream jobs like the phone's; the job of a turn's key is then reused when a turn
// is run again after its worker died, instead of asking the model twice.
//
// One turn at a time. Before each turn the page is loaded again, so it starts from the save as the server has it now (the player
// may have changed settings or lore since). While a turn runs the worker renews its lease every beatMs; a renewal that fails means
// the turn was cancelled (Stop) or taken back, and the page is told to stop. The browser is closed after idleCloseMs without turns.
//
// The browser context lives in memory only (nothing of it is written to disk). It logs in like a page does (POST /api/login with
// the password and its own key), with the password the server already holds: the request is rewritten by a route inside this
// process, the password never leaves it. The worker's key is dropped from the known keys when its browser closes.

const path = require('path');

function loadChromium() {
    const tries = ['playwright', path.join(__dirname, '../../tests/acceptance/node_modules/playwright')];
    for (const t of tries) {
        try { return require(t).chromium; } catch { /* next */ }
    }
    return null;
}

function createTurnWorker(opts) {
    const queue = opts.queue;
    const owner = opts.owner || `worker-${process.pid}-${Date.now()}`;
    const log = opts.log || ((...a) => console.log('[Turns]', ...a));
    const beatMs = opts.beatMs ?? 10000;
    const idleCloseMs = opts.idleCloseMs ?? 15 * 60 * 1000;
    const runTimeoutMs = opts.runTimeoutMs ?? 25 * 60 * 1000;
    const loadTimeoutMs = opts.loadTimeoutMs ?? 180 * 1000;
    const chromium = opts.chromium === undefined ? loadChromium() : opts.chromium;

    let browser = null;
    let context = null;
    let page = null;
    let publicKey = null;
    let busy = false;
    let lastUsed = 0;
    let timer = null;
    let stopped = false;

    async function closeContext() {
        const c = context;
        context = null; page = null;
        if (c) await c.close().catch(() => {});
        if (publicKey) {
            const k = publicKey;
            publicKey = null;
            try { await opts.dropKey?.(k); } catch { /* the key list is the server's */ }
        }
    }

    async function closeBrowser() {
        await closeContext();
        const b = browser;
        browser = null;
        if (b) await b.close().catch(() => {});
    }

    // Every turn gets a new browser context: nothing of the last turn's page (its IndexedDB block cache, its storage) is left. Measured
    // (tests/turns/repro.mjs double --trace): a page loaded again in the same context had the chat without the reply the turn before
    // had saved (the server held it), and its result, taken by the phone, erased that reply.
    async function ensurePage() {
        await closeContext();
        if (!browser || !browser.isConnected()) browser = await chromium.launch({
            headless: true,
            // timers of a hidden page are not throttled: the worker's page is never "in the background"
            args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
        });
        context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.addInitScript(() => {
            try { localStorage.setItem('tos4', 'true'); localStorage.setItem('dosync', 'avoid') } catch { /* private */ }
        });
        await context.route('**/api/login', async (route) => {
            let body = {};
            try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* not JSON */ }
            body.password = opts.getPassword();
            publicKey = body.publicKey ?? null;
            await route.continue({ postData: JSON.stringify(body) });
        });
        // the page tells the queue where the turn is (assembling -> tidying); the stream job hook in server.cjs says "generating"
        await context.exposeBinding('__risuTurnPhase', (_src, key, phase) => {
            try { return queue.phase(key, owner, phase); } catch { return false; }
        });
        // the page asks, before it reports a reply, whether the turn's stream job ended well: a model that died mid-stream leaves
        // words in the chat that read like a reply (measured: tests/turns/repro.mjs reset)
        await context.exposeBinding('__risuTurnJobOk', async (_src, key) => {
            try { return opts.jobOk ? await opts.jobOk(key) : true; } catch { return true; }
        });
        await context.exposeBinding('__risuTurnInSave', (_src, chaId, chatId, ids) => {
            try { return opts.inSave ? opts.inSave(chaId, chatId, ids) : true; } catch { return false; }
        });
        page = await context.newPage();
        page.on('pageerror', (e) => log('page error:', String(e?.message || e).slice(0, 200)));
        // a save the page cannot read makes it load a backup: say so (it is how a turn can start from an old chat)
        page.on('console', (m) => {
            const t = m.text();
            if (m.type() === 'error' || /Backup/i.test(t)) log('page console:', m.type(), t.slice(0, 300));
        });
        page.on('crash', () => { log('the worker page crashed'); page = null; });
        return page;
    }

    async function loadApp(p) {
        await p.goto(`${opts.baseUrl}/?turnWorker=1`, { waitUntil: 'domcontentloaded', timeout: loadTimeoutMs });
        const ready = p.waitForFunction(() => globalThis.__risuTurnWorker?.ready === true, null, { timeout: loadTimeoutMs, polling: 250 }).then(() => 'ready');
        const prompt = p.waitForSelector('text=Input your password', { timeout: loadTimeoutMs }).then(() => 'login');
        ready.catch(() => {}); prompt.catch(() => {});
        const first = await Promise.race([ready, prompt]);
        if (first === 'login') {
            log('logging the worker page in');
            await p.locator('#alert-input, input').first().fill('worker');
            await p.getByRole('button', { name: 'OK' }).click();
            await p.waitForFunction(() => globalThis.__risuTurnWorker?.ready === true, null, { timeout: loadTimeoutMs, polling: 250 });
        }
    }

    // A run that did not save undoes its reply (turnWorkerPage.ts undo): the pictures it asked for belong to a message that is gone. The server
    // is told, so it does not draw them (opts.undone cancels the ones not drawn yet and not in a saved message).
    function undone(turn, startedAt) {
        try { opts.undone?.(turn.chat, startedAt); } catch (error) { log('undone:', String(error?.message || error).slice(0, 200)); }
    }

    async function run(turn) {
        const t0 = Date.now();
        let lost = false;
        let p = null;
        const beat = setInterval(() => {
            if (!queue.renew(turn.key, owner)) {
                if (!lost) log(`turn ${turn.key} was cancelled or taken back: stopping it`);
                lost = true;
                p?.evaluate(() => globalThis.__risuTurnWorker?.abort()).catch(() => {});
            }
        }, beatMs);
        beat.unref?.();
        try {
            p = await ensurePage();
            await loadApp(p);
            if (lost) return;
            const spec = { key: turn.key, chaId: turn.cha, chatId: turn.chat, kind: turn.kind, input: turn.input, attempt: turn.attempt };
            let timeout;
            const res = await Promise.race([
                p.evaluate((s) => globalThis.__risuTurnWorker.run(s), spec),
                new Promise((resolve) => { timeout = setTimeout(() => resolve({ ok: false, error: `the turn ran over ${runTimeoutMs / 60000} min`, retryable: true, hung: true }), runTimeoutMs); }),
            ]);
            clearTimeout(timeout);
            if (res?.hung) await closeBrowser();
            if (res?.loaded) log(`turn ${turn.key}: the page loaded the chat at index ${res.loaded.found} with ${JSON.stringify(res.loaded.ids)}`);
            if (lost) return;
            const outcome = res?.ok
                ? { ok: true, result: res.chat }
                : { ok: false, error: res?.error || 'the turn did not finish', retryable: res?.retryable !== false };
            const state = queue.finish(turn.key, owner, outcome);
            log(`turn ${turn.key} (${turn.kind}, attempt ${turn.attempt}) -> ${state} in ${Math.round((Date.now() - t0) / 1000)} s${outcome.ok ? '' : ': ' + String(outcome.error).slice(0, 200)}`);
            if (!outcome.ok) undone(turn, t0);
        } catch (error) {
            const msg = String(error?.message || error).slice(0, 300);
            log(`turn ${turn.key} broke the worker page: ${msg}`);
            await closeBrowser();
            if (!lost) { queue.finish(turn.key, owner, { ok: false, error: msg, retryable: true }); undone(turn, t0); }
        } finally {
            clearInterval(beat);
            if (lost) undone(turn, t0);          // Stop, or the lease was taken back: this run's reply goes too
            await closeContext();
            lastUsed = Date.now();
        }
    }

    async function tick() {
        if (busy || stopped) return;
        busy = true;
        try {
            queue.expire();
            const turn = queue.lease(owner);
            if (turn) {
                log(`turn ${turn.key} (${turn.kind}) leased, attempt ${turn.attempt}`);
                await run(turn);
            } else if (browser && Date.now() - lastUsed > idleCloseMs) {
                log('no turns for a while: closing the worker browser');
                await closeBrowser();
            }
        } catch (error) {
            log('tick failed:', String(error?.message || error).slice(0, 300));
        } finally {
            busy = false;
        }
    }

    return {
        owner,
        available: !!chromium,
        start() {
            if (!chromium) { log('Playwright is not installed: turns stay on the page (cd tests/acceptance && npm install)'); return false; }
            timer = setInterval(tick, opts.pollMs ?? 1000);
            timer.unref?.();
            return true;
        },
        /** a turn was queued: look now rather than at the next poll */
        poke() { setImmediate(tick); },
        async stop() {
            stopped = true;
            if (timer) clearInterval(timer);
            await closeBrowser();
        },
    };
}

module.exports = { createTurnWorker, loadChromium };
