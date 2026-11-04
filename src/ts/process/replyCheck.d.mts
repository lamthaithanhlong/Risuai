export type ReplyHit = { rule: 'setup' | 'repeat' | 'dialogue' | 'system' | 'lang' | 'scene' | 'tag'; text: string }
export const SETUP: RegExp[]
export function normalize(s: string): string
export function sentencesOf(text: string, minWords?: number): string[]
export function setupHits(text: string): string[]
export function verbatimRepeats(text: string, previousReplies: string[], n?: number): string[]
export function systemLineRepeats(text: string, previousReplies: string[], n?: number): string[]
export function replyHits(text: string, previousReplies: string[]): ReplyHit[]
export function tokens(s: string): string[]
export function scoredSentences(s: string): string[]
export function overlap(a: string, b: string): number
export function speechSentences(r: string): string[]
export function consecutiveRepeat(text: string, previous: string): string | null
export function dialogueRepeats(text: string, previousReplies: string[], n?: number): string[]
export function consecutiveSpeechRepeat(text: string, previous: string): string | null
export const LANG_MIN_WORDS: number
export const LANG_MAX_VIET: number
export const LANG_MIN_FOREIGN: number
export function narrationOf(text: string): string
export function languageDrift(text: string): { n: number; viet: number; foreign: number; drift: boolean }
export function languageHits(text: string): string[]
export function consecutiveSceneRepeat(text: string, previous: string): string | null
export const STAT_KEYS: string[]
export function tagWellFormed(tag: string): boolean
export function malformedTags(text: string): string[]
