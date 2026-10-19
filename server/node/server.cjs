const express = require('express');
const app = express();
// RISU_ACCESS_LOG=1: one line per request (method, path, status, ms, user agent). For finding where a phone stops loading.
if (process.env.RISU_ACCESS_LOG) {
    app.use((req, res, next) => {
        const t0 = Date.now();
        res.on('finish', () => console.log(`[Access] ${new Date().toISOString()} ${req.method} ${req.originalUrl.slice(0, 90)} ${res.statusCode} ${Date.now() - t0}ms ${(req.headers['user-agent'] || '').includes('iPhone') ? 'iPhone' : 'other'}`));
        res.on('close', () => { if (!res.writableFinished) console.log(`[Access] ${new Date().toISOString()} ${req.method} ${req.originalUrl.slice(0, 90)} ABORTED ${Date.now() - t0}ms`); });
        next();
    });
}
if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}
const http = require('http');
const path = require('path');
const net = require('net');
const htmlparser = require('node-html-parser');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { atomicWriteFile } = require('./atomicWrite.cjs');
const { applyReasoningDefault } = require('./requestDefaults.cjs');
const reasoningDefaultLogged = new Set();
const fs = require('fs/promises')
const crypto = require('crypto')
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
// Phones on the LAN need HTTPS (crypto.subtle); active only when ~/.risu-lan/cert.pem exists, see lan-tls.cjs.
const { lanRedirectTarget } = require('./lanRedirect.cjs');
const lanTlsPort = existsSync(path.join(require('os').homedir(), '.risu-lan', 'cert.pem')) ? (Number(process.env.LAN_TLS_PORT) || 6443) : 0;
app.use((req, res, next) => {
    const target = lanTlsPort && lanRedirectTarget(req.headers.host, req.socket.remoteAddress, req.originalUrl, lanTlsPort);
    if (target) {
        res.redirect(307, target);
        return;
    }
    next();
});
app.use(express.static(path.join(process.cwd(), 'dist'), {index: false}));
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
app.use(express.text({ limit: '100mb' }));
const {pipeline} = require('stream/promises')
const https = require('https');
const sslPath = path.join(process.cwd(), 'server/node/ssl/certificate');
const hubURL = 'https://sv.risuai.xyz'; 
const openid = require('openid-client');

let password = ''
let knownPublicKeysHashes = []

const savePath = path.join(process.cwd(), "save")
if(!existsSync(savePath)){
    mkdirSync(savePath)
}

// Writes go through a durable SQLite queue (saveQueue.cjs, specs/core/SaveQueue.tla): acknowledged once committed, applied to the save
// directory in order by one worker, newest write per key only. Reads and listings look at the queue first.
const hexToKey = (hex) => Buffer.from(hex, 'hex').toString('utf-8');
const saveQueue = require('./saveQueue.cjs').openSaveQueue({
    dbFile: savePath + '.queue.sqlite',
    saveDir: savePath,
    // assets/ are content-addressed and inlays/ (chat pictures, one uuid each) never change once written
    isImmutable: (hex) => { const key = hexToKey(hex); return key.startsWith('assets/') || key.startsWith('inlays/'); },
    log: (kind, key, attempts, error) => console.error(`[SaveQueue] ${kind} ${hexToKey(key)} attempt ${attempts}: ${error && error.message || error}`),
});
require('./atomicWrite.cjs').cleanStaleTemp(savePath + '.tmp', 60 * 60 * 1000).catch(() => {});
saveQueue.start();
// Which version of database.bin each page loaded, so that a page's write is merged against it instead of replacing the whole file
// (dbMerge.cjs, specs/mergesave). RISU_DB_MERGE=0 turns it off: every write replaces the file, as before.
const DB_KEY_HEX = Buffer.from('database/database.bin', 'utf-8').toString('hex');
let dbSync = null;
if (process.env.RISU_DB_MERGE !== '0') {
    try {
        dbSync = require('./dbSync.cjs').openDbSync({
            dbFile: process.env.RISU_SYNC_DB || savePath + '.sync.sqlite',
            log: (m) => console.log(`[Sync] ${m}`),
        });
    } catch (error) {
        console.error('[Sync] disabled:', error.message);
    }
}
// A page is its browser's signing key AND its tab: the key lives in IndexedDB, so every tab of one browser shares it, and two tabs
// counted as one page never saw each other's writes as foreign, so the last one to save replaced the other's work whole
// (specs/chat/DbSync.tla, SameBrowser). The tab id comes from the page's sessionStorage (nodeStorage.ts tabId).
const tabIdOf = (req) => { const t = req.headers['x-risu-tab']; return typeof t === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(t) ? t : ''; };
const clientIdOf = (req) => {
    const base = req.risuClient || (req.headers['x-risu-client'] ? String(req.headers['x-risu-client']) : require('crypto').createHash('sha1').update(`${req.ip}|${req.headers['user-agent'] || ''}`).digest('hex'));
    const tab = tabIdOf(req);
    return tab ? `${base}:${tab}` : base;
};
const currentSaveBytes = (hexKey) => {
    const queued = saveQueue.readPending(hexKey);
    if (queued) return queued.op === 'delete' ? null : Buffer.from(queued.data);
    const f = path.join(savePath, hexKey);
    return existsSync(f) ? readFileSync(f) : null;
};
let lastPremergeAt = 0;
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try { await Promise.race([saveQueue.flush(), new Promise((r) => setTimeout(r, 8000))]); await saveQueue.close(); } catch (e) { console.error('[SaveQueue] shutdown:', e); }
        process.exit(0);
    });
}

const passwordPath = path.join(process.cwd(), 'save', '__password')
if(existsSync(passwordPath)){
    password = readFileSync(passwordPath, 'utf-8')
}

const knownPublicKeysPath = path.join(process.cwd(), 'save', '__known_public_key_hashes.json')
if(existsSync(knownPublicKeysPath)){
    const knownPublicKeysRaw = readFileSync(knownPublicKeysPath, 'utf-8');
    knownPublicKeysHashes = JSON.parse(knownPublicKeysRaw);
}

const authCodePath = path.join(process.cwd(), 'save', '__authcode')
const hexRegex = /^[0-9a-fA-F]+$/;
const PROXY_STREAM_DEFAULT_TIMEOUT_MS = 600000;
const PROXY_STREAM_MAX_TIMEOUT_MS = 3600000;
const PROXY_STREAM_DEFAULT_HEARTBEAT_SEC = 15;
const PROXY_STREAM_HEARTBEAT_MIN_SEC = 5;
const PROXY_STREAM_HEARTBEAT_MAX_SEC = 60;
const PROXY_STREAM_GC_INTERVAL_MS = 60000;
const PROXY_STREAM_DONE_GRACE_MS = 30000;
const PROXY_STREAM_MAX_ACTIVE_JOBS = 64;
const PROXY_STREAM_MAX_PENDING_EVENTS = 512;
const PROXY_STREAM_MAX_PENDING_BYTES = 2 * 1024 * 1024;
const PROXY_STREAM_MAX_BODY_BASE64_BYTES = 8 * 1024 * 1024;
const proxyStreamJobs = new Map();

