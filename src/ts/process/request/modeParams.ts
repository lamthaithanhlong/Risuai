/** Header that makes 9router skip its "caveman" compression for one request. */
export const TOKEN_SAVER_OFF: [string, string] = ['header::x-9router-token-saver', 'off']

/**
 * One-time settings migration: chat replies were coming back 3-5x too short (74-138 characters against 213-570 for the
 * same turn) because 9router's compression adds "Respond ultra-terse. Maximum compression. Telegraphic" to the prompt.
 * Add the header that turns it off to the Additional Parameters once. A row with that key already there, whatever its
 * value, is the owner's choice and is kept; once migrated, a row the owner deletes is not added back.
 */
export function migrateTokenSaverOff(params: [string, string][], alreadyMigrated: boolean): { params: [string, string][], migrated: true } {
    const has = params.some(([key]) => key.toLowerCase() === TOKEN_SAVER_OFF[0])
    return { params: alreadyMigrated || has ? params : [...params, TOKEN_SAVER_OFF], migrated: true }
}

/**
 * Extra Additional Parameters that apply to translation requests only, on top of the general ones.
 * - Token saver off: 9router's caveman mode appends "Respond ultra-terse. Strip conjunctions" to the prompt, and the
 *   translator obeyed it (cut-short, half-Korean output, message body missing).
 * - A request model of its own: the chat model thinks for 10-50 s per message, and opening a chat translates ~30.
 * Chat and everything else keep the general settings.
 */
export function modeAdditionalParameters(
    mode: string | undefined,
    forTranslate: [string, string][] | undefined,
    translateModel?: string,
): [string, string][] {
    if (mode !== 'translate') {
        return []
    }
    const params = [...(forTranslate ?? [])]
    const model = translateModel?.trim()
    if (model) {
        params.push(['model', model])
    }
    return params
}
