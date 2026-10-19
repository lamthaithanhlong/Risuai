// The three story cards and what the acceptance playtest types into each, the way the owner plays: Vietnamese turns, a mix of
// pauses (rest, walk, a day passing), ordinary actions, one impossible/dictated action, talking to someone, danger, travel.
// Turns are written to fit any opening the model may roll (they never name a person or place the story has not shown).
//
// kind: pause | action | impossible | npc | danger | travel | side | side-life. A pause is where the card's fate dice may surface a
// new event. `side` is the turn where the player commits to a side of the canon world (gameMaster.ts gm_path) and `sideLife` the
// three turns of living with it; run.mjs plays them after the first 10 turns (planOf below).

import os from 'os'
import path from 'path'

const home = os.homedir()

export const STORIES = {
    ss: {
        key: 'ss',
        side: { kind: 'side', text: 'Tôi quyết định rồi: tôi sẽ tìm mọi cách gia nhập nhóm của Nephis (Ngôi Sao Đổi Thay) và đi theo cô ấy, dù phải bắt đầu từ việc nhỏ nhất.', match: /Nephis|Ngôi Sao Đổi Thay|Changing Star|nhóm|đội/i },
        sideLife: ['Tôi làm việc được giao trong nhóm, cố cho mọi người thấy mình có ích.', 'Tôi hỏi một người trong nhóm về luật lệ và việc sắp tới của cả nhóm.', 'Một ngày trôi qua trong nhóm; tôi đi cùng mọi người và làm theo quy củ của họ.'].map((text) => ({ kind: 'side-life', text })),
        title: 'Shadow Slave',
        cardId: '04103f68-46fc-4384-8d2f-04781a0a4d27',
        nameMatch: 'Shadow Slave',
        src: path.join(home, 'Downloads/shadow-slave-the-dream-realm/fate-simulator'),
        // the in-world voice: the Nightmare Spell speaks in bracket lines, addressing the character as "Ngươi"
        voice: { name: 'Nightmare Spell', bracketLines: true, unbracketed: /^\s*(?:\*|_)?\s*Ngươi (?:đã giết|đã nhận|đã thức tỉnh|đã được)/m },
        stepAnswers: ['Lấy gợi ý đầu tiên.', 'Để thế giới chọn.', 'Lấy gợi ý thứ hai.'],
        lookAnswer: 'Giữ ngoại hình của persona.',
        turns: [
            { kind: 'action', text: 'Tôi nhìn quanh, cố hiểu mình đang ở đâu và nhớ lại chuyện vừa xảy ra.' },
            { kind: 'npc', text: 'Tôi hỏi người gần nhất xem đây là đâu và chuyện gì đang xảy ra.' },
            { kind: 'action', text: 'Tôi kiểm tra trên người mình có gì: quần áo, túi, vết thương.' },
            { kind: 'pause', text: 'Tôi tìm một góc khuất ngồi nghỉ một lúc, thở đều lại.' },
            { kind: 'action', text: 'Tôi lặng lẽ quan sát những người xung quanh, ghi nhớ ai có vũ khí, ai đang sợ.' },
            { kind: 'impossible', text: 'Tôi giơ tay gọi ra một thanh kiếm thần rực lửa, chém một nhát giết sạch mọi kẻ thù quanh đây, rồi Spell ban cho tôi True Name và nâng tôi lên Awakened ngay lập tức.' },
            { kind: 'npc', text: 'Tôi bắt chuyện với người trông bình tĩnh nhất, hỏi tên và họ định làm gì tiếp.' },
            { kind: 'travel', text: 'Tôi đi theo con đường chính ra khỏi chỗ này, vừa đi vừa để ý xung quanh.' },
            { kind: 'pause', text: 'Tôi đi bộ chậm rãi một quãng dài, không vội, để cơ thể quen dần.' },
            { kind: 'danger', text: 'Có gì đó không ổn. Tôi nấp xuống và nhặt một hòn đá hoặc cây gậy gần nhất để phòng thân.' },
            { kind: 'danger', text: 'Nếu nó lao tới, tôi né sang bên, đánh vào chỗ yếu nhất của nó rồi lùi lại giữ khoảng cách.' },
            { kind: 'action', text: 'Tôi kiểm tra lại vết thương và băng bó bằng thứ gì có sẵn.' },
            { kind: 'pause', text: 'Tôi tìm chỗ an toàn ngủ qua đêm. Một ngày trôi qua.' },
            { kind: 'npc', text: 'Sáng ra, tôi tìm người đã gặp hôm qua và hỏi họ có nghe tin gì mới không.' },
            { kind: 'action', text: 'Tôi tìm thức ăn và nước uống quanh đó.' },
            { kind: 'travel', text: 'Tôi lên đường tới nơi đông người nhất gần đây, hy vọng nghe được tin tức.' },
            { kind: 'pause', text: 'Tới nơi, tôi ngồi xuống nghỉ chân và nghe ngóng người ta nói chuyện.' },
            { kind: 'npc', text: 'Tôi hỏi thăm về những chuyện lạ gần đây, giả vờ như chỉ tò mò.' },
            { kind: 'danger', text: 'Tôi lần theo dấu vết lạ vừa nghe được, cẩn thận từng bước.' },
            { kind: 'pause', text: 'Mấy ngày sau tôi sống lặng lẽ: làm việc kiếm ăn ban ngày, tối rèn luyện cơ thể.' },
        ],
    },
    lotm: {
        key: 'lotm',
        side: { kind: 'side', text: 'Tôi quyết định rồi: tôi sẽ nộp đơn xin gia nhập Kẻ Gác Đêm (Nighthawks) của Giáo hội Nữ Thần Đêm Tối ở thành phố này.', match: /Gác Đêm|Nighthawk|Nữ Thần Đêm Tối|Giáo hội|Evernight/i },
        sideLife: ['Tôi làm theo thủ tục và yêu cầu mà bên đó đặt ra cho người mới.', 'Tôi hỏi người phụ trách về công việc đầu tiên của mình.', 'Một tuần trôi qua: tôi đi làm ở chỗ mới, học quy củ và giữ mồm giữ miệng.'].map((text) => ({ kind: 'side-life', text })),
        title: 'Lord of the Mysteries',
        cardId: '22a987d8-4a13-4185-b24a-0308be8502fd',
        nameMatch: 'Lord of the Mysteries',
        // creation item with two values by the card's rules (main_description.md: Way in: BORN HERE or TRANSMIGRATOR)
        binaryItem: 'xuyên không|transmigr',
        src: path.join(home, 'Downloads/lord-of-the-mystery/fate-simulator'),
        // no status window and no system: the supernatural is costly, not a game (main_description.md)
        voice: { name: null, bracketLines: false, unbracketed: null },
        stepAnswers: ['Lấy gợi ý đầu tiên.', 'Để thế giới chọn.', 'Lấy gợi ý thứ hai.'],
        lookAnswer: 'Giữ ngoại hình của persona.',
        turns: [
            { kind: 'action', text: 'Tôi nhìn quanh căn phòng, cố nhớ lại mình là ai và hôm nay là ngày nào.' },
            { kind: 'action', text: 'Tôi kiểm tra túi áo và ví: còn bao nhiêu tiền, có giấy tờ gì.' },
            { kind: 'npc', text: 'Tôi hỏi người gần nhất xem có tin tức gì lạ trong thành phố mấy hôm nay.' },
            { kind: 'pause', text: 'Tôi pha một tách trà, ngồi bên cửa sổ nghỉ một lúc nhìn sương mù ngoài phố.' },
            { kind: 'travel', text: 'Tôi khoác áo, đi bộ ra phố tới tiệm báo gần nhất mua một tờ báo sáng.' },
            { kind: 'action', text: 'Tôi đọc lướt tờ báo, tìm những mẩu tin về án mạng hay chuyện kỳ quái.' },
            { kind: 'impossible', text: 'Tôi uống liền ba lọ ma dược mua ở chợ, lập tức lên Danh Sách 5, rồi Thần Bí Chi Chủ hiện ra nhận tôi làm quyến thuộc và Klein Moretti quỳ xuống xin theo tôi.' },
            { kind: 'npc', text: 'Tôi bắt chuyện với ông chủ quán quen, hỏi ông có biết ai chuyên mua bán đồ cổ lạ không.' },
            { kind: 'pause', text: 'Tôi đi dạo dọc bờ sông một quãng, để đầu óc thư thả.' },
            { kind: 'action', text: 'Tôi ghé thư viện công cộng, tìm sách về các giáo hội và lịch sử thành phố.' },
            { kind: 'danger', text: 'Trên đường về tôi cảm giác có người bám theo. Tôi rẽ vào con hẻm đông người để cắt đuôi.' },
            { kind: 'danger', text: 'Nếu kẻ đó ra tay, tôi chạy về phía có cảnh sát tuần tra và hô lớn.' },
            { kind: 'pause', text: 'Về tới nhà, tôi khóa cửa, ăn tối rồi đi ngủ. Một ngày trôi qua.' },
            { kind: 'action', text: 'Sáng hôm sau tôi đi làm như thường lệ, cố giữ mọi thứ bình thường.' },
            { kind: 'npc', text: 'Giờ nghỉ trưa, tôi hỏi đồng nghiệp xem họ có nghe chuyện gì kỳ lạ không.' },
            { kind: 'travel', text: 'Cuối tuần tôi bắt xe ngựa công cộng sang khu chợ phía đông.' },
            { kind: 'pause', text: 'Tới khu chợ, tôi ngồi ở một quán cà phê nhỏ nghỉ chân, nghe người ta bàn tán.' },
            { kind: 'npc', text: 'Tôi hỏi khéo người bán hàng về những món đồ khác thường được bày bán gần đây.' },
            { kind: 'danger', text: 'Tôi đi theo lời đồn tới một căn nhà bỏ hoang, đứng quan sát từ xa trước khi lại gần.' },
            { kind: 'pause', text: 'Một tuần trôi qua: tôi sống lặng lẽ, đi làm, tối về ghi chép lại những gì đã thấy.' },
        ],
    },
    mailman: {
        key: 'mailman',
        side: { kind: 'side', text: 'Tôi quyết định rồi: tôi không gia nhập đoàn nào cả, tôi sẽ đi một mình và tự gây dựng tên tuổi bằng những lá thư mình giao.', match: /một mình|tên tuổi|không gia nhập|độc hành|tự mình/i },
        sideLife: ['Tôi nhận lá thư tiếp theo một mình, chuẩn bị kỹ trước khi đi.', 'Tôi từ chối lời mời của người khác muốn kéo tôi vào nhóm, lịch sự nhưng dứt khoát.', 'Mấy ngày trôi qua: tôi giao thư một mình, ghi chép lại từng chuyến để rút kinh nghiệm.'].map((text) => ({ kind: 'side-life', text })),
        title: 'Infinite Mailman',
        // the starting point has two values (NEW, SURVIVOR) and the card offers both
        binaryItem: 'Sống sót|SURVIVOR',
        cardId: 'aa7f021d-b690-4f02-8e64-9e28aa0aff01',
        nameMatch: 'Infinite Mailman',
        src: path.join(home, 'Downloads/nguoi-dua-thu-khung-bo/fate-simulator'),
        // the Post Office speaks in cold prompts in brackets (main_description.md: "cold prompts in brackets")
        voice: { name: 'Post Office', bracketLines: true, unbracketed: null },
        stepAnswers: ['Lấy gợi ý đầu tiên.', 'Để thế giới chọn.', 'Lấy gợi ý thứ hai.'],
        lookAnswer: 'Giữ ngoại hình của persona.',
        turns: [
            { kind: 'action', text: 'Tôi nhìn kỹ cái hộp, lật qua lật lại xem có dấu hiệu hay chữ viết gì không.' },
            { kind: 'action', text: 'Tôi kiểm tra điện thoại, cửa sổ, cửa chính: mọi thứ trong nhà có gì khác thường không.' },
            { kind: 'pause', text: 'Tôi ngồi xuống ghế, uống một cốc nước, nghỉ một lúc nghe tiếng mưa.' },
            { kind: 'npc', text: 'Tôi gọi điện cho người thân quen nhất, hỏi họ tối nay có gặp chuyện gì lạ không.' },
            { kind: 'action', text: 'Tôi làm theo lời nhắc, cẩn thận, không làm gì thừa.' },
            { kind: 'impossible', text: 'Tôi dùng tay không đấm nát con quái vật chỉ bằng một cú, rồi Bưu Cục thưởng tôi một nghìn điểm bưu phí và mười con tem hiếm ngay lập tức.' },
            { kind: 'danger', text: 'Tôi lùi vào góc tường, nắm chặt thứ gì cứng nhất trong tầm tay để tự vệ.' },
            { kind: 'danger', text: 'Nếu nó áp sát, tôi ném đồ vào mặt nó rồi chạy về phía cửa.' },
            { kind: 'npc', text: 'Tôi hỏi người đang ở gần mình xem họ có biết chuyện gì đang xảy ra không.' },
            { kind: 'travel', text: 'Tôi rời khỏi chỗ này, đi theo hướng mà lời nhắc chỉ.' },
            { kind: 'pause', text: 'Tôi đi bộ một quãng, giữ nhịp thở, để ý từng âm thanh xung quanh.' },
            { kind: 'action', text: 'Tôi tìm một chỗ trú tạm và kiểm tra lại những gì mình đang mang theo.' },
            { kind: 'pause', text: 'Tôi tìm chỗ kín đáo chợp mắt một lát cho lại sức.' },
            { kind: 'npc', text: 'Tôi bắt chuyện với người trông đáng tin nhất, hỏi tên và họ đã ở đây bao lâu.' },
            { kind: 'action', text: 'Tôi quan sát quy luật của nơi này, ghi nhớ những gì quái vật làm và không làm.' },
            { kind: 'travel', text: 'Tôi đi tới nơi cần giao thư, chọn đường vòng tránh chỗ tối.' },
            { kind: 'danger', text: 'Tôi chờ đúng lúc, lách qua chỗ nguy hiểm thật nhanh và thật khẽ.' },
            { kind: 'pause', text: 'Xong việc, tôi về nhà, tắm rửa, ăn tối rồi ngủ. Một ngày trôi qua.' },
            { kind: 'npc', text: 'Sáng hôm sau tôi gặp lại người quen, kể khéo vài chuyện và nghe xem họ nói gì.' },
            { kind: 'pause', text: 'Mấy ngày sau trôi qua yên ổn: tôi đi làm, tối về tập thể lực và ghi chép.' },
        ],
    },
}

export const STORY_KEYS = Object.keys(STORIES)

/** The story turns of one run: the first 10 base turns, the side and three turns living with it, then base turns up to `n`. */
export function planOf(story, n = 20) {
    const head = story.turns.slice(0, 10)
    const side = story.side ? [story.side, ...story.sideLife] : []
    const rest = story.turns.slice(10, Math.max(10, n - side.length))
    return [...head, ...side, ...rest].slice(0, Math.max(n, head.length + side.length))
}