// Durable log of every stream job's events (see jobStore.cjs): lets a phone that dropped or refreshed pick up the
// reply from where it stopped. If SQLite cannot be opened the jobs still run, just without that.
const { JOB_REUSE_MAX_AGE_MS: PROXY_JOB_REUSE_MAX_AGE_MS, JOB_KEEP_MS: PROXY_JOB_KEEP_MS } = require('./jobStore.cjs');
let jobStore = null;
try {
    const jobsDbPath = process.env.RISU_JOBS_DB || path.join(require('os').homedir(), '.risu-lan', 'jobs.sqlite');
    mkdirSync(path.dirname(jobsDbPath), { recursive: true });
    jobStore = require('./jobStore.cjs').openJobStore(jobsDbPath);
    const interrupted = jobStore.interruptRunning();
    const pruned = jobStore.prune(Date.now() - PROXY_JOB_KEEP_MS);
    console.log(`[Server] Job store ready (${jobsDbPath}); interrupted ${interrupted}, pruned ${pruned}`);
    setInterval(() => { try { jobStore.prune(Date.now() - PROXY_JOB_KEEP_MS); } catch { /* ignore */ } }, 60 * 60 * 1000).unref();
} catch (error) {
    console.error('[Server] Job store unavailable, stream jobs will not survive a dropped connection:', error?.message || error);
    jobStore = null;
}
const jobWaiters = new Map();
function notifyJob(jobId) {
    const waiters = jobWaiters.get(jobId);
    if (!waiters) {
        return;
    }
    jobWaiters.delete(jobId);
    for (const wake of waiters) {
        wake();
    }
}
function waitForJob(jobId, timeoutMs) {
    return new Promise((resolve) => {
        let timer = null;
        const wake = () => {
            clearTimeout(timer);
            resolve();
        };
        timer = setTimeout(() => {
            jobWaiters.get(jobId)?.delete(wake);
            resolve();
        }, timeoutMs);
        if (!jobWaiters.has(jobId)) {
            jobWaiters.set(jobId, new Set());
        }
        jobWaiters.get(jobId).add(wake);
    });
}
// Requests per minute per client address. A private server behind the HTTPS front sees every device as 127.0.0.1,
// so one phone importing a card with hundreds of assets can use up everyone's share: raise it with RISU_RATE_LIMIT.
const RATE_LIMIT_PER_MIN = Number.parseInt(process.env.RISU_RATE_LIMIT || '', 10) > 0 ? Number.parseInt(process.env.RISU_RATE_LIMIT, 10) : 2000;
const authenticatedRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: RATE_LIMIT_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please retry shortly.' }
});
const authRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: RATE_LIMIT_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please retry shortly.' }
});
const loginRouteLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again later.' }
});
function isHex(str) {
    return hexRegex.test(str.toUpperCase().trim()) || str === '__password';
}

async function hashJSON(json){
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(json));
    return hash.digest('hex');
}

function isAuthorizedRequest(req) {
    const authHeader = normalizeAuthHeader(req.headers['risu-auth']);
    return !!authHeader && authHeader.trim() === password.trim();
}

function normalizeAuthHeader(authHeader) {
    if (Array.isArray(authHeader)) {
        return authHeader[0] || '';
    }
    return typeof authHeader === 'string' ? authHeader : '';
}

async function isAuthorizedJwtHeader(authHeader) {
    try {
        const normalized = normalizeAuthHeader(authHeader);
        if (!normalized) {
            return false;
        }

        const [
            jsonHeaderB64,
            jsonPayloadB64,
            signatureB64,
        ] = normalized.split('.');

        if (!jsonHeaderB64 || !jsonPayloadB64 || !signatureB64) {
            return false;
        }

        const jsonHeader = JSON.parse(Buffer.from(jsonHeaderB64, 'base64url').toString('utf-8'));
        const jsonPayload = JSON.parse(Buffer.from(jsonPayloadB64, 'base64url').toString('utf-8'));
        const signature = Buffer.from(signatureB64, 'base64url');

        const now = Math.floor(Date.now() / 1000);
        if (jsonPayload.exp < now) {
            return false;
        }

        const pubKeyHash = await hashJSON(jsonPayload.pub);
        if (!knownPublicKeysHashes.includes(pubKeyHash)) {
            return false;
        }

        if (jsonHeader.alg !== 'ES256') {
            return false;
        }

        return await crypto.subtle.verify(
            {
                name: 'ECDSA',
                hash: { name: 'SHA-256' },
            },
            await crypto.subtle.importKey(
                'jwk',
                jsonPayload.pub,
                {
                    name: 'ECDSA',
                    namedCurve: 'P-256',
                },
                false,
                ['verify']
            ),
            signature,
            Buffer.from(`${jsonHeaderB64}.${jsonPayloadB64}`)
        );
    } catch {
        return false;
    }
}

async function isAuthorizedProxyRequest(req) {
    if (isAuthorizedRequest(req)) {
        return true;
    }
    return await isAuthorizedJwtHeader(req.headers['risu-auth']);
}

async function checkProxyAuth(req, res) {
    if (isAuthorizedRequest(req)) {
        return true;
    }
    return await checkAuth(req, res);
}

function getRequestTimeoutMs(timeoutHeader) {
    const raw = Array.isArray(timeoutHeader) ? timeoutHeader[0] : timeoutHeader;
    if (!raw) {
        return null;
    }
    const timeoutMs = Number.parseInt(raw, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return null;
    }
    return timeoutMs;
}

function createTimeoutController(timeoutMs) {
    if (!timeoutMs) {
        return {
            signal: undefined,
            cleanup: () => {}
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timer)
    };
}

function normalizeProxyStreamTimeoutMs(timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return PROXY_STREAM_DEFAULT_TIMEOUT_MS;
    }
    const parsed = Math.max(1, Math.floor(timeoutMs));
    return Math.min(PROXY_STREAM_MAX_TIMEOUT_MS, parsed);
}

function normalizeHeartbeatSec(heartbeatSec) {
    if (!Number.isFinite(heartbeatSec)) {
        return PROXY_STREAM_DEFAULT_HEARTBEAT_SEC;
    }
    const parsed = Math.floor(heartbeatSec);
    return Math.min(PROXY_STREAM_HEARTBEAT_MAX_SEC, Math.max(PROXY_STREAM_HEARTBEAT_MIN_SEC, parsed));
}

function isPrivateIPv4Host(hostname) {
    const parts = hostname.split('.');
    if (parts.length !== 4) {
        return false;
    }
    const octets = parts.map((part) => Number.parseInt(part, 10));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return false;
    }
    const [a, b] = octets;
    if (a === 10) {
        return true;
    }
    if (a === 127) {
        return true;
    }
    if (a === 0) {
        return true;
    }
    if (a === 192 && b === 168) {
        return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return true;
    }
    if (a === 169 && b === 254) {
        return true;
    }
    return false;
}

function isLocalNetworkHost(hostname) {
    if (typeof hostname !== 'string' || hostname.trim() === '') {
        return false;
    }

    const normalizedHost = hostname.toLowerCase().replace(/\.$/, '').split('%')[0];
    if (normalizedHost === 'localhost' || normalizedHost === '::1' || normalizedHost.endsWith('.local')) {
        return true;
    }

    if (net.isIP(normalizedHost) === 4) {
        return isPrivateIPv4Host(normalizedHost);
    }

    if (net.isIP(normalizedHost) === 6) {
        if (normalizedHost.startsWith('::ffff:')) {
            const mapped = normalizedHost.substring(7);
            return net.isIP(mapped) === 4 && isPrivateIPv4Host(mapped);
        }
        if (normalizedHost.startsWith('fc') || normalizedHost.startsWith('fd')) {
            return true;
        }
        if (/^fe[89ab]/.test(normalizedHost)) {
            return true;
        }
        return normalizedHost === '::1';
    }

    return false;
}

