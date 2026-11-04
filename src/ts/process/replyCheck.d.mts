export type ReplyHit = { rule: 'setup' | 'repeat' | 'system'; text: string }
export const SETUP: RegExp[]
export function normalize(s: string): string
export function sentencesOf(text: string, minWords?: number): string[]
export function setupHits(text: string): string[]
export function verbatimRepeats(text: string, previousReplies: string[], n?: number): string[]
export function systemLineRepeats(text: string, previousReplies: string[], n?: number): string[]
export function replyHits(text: string, previousReplies: string[]): ReplyHit[]
