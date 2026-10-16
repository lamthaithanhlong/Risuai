// Natural Vietnamese prose for stories told in Vietnamese (reported 2026-10-16 on the opening of a new Shadow Slave chat:
// "Một phụ nữ…", "Bà khoảng bốn mươi tuổi" then "Người phụ nữ", a spoken line with only an emoji before it, "có người đập"
// when the next line says it is not a person, and a rice pile under feet that stood on stone).
//
// The model follows a reminder at the end of the player's message, not a system note (measured for the learning note and
// the portraits). On that opening, with the story model: without this reminder 2 of 2 replies had a spoken line with no
// speaker; with it, 2 of 2 named the speaker ("Người gác 😠: “Giấy của cậu đâu?”") and the narration said "một người",
// not who it was.

export const VI_PROSE_REMINDER = '\n\n[Viết văn tiếng Việt tự nhiên như tiểu thuyết dịch tốt: "một người phụ nữ" (không viết "một phụ nữ"); xưng hô theo tuổi'
    + ' so với nhân vật chính (lớn hơn chút: chị/anh; tuổi cha mẹ: cô/chú/bác; già: bà/ông) và giữ một cách gọi cho một người; mọi câu thoại'
    + ' có tên hoặc cách gọi người nói đứng trước (Người phụ nữ thì thào: “…”), emoji cảm xúc nếu có thì đặt sau tên; lời kể chỉ nói điều'
    + ' nhân vật chính biết được (chưa rõ là ai thì "ai đó", không "có người"); giữ đúng chỗ đứng và đồ vật đã kể.]'

const VI_LETTERS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủứừửữựỳỷỹỵ]/gi

/** True when the story's latest reply (or its first message) is written in Vietnamese. */
export function storyInVietnamese(messages: { role: string; data: string }[], firstMessage = ''): boolean {
    const last = [...messages].reverse().find((m) => m.role === 'char')?.data ?? firstMessage
    const text = (last ?? '').replace(/\[\[[\s\S]*?\]\]/g, '').slice(0, 3000)
    const letters = (text.match(/\p{L}/gu) ?? []).length
    return letters > 80 && (text.match(VI_LETTERS) ?? []).length / letters > 0.05
}

/** The reminder put at the end of the last user message, when on and the story is in Vietnamese. */
export function viProseRequest<T extends { role: string; content: unknown }>(formated: T[], on: boolean, inVietnamese: boolean): T[] {
    if (!on || !inVietnamese) return formated
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + VI_PROSE_REMINDER } : m))
}
