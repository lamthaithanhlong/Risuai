// Natural Vietnamese prose for stories told in Vietnamese (reported 2026-10-16 on the opening of a new Shadow Slave chat:
// "Một phụ nữ…", "Bà khoảng bốn mươi tuổi" then "Người phụ nữ", a spoken line with only an emoji before it, "có người đập"
// when the next line says it is not a person, and a rice pile under feet that stood on stone).
//
// The model follows a reminder at the end of the player's message, not a system note (measured for the learning note and
// the portraits). Measured 2026-10-16 with the story model, 2 scenes (the opening, and its next turn) x 6 replies each,
// counted by regex (calque, a spoken line with no speaker) and by gpt-6-sol on a rubric (pronoun, POV, place):
//   no reminder        speakerless 18  pronoun 13  "một phụ nữ" 1
//   first reminder     speakerless 2-4 pronoun 5-11, but POV 2 -> 4-7: "ai đó" still says it is a person, and the emoji
//                      after the name split subject from verb ("Người phụ nữ 😨 thì thào")
//   the emoji rule rewritten in the module instead: worse on pronoun and place (9, 5), so the module is left as it is
//   this reminder      speakerless 0 (the 3-4 left had been the player's own lines), POV 1-2, place 0-1, no calque;
//                      pronoun faults only where the earlier reply already said "bà", now switched to "chị" without "Bà… chị"
export function viProseReminder(player = 'nhân vật chính'): string {
    return '\n\n[Viết văn tiếng Việt tự nhiên như tiểu thuyết dịch tốt: "một người phụ nữ" (không viết "một phụ nữ"); xưng hô theo tuổi'
        + ' so với nhân vật chính, tính bằng số: hơn dưới 15 tuổi là chị/anh (người 40 tuổi với người 25 tuổi là chị hoặc cô, không phải'
        + ' bà), hơn 15–30 tuổi là cô/chú, từ khoảng 60 tuổi là bà/ông; nếu đoạn trước gọi sai thì từ đây gọi thẳng cách đúng, không viết'
        + ` cả hai (không "Bà… chị"); mỗi câu thoại một dòng, kể cả lời nhân vật chính (${player} hỏi: “…”), mở bằng emoji cảm xúc (nếu có)`
        + ' rồi tên hoặc cách gọi người nói và động từ, rồi lời: 😨 Người phụ nữ thì thào: “…”; lời kể chỉ nói điều nhân vật chính thấy,'
        + ' nghe, biết: chưa rõ nguồn thì tả cái nghe thấy ("tiếng gõ", "một giọng gọi"), không khẳng định "có người" hay "ai đó"; giữ đúng'
        + ' chỗ đứng và đồ vật đã kể.]'
}

const VI_LETTERS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủứừửữựỳỷỹỵ]/gi

/** True when the story's latest reply (or its first message) is written in Vietnamese. */
export function storyInVietnamese(messages: { role: string; data: string }[], firstMessage = ''): boolean {
    const last = [...messages].reverse().find((m) => m.role === 'char')?.data ?? firstMessage
    const text = (last ?? '').replace(/\[\[[\s\S]*?\]\]/g, '').slice(0, 3000)
    const letters = (text.match(/\p{L}/gu) ?? []).length
    return letters > 80 && (text.match(VI_LETTERS) ?? []).length / letters > 0.05
}

/** The reminder put at the end of the last user message, when on and the story is in Vietnamese. */
export function viProseRequest<T extends { role: string; content: unknown }>(formated: T[], on: boolean, inVietnamese: boolean, player?: string): T[] {
    if (!on || !inVietnamese) return formated
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + viProseReminder(player || undefined) } : m))
}