function sanitizeTargetUrl(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
    }
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        if (!isLocalNetworkHost(parsed.hostname)) {
            return null;
        }
        parsed.username = '';
        parsed.password = '';
        return parsed.toString();
    } catch {
        return null;
    } // lgtm[js/request-forgery]
}

function normalizeForwardHeaders(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {};
    }
    const normalized = {};
    for (const [key, value] of Object.entries(input)) {
        if (typeof key !== 'string') {
            continue;
        }
        if (typeof value === 'string') {
            normalized[key] = value;
        }
    }
    delete normalized['risu-auth'];
    delete normalized['risu-timeout-ms'];
    delete normalized['host'];
    delete normalized['connection'];
    delete normalized['content-length'];
    return normalized;
}

function normalizeProxyResponseHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (value === undefined) {
            continue;
        }
        normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return normalized;
}

function requestLocalTargetStream(targetUrl, arg) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(targetUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const headers = normalizeForwardHeaders(arg.headers);
        if (!headers['host']) {
            headers['host'] = parsedUrl.host;
        }
        if (arg.bodyBuffer && !headers['content-length']) {
            headers['content-length'] = String(arg.bodyBuffer.length);
        }

        let settled = false;
        let cleanupAbort = () => {};
        const finishReject = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanupAbort();
            reject(error);
        };

        const req = client.request(parsedUrl, {
            method: arg.method,
            headers
        }, (res) => {
            if (settled) {
                res.destroy();
                return;
            }
            settled = true;
            cleanupAbort();
            resolve({
                status: res.statusCode || 502,
                headers: normalizeProxyResponseHeaders(res.headers),
                body: res
            });
        });

        req.on('error', (error) => {
            finishReject(error);
        });

        req.setTimeout(arg.timeoutMs, () => {
            req.destroy(new Error(`Upstream request timed out after ${arg.timeoutMs}ms`));
        });

        if (arg.signal) {
            const onAbort = () => {
                const abortError = new Error('Proxy stream job aborted');
                abortError.name = 'AbortError';
                req.destroy(abortError);
            };
            if (arg.signal.aborted) {
                onAbort();
                return;
            }
            arg.signal.addEventListener('abort', onAbort, { once: true });
            cleanupAbort = () => arg.signal.removeEventListener('abort', onAbort);
        }

        if (arg.bodyBuffer && arg.method !== 'GET' && arg.method !== 'HEAD') {
            req.write(arg.bodyBuffer);
        }
        req.end();
    });
}

function createProxyStreamJob(arg) {
    const jobId = crypto.randomUUID();
    const timeoutMs = normalizeProxyStreamTimeoutMs(Number(arg.timeoutMs));
    const heartbeatSec = normalizeHeartbeatSec(arg.heartbeatSec);
    const controller = new AbortController();
    const createdAt = Date.now();
    const job = {
        id: jobId,
        createdAt,
        updatedAt: createdAt,
        done: false,
        cleanupAt: 0,
        clients: new Set(),
        pendingEvents: [],
        pendingBytes: 0,
        abortController: controller,
        deadlineAt: createdAt + timeoutMs,
        heartbeatSec,
        timeoutMs // lgtm[js/request-forgery]
    };
    proxyStreamJobs.set(jobId, job);
    try {
        jobStore?.createJob(jobId, arg.idempotencyKey);
    } catch (error) {
        console.error('[Server] Job store createJob failed:', error?.message || error);
    }
    return job;
}

function pushJobEvent(job, event) {
    job.updatedAt = Date.now();
    if (event.type === 'error') {
        job.failed = true;
    }
    if (jobStore) {
        try {
            jobStore.append(job.id, event);
        } catch (error) {
            console.error('[Server] Job store append failed:', error?.message || error);
        }
        notifyJob(job.id);
    }
    const text = JSON.stringify(event);
    if (job.clients.size === 0) {
        job.pendingEvents.push(text);
        job.pendingBytes += Buffer.byteLength(text);
        while (
            job.pendingEvents.length > PROXY_STREAM_MAX_PENDING_EVENTS
            || job.pendingBytes > PROXY_STREAM_MAX_PENDING_BYTES
        ) {
            const removed = job.pendingEvents.shift();
            if (!removed) {
                break;
            }
            job.pendingBytes -= Buffer.byteLength(removed);
        }
        return;
    }
    for (const client of job.clients) {
        if (client.readyState === client.OPEN) {
            client.send(text);
        }
    }
}

function markJobDone(job) {
    if (job.done) {
        return;
    }
    job.done = true;
    job.cleanupAt = Date.now() + PROXY_STREAM_DONE_GRACE_MS;
    if (jobStore) {
        try {
            jobStore.finish(job.id, job.aborted ? 'aborted' : job.failed ? 'error' : 'done');
        } catch (error) {
            console.error('[Server] Job store finish failed:', error?.message || error);
        }
        notifyJob(job.id);
    }
}

function cleanupJob(jobId) {
    const job = proxyStreamJobs.get(jobId);
    if (!job) {
        return;
    }
    for (const client of job.clients) {
        try {
            client.close();
        } catch {
            // ignore
        }
    }
    proxyStreamJobs.delete(jobId);
}

async function runProxyStreamJob(job, arg) {
    const targetUrl = sanitizeTargetUrl(arg.targetUrl);
    if (!targetUrl) {
        pushJobEvent(job, {
            type: 'error',
            status: 400,
            message: 'Blocked non-local target URL'
        });
        markJobDone(job);
        return;
    }

    const headers = normalizeForwardHeaders(arg.headers);
    if (!headers['x-forwarded-for']) {
        headers['x-forwarded-for'] = arg.clientIp;
    }
    let bodyBuffer = arg.bodyBase64 ? Buffer.from(arg.bodyBase64, 'base64') : undefined;
    // the app cannot send reasoning_effort for its Custom API model; see requestDefaults.cjs
    const defaulted = applyReasoningDefault(bodyBuffer);
    if (defaulted.changed) {
        bodyBuffer = defaulted.body;
        if (!reasoningDefaultLogged.has(defaulted.model)) {
            reasoningDefaultLogged.add(defaulted.model);
            console.log(`[Server] reasoning_effort=${defaulted.effort} added to requests for model ${defaulted.model} (set RISU_REASONING_DEFAULTS='{}' to turn off)`);
        }
    }

    try {
        const upstreamResponse = await requestLocalTargetStream(targetUrl, {
            method: arg.method,
            headers,
            bodyBuffer,
            timeoutMs: job.timeoutMs,
            signal: job.abortController.signal
        });

        const filteredHeaders = {};
        for (const [key, value] of Object.entries(upstreamResponse.headers)) {
            if (key === 'content-security-policy' || key === 'content-security-policy-report-only' || key === 'clear-site-data') {
                continue;
            }
            filteredHeaders[key] = value;
        }

        if (upstreamResponse.status >= 400) {
            // The model answered with an error. Its body is still delivered, but the job is a failed one: it must
            // not be reused, or a page refresh would replay this error instead of asking again.
            job.failed = true;
        }
        pushJobEvent(job, {
            type: 'upstream_headers',
            status: upstreamResponse.status,
            headers: filteredHeaders
        });

        if (upstreamResponse.body) {
            for await (const value of upstreamResponse.body) {
                if (job.abortController.signal.aborted) {
                    break;
                }
                if (value && value.length > 0) {
                    pushJobEvent(job, {
                        type: 'chunk',
                        dataBase64: Buffer.from(value).toString('base64')
                    });
                }
            }
        }
        pushJobEvent(job, { type: 'done' });
        markJobDone(job);
    } catch (error) {
        const message = error?.name === 'AbortError' ? 'Proxy stream job aborted' : `${error}`;
        pushJobEvent(job, {
            type: 'error',
            status: 504,
            message
        });
        markJobDone(job);
    }
}

