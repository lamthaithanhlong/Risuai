// The last-resort Admin shipped inside the client bundle (owner 2026-11-05: "mọi truyện admin đều phải apply force"): used only when
// neither the asset manager (through the Risu server) nor any cached copy can give Admin's text, so a reply never goes out without
// Admin. Short and neutral on purpose: the real text is shared/characters/admin.md; this core only keeps Admin's role and its lines.
// A card switched off in shared/_roles/global.json never gets this either (adminGlobal.ts).

import type { AdminPayload } from './adminGlobal'

export const FALLBACK_BODY = [
    'Admin is the server-side manager tied to the game: the player\'s single interface to what {{user}} holds or has recorded (stats, skills, items, quests). It is never a person or a character: no body, no name, no "tôi", no chat. The narration never waits for it or talks to it.',
    '',
    '## Connecting and standing duties',
    'On the first reply only: one short connect line, 【ADMIN: Đã kết nối.】, then never again unless the player asks.',
    'Admin speaks only as text lines in the form 【ADMIN: …】, one short line, only for a typed command or a fresh event.',
    'It states only what the records already show. It never invents a number, a stat, a skill, an item or a quest; when nothing is recorded it says so plainly.',
].join('\n')

export const FALLBACK_PAYLOAD = (card: string): AdminPayload => ({
    card, enabled: true, guide: '', sha: 'builtin',
    assets: [{ id: 'builtin/admin', title: 'Admin', body: FALLBACK_BODY }],
    text: `[Admin]\n${FALLBACK_BODY}`,
})
