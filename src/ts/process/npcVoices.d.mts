export function cardsFromNames(names: string[] | undefined, n?: number): { id: string; name: string }[]
export function namesNamedIn(text: string, names: string[] | undefined): string[]
export function hasAttributedSpeech(text: string, name: string): boolean
export function speakingNamesIn(text: string, names: string[] | undefined): string[]
export function onstageNpcs(ledger: string, n: number, extras?: string[]): { id: string; name: string }[]
export function takeOneQuote(raw: string | null | undefined): string
type Msg = { role?: string; data?: string }
export function recentTalk(messages: Msg[] | undefined, name: string, playerText?: string): string
export function npcVoicePrompt(card: { name: string }, scene: string, talk?: { player?: string; recent?: string }): string
export function rewireOnstageQuotes(text: string, cards: { id: string; name: string }[], ask: (prompt: string) => Promise<string | null>, talk?: { player?: string; history?: Msg[] }): Promise<string>
export function fillNpcVoices(text: string, ledger: string, n: number, ask: (prompt: string) => Promise<string | null>, extras?: string[], playerText?: string, history?: Msg[]): Promise<string>