async function forwardUpstreamResponse(originalResponse, res) {
    const head = new Headers(originalResponse.headers);
    head.delete('content-security-policy');
    head.delete('content-security-policy-report-only');
    head.delete('clear-site-data');
    head.delete('Cache-Control');
    head.delete('Content-Encoding');

    const contentType = (head.get('content-type') || '').toLowerCase();
    const isSSE = contentType.includes('text/event-stream');
    if (isSSE) {
        head.set('Cache-Control', 'no-cache, no-transform');
        head.set('Connection', 'keep-alive');
        head.set('X-Accel-Buffering', 'no');
        head.delete('content-length');
    }

    const headObj = {};
    for (const [k, v] of head) {
        headObj[k] = v;
    }

    res.header(headObj);
    res.status(originalResponse.status);

    if (!originalResponse.body) {
        res.end();
        return;
    }

    if (!isSSE) {
        await pipeline(originalResponse.body, res);
        return;
    }

    const reader = originalResponse.body.getReader();

    const onClose = () => {
        reader.cancel().catch(() => {});
    };
    res.on('close', onClose);

    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    try {
        while (!res.writableEnded) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (value && value.length > 0) {
                res.write(Buffer.from(value));
            }
        }
    } catch (error) {
        if (!res.writableEnded) {
            throw error;
        }
    } finally {
        res.off('close', onClose);
        if (!res.writableEnded) {
            res.end();
        }
    }
}

// RISU_ACCESS_LOG=1 also lets the page report its own errors to /__client-log, so a phone that stops at the loading screen says why.
// Anything that came from a request and goes into a log line: no line breaks or control characters, so it cannot forge another line.
const logSafe = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ');
const CLIENT_ERROR_HOOK = `<script>(function(){function r(m){try{new Image().src='/__client-log?t='+Date.now()+'&m='+encodeURIComponent(String(m).slice(0,500))}catch(e){}}
window.__brLog=r;(function(){try{var n=performance.getEntriesByType('navigation')[0];var p=sessionStorage.getItem('br-phase');r('page start nav='+(n&&n.type)+' prevPhase='+(p||'-')+(p?' ('+Math.round((Date.now()-Number(p.split('@')[1]))/1000)+'s ago)':''))}catch(e){}})();addEventListener('error',function(e){r('error: '+(e.message||'')+' @'+(e.filename||'')+':'+(e.lineno||'')+':'+(e.colno||''))},true);
addEventListener('unhandledrejection',function(e){var x=e.reason;r('rejection: '+((x&&(x.stack||x.message))||x))});
var st=function(){var d=document.body&&document.body.innerText||'';return d.replace(/\\s+/g,' ').slice(0,160)};
var last=Date.now();setInterval(function(){var n=Date.now(),g=n-last;last=n;if(g>1500)r('BLOCKED '+g+'ms phase='+(window.__brPhase||'-')+' text='+st())},500);
setTimeout(function(){r('t+8s sw='+(navigator.serviceWorker&&navigator.serviceWorker.controller?'controlled':'none')+' text='+st())},8000);
setTimeout(function(){r('t+20s text='+st())},20000)})()</script>`;
app.get('/__client-log', (req, res) => {
    if (process.env.RISU_ACCESS_LOG) console.log(`[ClientLog] ${new Date().toISOString()} ${logSafe(String(req.query.m || '').slice(0, 500))}`);
    res.status(204).end();
});
app.get('/', async (req, res, next) => {

    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'Unknown IP';
    const timestamp = new Date().toISOString();
    console.log(`[Server] ${timestamp} | Connection from: ${logSafe(clientIP)}`);
    
    try {
        const mainIndex = await fs.readFile(path.join(process.cwd(), 'dist', 'index.html'))
        const root = htmlparser.parse(mainIndex)
        const head = root.querySelector('head')
        head.innerHTML = `<script>globalThis.__NODE__ = true</script>` + (process.env.RISU_ACCESS_LOG ? CLIENT_ERROR_HOOK : '') + head.innerHTML
        
        // The shell names this build's hashed bundles: a copy kept by the phone after a rebuild points at files that are gone.
        res.set('Cache-Control', 'no-store')
        res.send(root.toString())
    } catch (error) {
        console.log(error)
        next(error)
    }
})

async function checkAuth(req, res, returnOnlyStatus = false){
    try {
        const authHeader = normalizeAuthHeader(req.headers['risu-auth']);

        if(!authHeader){
            console.log('No auth header')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'No auth header'
            });
            return false
        }


        //jwt token
        const [
            jsonHeaderB64,
            jsonPayloadB64,
            signatureB64,
        ] = authHeader.split('.');

        //alg, typ
        const jsonHeader = JSON.parse(Buffer.from(jsonHeaderB64, 'base64url').toString('utf-8'));

        //iat, exp, pub
        const jsonPayload = JSON.parse(Buffer.from(jsonPayloadB64, 'base64url').toString('utf-8'));

        //signature
        const signature = Buffer.from(signatureB64, 'base64url');

        
        //check expiration
        const now = Math.floor(Date.now() / 1000);
        if(jsonPayload.exp < now){
            console.log('Token expired')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'Token Expired'
            });
            return false
        }

        //check if public key is known
        const pubKeyHash = await hashJSON(jsonPayload.pub)
        if(!knownPublicKeysHashes.includes(pubKeyHash)){
            console.log('Unknown public key')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'Unknown Public Key'
            });
            return false
        }

        //check signature
        if(jsonHeader.alg !== "ES256"){
            //only support ECDSA for now
            console.log('Unsupported algorithm')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'Unsupported Algorithm'
            });
            return false
        }

        const isValid = await crypto.subtle.verify(
            {
                name: 'ECDSA',
                hash: {name: 'SHA-256'},
            },
            await crypto.subtle.importKey(
                'jwk',
                jsonPayload.pub,
                {
                    name: 'ECDSA',
                    namedCurve: 'P-256',
                },
                false,
                ['verify']
            ),
            signature,
            Buffer.from(`${jsonHeaderB64}.${jsonPayloadB64}`)
        );

        req.risuClient = pubKeyHash
        if(!isValid){
            console.log('Invalid signature')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'Invalid Signature'
            });
            return false
        }
        
        return true   
    } catch (error) {
        console.log(error)
        if(returnOnlyStatus){
            return false;
        }
        res.status(500).send({
            error:'Internal Server Error'
        });
        return false
    }
}

