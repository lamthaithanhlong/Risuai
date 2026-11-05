// What the L1 push gate types in its fixed turns (run.mjs, --gate): the creation answer and the 2 turns after "Được".
// The Evelyn gate (companion call) is the history and stays exactly as it was; a --system run talks to the Hệ thống instead and plays the persona
// fixture of its story (fixtures/personas/<story>-system.md, first line `companion: none`).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePersonaFixture } from './system.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PERSONA_DIR = path.join(HERE, '..', 'fixtures', 'personas')
// zombie's fixture was written first, under the persona's name
const FIXTURE = { zombie: 'kenji-system.md', mailman: 'mailman-system.md', ss: 'ss-system.md', lotm: 'lotm-system.md' }

const LEGACY = {
    creationPersona: 'Hard. dùng persona kenji của tui',
    creationDefault: 'Hard. dùng persona kenji của tui, ngoại hình để thế giới chọn',
    call1: 'evelyn',
    call2: 'Evelyn, nhìn thử ngoài hành lang giúp tôi xem có gì không.',
}
const SYSTEM_CALLS = ['Hệ thống, cho tôi xem tình trạng của tôi và việc cần làm.', 'Hệ thống, quét thử xung quanh giúp tôi xem có gì không.']
// zombie keeps its own scene wording (the apartment corridor the card opens in); the others are scene-free
const SYSTEM_CALLS_ZOMBIE = ['Hệ thống, cho tôi xem tình trạng của tôi và việc cần làm.', 'Hệ thống, quét thử ngoài hành lang giúp tôi xem có gì không.']

/** the persona fixture a --system run of `key` plays: the explicit --persona-file text, else fixtures/personas/<key>-system.md; it must declare companion: none */
export function systemPersona(key, explicitFile = null, dir = PERSONA_DIR) {
    const file = explicitFile ?? path.join(dir, FIXTURE[key] ?? `${key}-system.md`)
    if (!fs.existsSync(file)) throw new Error(`--system: no persona fixture for "${key}" (${file}); write fixtures/personas/${FIXTURE[key] ?? `${key}-system.md`} with \`companion: none\` on its first line`)
    const fix = parsePersonaFixture(fs.readFileSync(file, 'utf8'))
    if (fix.companion !== 'none') throw new Error(`--system: ${file} must declare \`companion: none\` on its first line`)
    return fix
}

/** { creation, call1, call2 } of one gate run */
export function gateTurns({ key, system = false, hasPersona = false }) {
    if (system) {
        const personaName = key === 'zombie' ? 'kenji' : null
        const calls = key === 'zombie' ? SYSTEM_CALLS_ZOMBIE : SYSTEM_CALLS
        return { creation: personaName ? LEGACY.creationPersona : 'Hard. dùng persona của tui', call1: calls[0], call2: calls[1] }
    }
    return { creation: hasPersona ? LEGACY.creationPersona : LEGACY.creationDefault, call1: LEGACY.call1, call2: LEGACY.call2 }
}
