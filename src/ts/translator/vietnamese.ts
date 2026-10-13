const VIETNAMESE_LETTERS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/gi
const CJK_LETTERS = /[぀-ヿ一-鿿가-힣]/g
const ANY_LETTER = /[^\W\d_]/gu

/**
 * True when the text is already Vietnamese, so translating it to Vietnamese would only spend a model call
 * (measured 13-43 s on a reasoning model for a 20-character sentence) to get the same words back.
 * Vietnamese prose is 23-35% letters that only Vietnamese has (ă â đ ê ô ơ ư and tone marks); English has none.
 * Markup is ignored; text with Korean/Japanese/Chinese in it is left to be translated.
 */
export function looksVietnamese(text: string): boolean {
    const plain = text
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<Thoughts>[\s\S]*?<\/Thoughts>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
    const letters = plain.match(ANY_LETTER)?.length ?? 0
    if (letters < 6) {
        return false
    }
    const cjk = plain.match(CJK_LETTERS)?.length ?? 0
    const vietnamese = plain.match(VIETNAMESE_LETTERS)?.length ?? 0
    return cjk / letters < 0.1 && vietnamese / letters >= 0.15
}