const reverseProxyFunc = async (req, res, next) => {
    if(!await checkProxyAuth(req, res)){
        return;
    }
    
    const urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;

    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return;
    }
    const header = req.headers['risu-header'] ? JSON.parse(decodeURIComponent(req.headers['risu-header'])) : req.headers;
    if(!header['x-forwarded-for']){
        header['x-forwarded-for'] = req.ip
    }

    if(req.headers['authorization']?.startsWith('X-SERVER-REGISTER')){
        if(!existsSync(authCodePath)){
            delete header['authorization']
        }
        else{
            const authCode = await fs.readFile(authCodePath, {
                encoding: 'utf-8'
            })
            header['authorization'] = `Bearer ${authCode}`
        }
    }
    const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms']);
    const timeout = createTimeoutController(timeoutMs);
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: req.method,
            headers: header,
            body: JSON.stringify(req.body),
            signal: timeout.signal
        });
        // get response body as stream
        const originalBody = originalResponse.body;
        // get response headers
        const head = new Headers(originalResponse.headers);
        head.delete('content-security-policy');
        head.delete('content-security-policy-report-only');
        head.delete('clear-site-data');
        head.delete('Cache-Control');
        head.delete('Content-Encoding');
        const headObj = {};
        for (let [k, v] of head) {
            headObj[k] = v;
        }
        // send response headers to client
        res.header(headObj);
        // send response status to client
        res.status(originalResponse.status);
        // send response body to client
        await pipeline(originalResponse.body, res);

    }
    catch (err) {
        if (err?.name === 'AbortError') {
            if (!res.headersSent) {
                res.status(504).send({
                    error: timeoutMs
                        ? `Proxy request timed out after ${timeoutMs}ms`
                        : 'Proxy request aborted'
                });
            } else {
                res.end();
            }
            return;
        }
        next(err);
        return;
    } finally {
        timeout.cleanup();
    }
}

const reverseProxyFunc_get = async (req, res, next) => {
    if(!await checkProxyAuth(req, res)){
        return;
    }
    
    const urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;

    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return;
    }
    const header = req.headers['risu-header'] ? JSON.parse(decodeURIComponent(req.headers['risu-header'])) : req.headers;
    if(!header['x-forwarded-for']){
        header['x-forwarded-for'] = req.ip
    }
    const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms']);
    const timeout = createTimeoutController(timeoutMs);
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: 'GET',
            headers: header,
            signal: timeout.signal
        });
        // get response body as stream
        const originalBody = originalResponse.body;
        // get response headers
        const head = new Headers(originalResponse.headers);
        head.delete('content-security-policy');
        head.delete('content-security-policy-report-only');
        head.delete('clear-site-data');
        head.delete('Cache-Control');
        head.delete('Content-Encoding');
        const headObj = {};
        for (let [k, v] of head) {
            headObj[k] = v;
        }
        // send response headers to client
        res.header(headObj);
        // send response status to client
        res.status(originalResponse.status);
        // send response body to client
        await pipeline(originalResponse.body, res);
    }
    catch (err) {
        if (err?.name === 'AbortError') {
            if (!res.headersSent) {
                res.status(504).send({
                    error: timeoutMs
                        ? `Proxy request timed out after ${timeoutMs}ms`
                        : 'Proxy request aborted'
                });
            } else {
                res.end();
            }
            return;
        }
        next(err);
        return;
    } finally {
        timeout.cleanup();
    }
}

let accessTokenCache = {
    token: null,
    expiry: 0
}
async function getSionywAccessToken() {
    if(accessTokenCache.token && Date.now() < accessTokenCache.expiry){
        return accessTokenCache.token;
    }
    //Schema of the client data file
    // {
    //     refresh_token: string;
    //     client_id: string;
    //     client_secret: string;
    // }
    
    const clientDataPath = path.join(process.cwd(), 'save', '__sionyw_client_data.json');
    let refreshToken = ''
    let clientId = ''
    let clientSecret = ''
    if(!existsSync(clientDataPath)){
        throw new Error('No Sionyw client data found');
    }
    const clientDataRaw = readFileSync(clientDataPath, 'utf-8');
    const clientData = JSON.parse(clientDataRaw);
    refreshToken = clientData.refresh_token;
    clientId = clientData.client_id;
    clientSecret = clientData.client_secret;

    //Oauth Refresh Token Flow
    
    const tokenResponse = await fetch('account.sionyw.com/account/api/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        })
    })

    if(!tokenResponse.ok){
        throw new Error('Failed to refresh Sionyw access token');
    }

    const tokenData = await tokenResponse.json();

    //Update the refresh token in the client data file
    if(tokenData.refresh_token && tokenData.refresh_token !== refreshToken){
        clientData.refresh_token = tokenData.refresh_token;
        writeFileSync(clientDataPath, JSON.stringify(clientData), 'utf-8');
    }

    accessTokenCache.token = tokenData.access_token;
    accessTokenCache.expiry = Date.now() + (tokenData.expires_in * 1000) - (5 * 60 * 1000); //5 minutes early

    return tokenData.access_token;
}


async function hubProxyFunc(req, res) {
    const excludedHeaders = [
        'content-encoding',
        'content-length',
        'transfer-encoding'
    ];

    try {
        let externalURL = '';

        const pathHeader = req.headers['x-risu-node-path'];
        if (pathHeader) {
            const decodedPath = decodeURIComponent(pathHeader);
            externalURL = decodedPath;
        } else {
            const pathAndQuery = req.originalUrl.replace(/^\/hub-proxy/, '');
            externalURL = hubURL + pathAndQuery;
        }
        
        const headersToSend = { ...req.headers };
        delete headersToSend.host;
        delete headersToSend.connection;
        delete headersToSend['content-length'];
        delete headersToSend['x-risu-node-path'];

        const hubOrigin = new URL(hubURL).origin;
        headersToSend.origin = hubOrigin;

        //if Authorization header is "Server-Auth, set the token to be Server-Auth
        if(headersToSend['Authorization'] === 'X-Node-Server-Auth'){
            //this requires password auth
            if(!await checkAuth(req, res)){
                return;
            }

            headersToSend['Authorization'] = "Bearer " + await getSionywAccessToken();
            delete headersToSend['risu-auth'];
        }
        
        
        const response = await fetch(externalURL, {
            method: req.method,
            headers: headersToSend,
            body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
            redirect: 'manual',
            duplex: 'half'
        });
        
        for (const [key, value] of response.headers.entries()) {
            // Skip encoding-related headers to prevent double decoding
            if (excludedHeaders.includes(key.toLowerCase())) {
                continue;
            }
            res.setHeader(key, value);
        }
        res.status(response.status);

        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            const redirectUrl = response.headers.get('location');
            const newHeaders = { ...headersToSend };
            const redirectResponse = await fetch(redirectUrl, {
                method: req.method,
                headers: newHeaders,
                body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
                redirect: 'manual',
                duplex: 'half'
            });
            for (const [key, value] of redirectResponse.headers.entries()) {
                if (excludedHeaders.includes(key.toLowerCase())) {
                    continue;
                }
                res.setHeader(key, value);
            }
            res.status(redirectResponse.status);
            if (redirectResponse.body) {
                await pipeline(redirectResponse.body, res);
            } else {
                res.end();
            }
            return;
        }
        
        if (response.body) {
            await pipeline(response.body, res);
        } else {
            res.end();
        }
        
    } catch (error) {
        console.error("[Hub Proxy] Error:", error);
        if (!res.headersSent) {
            res.status(502).send({ error: 'Proxy request failed: ' + error.message });
        } else {
            res.end();
        }
    }
}

