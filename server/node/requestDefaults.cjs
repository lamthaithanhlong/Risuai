// Default request parameters the chat app cannot send for the "Custom API" model.
//
// Measured on this setup (9router, grok-4.5, the Fate Simulator prompt of ~7k tokens): the app sends no reasoning_effort for its Custom API
// model (modellist.ts lists only temperature/top_*/thinking_tokens for it), so the provider thinks at its default, which is long:
// 3431 to 4081 hidden reasoning tokens before the first visible word, 75 to 85 s of "Thoughts ...". With reasoning_effort "low" the
// same prompt took 1836 reasoning tokens and 50 s in total. This adds that parameter on the server, for the models named below, only
// when the request does not already set one, so it works for every device and needs no change to the saved database.
//
// RISU_REASONING_DEFAULTS is a JSON object {model: effort}; "{}" turns it off. Default: the main combo and its target.

const DEFAULTS = { 'main': 'low', 'mvn/grok-4.5': 'low', 'grok-4.5': 'low' }
const EFFORTS = new Set(['low', 'medium', 'high', 'minimal'])
const ALREADY_SET = ['reasoning_effort', 'reasoning', 'thinking', 'thinking_budget', 'enable_thinking']

function readConfig(env = process.env) {
    if (env.RISU_REASONING_DEFAULTS === undefined || env.RISU_REASONING_DEFAULTS === '') {
        return DEFAULTS
    }
    try {
        const parsed = JSON.parse(env.RISU_REASONING_DEFAULTS)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : DEFAULTS
    } catch (error) {
        return DEFAULTS
    }
}

// body: Buffer of the request about to be sent upstream. Returns {body, changed, model, effort}; body is the same Buffer when nothing changed.
function applyReasoningDefault(body, config = readConfig()) {
    const none = { body, changed: false }
    if (!body || body.length === 0 || body.length > 8 * 1024 * 1024 || body[0] !== 0x7b /* { */) {
        return none
    }
    let json
    try {
        json = JSON.parse(body.toString('utf8'))
    } catch (error) {
        return none
    }
    if (!json || typeof json !== 'object' || typeof json.model !== 'string' || !Array.isArray(json.messages)) {
        return none
    }
    const effort = config[json.model]
    if (typeof effort !== 'string' || !EFFORTS.has(effort)) {
        return none
    }
    if (ALREADY_SET.some((k) => json[k] !== undefined)) {
        return none
    }
    json.reasoning_effort = effort
    return { body: Buffer.from(JSON.stringify(json), 'utf8'), changed: true, model: json.model, effort }
}

module.exports = { applyReasoningDefault, readConfig, DEFAULTS }
