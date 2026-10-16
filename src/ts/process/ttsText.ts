// What is said aloud of a reply: the story only (reported 2026-10-16 on the speaker button: it read the whole reply as stored).
// Measured on the newest Shadow Slave reply: besides the story, the voice was given the English picture prompt
// "[[img: A stone granary cellar at night…]]", the 62-line status panel ("str: 3", "agi: 4", "item1: -" …), two English
// "[[LOOK …]]" lines and the emotion emoji; the Vietnamese voice read them as noise, and the panel alone was longer than the
// story. Every way a reply is read aloud (the button, reading new replies, the command) goes through sayTTS, which calls this.

/** Blocks for the machine, not the listener: [[REPLIES]], [[CHECK]], [[LOOK …]], [[STATUS …]], [[img: …]], [[KEEP-n]] …; one
 *  still open at the end (a reply cut while streaming) goes too. */
const MACHINE_BLOCK = /\[\[[\s\S]*?(?:\]\]|$)/g
const INLAY = /\{\{(?:inlay|inlayed|inlayeddata|img|image|asset|path|raw)::[^}]*\}\}/gi
const HTML_TAG = /<\/?[a-z][^>]*>/gi
// pictographs with their joiners and variation selectors (😨, ❤️, 👨‍👩‍👧)
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu
const MARKDOWN = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?=\S))|[*_~`]+/gm

export function speakableText(text: string): string {
    return (text ?? '')
        .replace(MACHINE_BLOCK, '')
        .replace(INLAY, '')
        .replace(HTML_TAG, '')
        .replace(EMOJI, '')
        .replace(MARKDOWN, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}