app.get('/proxy', authenticatedRouteLimiter, reverseProxyFunc_get);
app.get('/proxy2', authenticatedRouteLimiter, reverseProxyFunc_get);
app.get('/hub-proxy/*', authenticatedRouteLimiter, hubProxyFunc);

app.post('/proxy', authenticatedRouteLimiter, reverseProxyFunc);
app.post('/proxy2', authenticatedRouteLimiter, reverseProxyFunc);
app.post('/hub-proxy/*', authenticatedRouteLimiter, hubProxyFunc);
// Chat pictures drawn on the server (imageJobs.cjs): the picture lands in inlays/<id> even when the page that asked is closed.
let imageJobs = null;
try {
    const imageDb = path.join(path.dirname(process.env.RISU_JOBS_DB || path.join(require('os').homedir(), '.risu-lan', 'jobs.sqlite')), 'image-jobs.sqlite');
    imageJobs = require('./imageJobs.cjs').openImageJobs({
        dbFile: imageDb,
        writeInlay: async (id, bytes) => { saveQueue.enqueueWrite(Buffer.from(`inlays/${id}`, 'utf-8').toString('hex'), bytes); },
    });
    console.log(`[Server] Image jobs ready (${imageDb}); pruned ${imageJobs.prune()}`);
    setInterval(() => { try { imageJobs.prune(); } catch { /* ignore */ } }, 60 * 60 * 1000).unref();
} catch (error) {
    console.error('[Server] Image jobs unavailable, pictures are drawn by the page:', error?.message || error);
    imageJobs = null;
}

// Local TTS (pdf2mp3's API, vieneu + kokoro) streamed through this server, so a phone on the LAN reaches it too and the
// audio is never buffered here: the TTS server sends one MP3 per chunk as soon as it is ready (0.31 s to the first sound of a
// 220-word message, against 12.8 s for the whole file; measured 2026-10-15). The target is fixed to this machine.
const LOCAL_TTS_URL = (process.env.RISU_TTS_URL || 'http://127.0.0.1:8765/v1').replace(/\/+$/, '');
async function pipeLocalTTS(req, res, path, body) {
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });   // the page stopped listening: stop synthesis
    try {
        const upstream = await fetch(LOCAL_TTS_URL + path, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
        });
        res.status(upstream.status);
        for (const h of ['content-type', 'x-cache', 'retry-after']) {
            const v = upstream.headers.get(h);
            if (v) res.setHeader(h, v);
        }
        res.setHeader('cache-control', 'no-store');
        res.flushHeaders?.();
        if (!upstream.body) { res.end(); return; }
        for await (const piece of upstream.body) {
            if (!res.write(Buffer.from(piece))) await new Promise((r) => res.once('drain', r));
        }
        res.end();
    } catch (error) {
        if (ctrl.signal.aborted) return;
        if (!res.headersSent) res.status(502).send({ error: { message: 'local TTS unreachable: ' + String(error?.message || error) } });
        else res.end();
    }
}
// at most TTS_PER_MINUTE readings a minute: a run of taps (or a stuck script) must not keep the TTS server busy
const TTS_PER_MINUTE = Number(process.env.RISU_TTS_PER_MINUTE || 60);
const ttsTimes = [];
function ttsAllowed(now = Date.now()) {
    while (ttsTimes.length && now - ttsTimes[0] > 60000) ttsTimes.shift();
    if (ttsTimes.length >= TTS_PER_MINUTE) return false;
    ttsTimes.push(now);
    return true;
}
app.post('/api/tts/speech', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkAuth(req, res)) return;
    if (!ttsAllowed()) { res.status(429).setHeader('retry-after', '20'); res.send({ error: { message: 'too many readings, wait a little' } }); return; }
    const { model, voice, input } = req.body ?? {};
    if (typeof input !== 'string' || !input.trim()) { res.status(400).send({ error: { message: 'input is empty' } }); return; }
    await pipeLocalTTS(req, res, '/audio/speech', { model, voice, input, stream: true });
});
app.post('/api/tts/warm', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkAuth(req, res)) return;
    await pipeLocalTTS(req, res, '/audio/warm', { model: req.body?.model, voice: req.body?.voice });
});

app.post('/api/image-jobs', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkAuth(req, res)) return;
    if (!imageJobs) { res.status(503).send({ error: 'image jobs unavailable' }); return; }
    const request = req.body?.request;
    const url = typeof request?.url === 'string' ? sanitizeTargetUrl(request.url) : null;
    if (!url) { res.status(400).send({ error: 'Invalid target URL. Only local/private network http(s) endpoints are allowed.' }); return; }
    try {
        const id = imageJobs.submit({ ...request, url }, req.body?.target ?? null);
        res.send({ id });
    } catch (error) {
        res.status(400).send({ error: String(error?.message || error) });
    }
});

app.get('/api/image-jobs', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkAuth(req, res)) return;
    res.send({ jobs: imageJobs ? imageJobs.unacked() : [] });
});

app.get('/api/image-jobs/:id', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkAuth(req, res)) return;
    const job = imageJobs?.get(req.params.id);
    if (!job) { res.status(404).send({ error: 'no such job' }); return; }
    res.send(job);
});

app.post('/api/image-jobs/:id/ack', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkAuth(req, res)) return;
    res.send({ acked: imageJobs ? imageJobs.ack(req.params.id) : false });
});

app.post('/proxy-stream-jobs', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkProxyAuth(req, res)) {
        return;
    }

    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const encodedUrl = encodeURIComponent(rawUrl);
    const url = sanitizeTargetUrl(decodeURIComponent(encodedUrl));
    if (!url) {
        res.status(400).send({ error: 'Invalid target URL. Only local/private network http(s) endpoints are allowed.' });
        return;
    }

    const method = typeof req.body?.method === 'string' ? req.body.method.toUpperCase() : 'POST';
    if (!['POST', 'GET', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        res.status(400).send({ error: 'Invalid method' });
        return;
    }

    const bodyBase64 = typeof req.body?.bodyBase64 === 'string' ? req.body.bodyBase64 : '';
    if (bodyBase64.length > PROXY_STREAM_MAX_BODY_BASE64_BYTES) {
        res.status(413).send({ error: 'Request body too large' });
        return;
    }
    const heartbeatSec = normalizeHeartbeatSec(Number(req.body?.heartbeatSec));
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.slice(0, 200) : '';
    const reusable = idempotencyKey && jobStore ? jobStore.findReusable(idempotencyKey, PROXY_JOB_REUSE_MAX_AGE_MS) : null;
    if (reusable) {
        // The same generation asked again (the page was refreshed): hand back the job that already has, or is
        // producing, the reply instead of asking the model a second time.
        res.send({ jobId: reusable.id, heartbeatSec, reused: true });
        return;
    }
    if (proxyStreamJobs.size >= PROXY_STREAM_MAX_ACTIVE_JOBS) {
        res.status(429).send({ error: 'Too many active stream jobs. Retry shortly.' });
        return;
    }
    const headers = normalizeForwardHeaders(req.body?.headers);
    const job = createProxyStreamJob({
        heartbeatSec,
        timeoutMs: req.body?.timeoutMs,
        idempotencyKey
    });

    void runProxyStreamJob(job, {
        targetUrl: url,
        headers,
        method,
        bodyBase64,
        clientIp: req.ip
    });

    res.send({
        jobId: job.id,
        heartbeatSec: job.heartbeatSec
    });
});

