/**
 * A cached translation is only usable when it has text. The translating model sometimes answers with nothing
 * (a reasoning model spends its whole budget thinking); caching that would show a blank message on that device
 * for good, so an empty answer counts as "not translated yet" and the original text is shown instead.
 */
export function isUsableTranslation(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== ''
}
