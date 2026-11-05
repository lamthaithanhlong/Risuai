export type NpcCard = { id: string; name: string; self: string; toPlayer: string; age: string; isAdmin: boolean; needs: Set<string>; has: Map<string, number>; received: Set<string>; knows: Set<string>; want: string; trust: number; promises: Set<string>; why: Set<string>; lastTurn: number }
export type NpcFacts = { requests: Set<string>; offers: Set<string>; refusals: Set<string>; handed: Set<string>; questHook: boolean; exposition: boolean; playerAskedWhy: boolean; reasonFlag: boolean; sentences: number; unaddressed: boolean }
export type NpcHit = { rule: string; text: string; npc: string; why?: string; soft?: boolean }
export type NpcOp = { id: string; op: string; value: string }
export const ITEM_LEX: [string, string, RegExp][]
export const MAX_SENTENCES: number
export const LOW_TRUST: number
export const NPC_OPS: string[]
export const CUT_RULES: string[]
export const HARD_RULES: string[]
export function itemLabel(id: string): string
export function itemsIn(text: string, last?: string): string[]
export function accept(s: Pick<NpcCard, 'isAdmin' | 'needs' | 'has' | 'trust' | 'received'>, f: NpcFacts): { rule: string; clause: number; items?: string[]; n?: number }[]
export function stepNpc<T extends Pick<NpcCard, 'needs' | 'has' | 'trust' | 'received'>>(s: T, f: Pick<NpcFacts, 'handed' | 'requests'>, given?: Set<string>, dTrust?: number): T
export function blankNpc(id: string, name?: string): NpcCard
export function applyNpcOp(c: NpcCard, op: string, value: string, n: number): boolean
export function parseNpcLine(line: string): { n: number; id: string; op: string; value: string } | null
export function foldNpc(ledger: string, beforeN?: number): Map<string, NpcCard>
export function appendNpcLines(ledger: string, n: number, ops: NpcOp[], max?: number): { ledger: string; added: number }
export function npcOpsOf(bodies: string[]): NpcOp[]
export function cardLine(c: NpcCard): string
export function npcCardsNote(ledger: string, n: number): string
export function npcLines(reply: string, opts?: { player?: string }): { line: string; para: string; at: number }[]
export function sentencesOfLine(line: string): string[]
export function extractFacts(reply: string, cards: Map<string, NpcCard>, ctx?: { player?: string; playerText?: string; lastItem?: string }): Map<string, { card: NpcCard | null; lines: string[]; facts: NpcFacts }>
export function grammarHits(line: string): { rule: string; why?: string; soft?: boolean }[]
export function npcHits(reply: string, ctx?: { ledger?: string; n?: number; player?: string; playerText?: string }): NpcHit[]
export function npcRewriteNote(hits: NpcHit[], ledger?: string, n?: number): string
export function cutViolations(reply: string, hits: NpcHit[]): { text: string; cut: string[] }