app.delete('/proxy-stream-jobs/:jobId', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkProxyAuth(req, res)) {
        return;
    }
    const job = proxyStreamJobs.get(req.params.jobId);
    if (!job) {
        try {
            jobStore?.finish(req.params.jobId, 'aborted');
        } catch { /* ignore */ }
        res.send({ success: true });
        return;
    }
    job.aborted = true;
    job.abortController.abort();
    markJobDone(job);
    cleanupJob(job.id);
    res.send({ success: true });
});

// Replays a job's events from a cursor, then follows it live: GET /proxy-stream-jobs/:id/events?from=N.
// One JSON line per event: {"seq":N,"event":{...}}; {"type":"ping"} lines keep the connection from idling out.
app.get('/proxy-stream-jobs/:jobId/events', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkProxyAuth(req, res)) {
        return;
    }
    const jobId = req.params.jobId;
    if (!jobStore || !jobStore.getJob(jobId)) {
        res.status(404).send({ error: 'Unknown job' });
        return;
    }
    let next = Math.max(1, Number.parseInt(String(req.query.from), 10) || 1);
    let closed = false;
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.on('close', () => {
        closed = true;
        notifyJob(jobId);
    });
    const heartbeat = setInterval(() => {
        if (!closed) {
            res.write('{"type":"ping"}\n');
        }
    }, 15000);
    try {
        while (!closed) {
            const rows = jobStore.eventsFrom(jobId, next, 200);
            let ended = false;
            for (const row of rows) {
                res.write(JSON.stringify(row) + '\n');
                next = row.seq + 1;
                if (row.event.type === 'done' || row.event.type === 'error') {
                    ended = true;
                }
            }
            if (ended) {
                break;
            }
            if (rows.length > 0) {
                continue;
            }
            const job = jobStore.getJob(jobId);
            if (!job || job.status !== 'running') {
                break;
            }
            await waitForJob(jobId, 15000);
        }
    } catch (error) {
        console.error('[Server] Job events stream failed:', error?.message || error);
    } finally {
        clearInterval(heartbeat);
        res.end();
    }
});

// app.get('/api/password', async(req, res)=> {
//     if(password === ''){
//         res.send({status: 'unset'})
//     }
//     else if(req.body.password && req.body.password.trim() === password.trim()){
//         res.send({status:'correct'})
//     }
//     else{
//         res.send({status:'incorrect'})
//     }
// })

app.get('/api/test_auth', authRouteLimiter, async(req, res) => {

    if(!password){
        res.send({status: 'unset'})
    }
    else if(!await checkAuth(req, res, true)){
        res.send({status: 'incorrect'})
    }
    else{
        res.send({status: 'success'})
    }
})

app.post('/api/login', loginRouteLimiter, async (req, res) => {
    if(password === ''){
        res.status(400).send({error: 'Password not set'})
        return;
    }
    if(req.body.password && req.body.password.trim() === password.trim()){
        knownPublicKeysHashes.push(await hashJSON(req.body.publicKey))
        writeFileSync(knownPublicKeysPath, JSON.stringify(knownPublicKeysHashes), 'utf-8')
        res.send({status:'success'})
    }
    else{
        res.status(400).send({error: 'Password incorrect'})
    }
})

app.post('/api/crypto', async (req, res) => {
    try {
        const hash = crypto.createHash('sha256')
        hash.update(Buffer.from(req.body.data, 'utf-8'))
        res.send(hash.digest('hex'))
    } catch (error) {
        res.status(500).send({ error: 'Crypto operation failed' });
    }
})


app.post('/api/set_password', async (req, res) => {
    if(password === ''){
        password = req.body.password
        writeFileSync(passwordPath, password, 'utf-8')
        res.send({status: 'success'})
    }
    else{
        res.status(400).send("already set")
    }
})

app.get('/api/read', authenticatedRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    const filePath = req.headers['file-path'];
    if (!filePath) {
        console.log('no path')
        res.status(400).send({
            error:'File path required'
        });
        return;
    }

    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }
    try {
        if(dbSync && filePath === DB_KEY_HEX){
            // a page loads the database: that is what its later writes are compared with
            const bytes = currentSaveBytes(filePath);
            if(bytes && bytes.length > 0){
                try { res.setHeader('x-risu-rev', String(dbSync.onRead(clientIdOf(req), bytes))); } catch (error) { console.error('[Sync] read:', error.message); }
            }
        }
        // an acknowledged write that has not reached the directory yet is the newest state
        const queued = saveQueue.readPending(filePath);
        if(queued){
            if(queued.op === 'delete'){
                res.send();
            }
            else{
                res.setHeader('Content-Type','application/octet-stream');
                res.send(queued.data);
            }
        }
        else if(!existsSync(path.join(savePath, filePath))){
            res.send();
        }
        else{
            res.setHeader('Content-Type','application/octet-stream');
            res.sendFile(path.join(savePath, filePath));
        }
    } catch (error) {
        next(error);
    }
});

app.get('/api/remove', authenticatedRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    const filePaths = req.headers['file-path']?.split('$$') || []

    for(const filePath of filePaths){
        if (!filePath) {
            res.status(400).send({
                error:'File path required'
            });
            return;
        }
        if(!isHex(filePath)){
            res.status(400).send({
                error:'Invaild Path'
            });
            return;
        }

        try {
            saveQueue.enqueueDelete(filePath);
        } catch (error) {
            next(error);
            return;
        }
    }
    // one answer for the whole request; it used to answer inside the loop, so a second path made res.send throw
    res.send({
        success: true,
    });
});

app.get('/api/list', authenticatedRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    try {
        // the queue first, then the directory: a row the worker finishes in between is then in the directory listing, and a delete
        // it finishes in between is still in the snapshot. The other order can miss a write or show a deleted key.
        const pending = saveQueue.pendingKeys()
        const names = new Set(await fs.readdir(path.join(savePath)))
        for (const row of pending) {
            if (row.op === 'delete') names.delete(row.key); else names.add(row.key);
        }
        const data = [...names].map((v) => {
            return Buffer.from(v, 'hex').toString('utf-8')
        })
        res.send({
            success: true,
            content: data
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/write', authenticatedRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    const filePath = req.headers['file-path'];
    const fileContent = req.body
    if (!filePath || !fileContent) {
        res.status(400).send({
            error:'File path required'
        });
        return;
    }
    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }

    try {
        let toStore = fileContent;
        let merged = false;
        if(dbSync && filePath === DB_KEY_HEX && Buffer.isBuffer(fileContent)){
            try {
                const r = dbSync.onWrite(clientIdOf(req), fileContent, currentSaveBytes(filePath));
                toStore = r.bytes;
                merged = r.merged;
                res.setHeader('x-risu-rev', String(r.rev));
                if(r.merged && Date.now() - lastPremergeAt > 10 * 60 * 1000){
                    // a safety copy of what the server had and what the page wrote, at most one pair per ten minutes
                    lastPremergeAt = Date.now();
                    const cur = currentSaveBytes(filePath);
                    const tag = new Date().toISOString().replace(/[:.]/g, '-');
                    if(cur) saveQueue.enqueueWrite(Buffer.from(`database/premerge-${tag}-server.bin`).toString('hex'), cur);
                    saveQueue.enqueueWrite(Buffer.from(`database/premerge-${tag}-page.bin`).toString('hex'), fileContent);
                }
            } catch (error) {
                // never lose a write because the merge failed: store what the page wrote
                console.error('[Sync] write:', error.message);
            }
        }
        // committed to SQLite before we answer; the worker moves it to the directory (atomically) in order
        saveQueue.enqueueWrite(filePath, toStore);
        res.send({
            success: true,
            merged
        });
    } catch (error) {
        next(error);
    }
});

const oauthData = {
    client_id: '',
    client_secret: '',
    config: {},
    code_verifier: ''

}
app.get('/api/oauth_login', async (req, res) => {
    const redirect_uri = (new URL (req.url)).host + '/api/oauth_callback'

    if(!redirect_uri){
        res.status(400).send({ error: 'redirect_uri is required' });
        return
    }
    if(!oauthData.client_id || !oauthData.client_secret){
        const discovery = await openid.discovery('https://account.sionyw.com/','','');
        oauthData.config = discovery;

        //oauth dynamic client registration
        //https://datatracker.ietf.org/doc/html/rfc7591

        const serverMeta = discovery.serverMetadata()
        //since we can't find a good library to do this, we will do it manually
        const registrationResponse = await fetch(serverMeta.registration_endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (serverMeta.registration_access_token || '')
            },
            body: JSON.stringify({
                client_id: oauthData.client_id,
                client_secret: oauthData.client_secret,
                redirect_uris: [redirect_uri],
                response_types: ['code'],
                grant_types: ['authorization_code'],
                scope: 'risuai',
                token_endpoint_auth_method: 'client_secret_basic',
                client_name: 'Risuai Node Server',
            })
        });

        if(registrationResponse.status === 201 || registrationResponse.status === 200){
            const registrationData = await registrationResponse.json();
            oauthData.client_id = registrationData.client_id;
            oauthData.client_secret = registrationData.client_secret;
            discovery.clientMetadata().client_id = oauthData.client_id;
            discovery.clientMetadata().client_secret = oauthData.client_secret;
        }
        else{
            console.error('[Server] OAuth2 dynamic client registration failed:', registrationResponse.statusText);
            res.status(500).send({ error: 'OAuth2 client registration failed' });
            return
        }


        //now lets request

        let code_verifier = openid.randomPKCECodeVerifier();
        let code_challenge = await openid.calculatePKCECodeChallenge(code_verifier);

        oauthData.code_verifier = code_verifier;
        let redirectTo = openid.buildAuthorizationUrl(oauthData.config, {
            redirect_uri,
            code_challenge,
            code_challenge_method: 'S256',
            scope: 'risuai',
        })

        res.redirect(redirectTo.toString());

        return;

    }
    
    res.status(500).send({ error: 'OAuth2 login failed' });
});

app.get('/api/oauth_callback', async (req, res) => {

    //since this is a callback we don't need to check password

    const params = (new URL(req.url, `http://${req.headers.host}`)).searchParams;
    const code = params.get('code');

    if(!code){
        res.status(400).send({ error: 'code is required' });
        return
    }
    if(!oauthData.client_id || !oauthData.client_secret || !oauthData.code_verifier){
        res.status(400).send({ error: 'OAuth2 not initialized' });
        return
    }

    let tokens = await openid.authorizationCodeGrant(
        oauthData.config,   
        getCurrentUrl(),
        {
            pkceCodeVerifier: oauthData.code_verifier,
        },
    )

    writeFileSync(authCodePath, tokens.access_token, 'utf-8')

    res.send(tokens)
            
})

async function getHttpsOptions() {

    const keyPath = path.join(sslPath, 'server.key');
    const certPath = path.join(sslPath, 'server.crt');

    try {
 
        await fs.access(keyPath);
        await fs.access(certPath);

        const [key, cert] = await Promise.all([
            fs.readFile(keyPath),
            fs.readFile(certPath)
        ]);
       
        return { key, cert };

    } catch (error) {
        console.error('[Server] SSL setup errors:', error.message);
        console.log('[Server] Start the server with HTTP instead of HTTPS...');
        return null;
    }
}

function setupProxyStreamWebSocket(server) {
    const wsServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', async (req, socket, head) => {
        try {
            const reqUrl = new URL(req.url, `http://${req.headers.host}`);
            if (!reqUrl.pathname.startsWith('/proxy-stream-jobs/') || !reqUrl.pathname.endsWith('/ws')) {
                socket.destroy();
                return;
            }

            const auth = reqUrl.searchParams.get('risu-auth') || req.headers['risu-auth'];
            if (!await isAuthorizedProxyRequest({ headers: { 'risu-auth': auth } })) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            const pathParts = reqUrl.pathname.split('/').filter(Boolean);
            const jobId = pathParts.length >= 3 ? pathParts[1] : '';
            const job = proxyStreamJobs.get(jobId);
            if (!job) {
                socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                socket.destroy();
                return;
            }

            wsServer.handleUpgrade(req, socket, head, (ws) => {
                wsServer.emit('connection', ws, req, jobId);
            });
        } catch {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
        }
    });

    wsServer.on('connection', (ws, _req, jobId) => {
        const job = proxyStreamJobs.get(jobId);
        if (!job) {
            ws.close();
            return;
        }

        job.clients.add(ws);
        ws.send(JSON.stringify({ type: 'job_accepted', jobId }));
        for (const event of job.pendingEvents) {
            ws.send(event);
        }
        job.pendingEvents = [];
        job.pendingBytes = 0;

        const pingTimer = setInterval(() => {
            if (ws.readyState !== ws.OPEN) {
                return;
            }
            ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }, job.heartbeatSec * 1000);

        ws.on('close', () => {
            clearInterval(pingTimer);
            const currentJob = proxyStreamJobs.get(jobId);
            if (!currentJob) {
                return;
            }
            currentJob.clients.delete(ws);
            if (currentJob.done && currentJob.clients.size === 0) {
                cleanupJob(jobId);
            }
        });

        ws.on('error', () => {
            clearInterval(pingTimer);
        });
    });
}

async function startServer() {
    try {
      
        const port = process.env.PORT || 6001;
        const httpsOptions = await getHttpsOptions();
        let server = null;

        if (httpsOptions) {
            // HTTPS
            server = https.createServer(httpsOptions, app);
            setupProxyStreamWebSocket(server);
            server.listen(port, () => {
                console.log("[Server] HTTPS server is running.");
                console.log(`[Server] https://localhost:${port}/`);
            });
        } else {
            // HTTP
            server = http.createServer(app);
            setupProxyStreamWebSocket(server);
            server.listen(port, () => {
                console.log("[Server] HTTP server is running.");
                console.log(`[Server] http://localhost:${port}/`);
            });
        }
    } catch (error) {
        console.error('[Server] Failed to start server :', error);
        process.exit(1);
    }
}

(async () => {
    setInterval(() => {
        const now = Date.now();
        for (const [jobId, job] of proxyStreamJobs.entries()) {
            if (!job.done && now >= job.deadlineAt && !job.abortController.signal.aborted) {
                job.abortController.abort();
            }
            if (job.done && job.clients.size === 0 && job.cleanupAt > 0 && now >= job.cleanupAt) {
                cleanupJob(jobId);
                continue;
            }
            if (!job.done && now - job.updatedAt > Math.max(PROXY_STREAM_DEFAULT_TIMEOUT_MS, job.timeoutMs * 2)) {
                cleanupJob(jobId);
            }
        }
    }, PROXY_STREAM_GC_INTERVAL_MS);
    await startServer();
})();
