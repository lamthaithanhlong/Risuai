"""Put the hand list (vidict_common.json) first in the built word lists, without rebuilding them from their sources.

The same merge as build_vidict_pivot.py --common (and COMMON in build_vidict.py): the hand-listed words first, then the
list's own picks that are not the same word, at most MAX_OUT, and a hand-listed word is never "unsure". Running it twice
changes nothing. Usage: python3 scripts/apply_vidict_common.py [public/dict]
"""
import json
import re
import sys

MAX_OUT = 4
bare = lambda s: re.sub(r'\[[^\]]*\]', '', s)


def apply(data: dict, hand: dict) -> dict:
    words = data['words']
    for w, g in hand.items():
        words[w] = (g + [x for x in words.get(w, []) if bare(x) not in {bare(y) for y in g}])[:MAX_OUT]
    data['words'] = dict(sorted(words.items()))
    if 'unsure' in data:
        data['unsure'] = sorted(set(data['unsure']) - set(hand))
    return data


# Which Vietnamese words are verbs, for "<verb> đi" = an order (vietjiImperative.ts). No list has parts of speech, so the five
# vote: a Korean -다 word (not 이다/있다/없다), a Japanese word ending in an u-row kana, a Spanish or French infinitive. Two
# votes make a verb; the Vietnamese function words never are (có, là, sẽ… gave あってください, でしてください, 겠으세요).
NOT_VERBS = set('''qua sang tới là có không chưa đã sẽ đang được bị phải nên cần muốn thể hãy đừng rồi cũng vẫn còn mới vừa sắp thì mà và với của
cho ở tại từ như rất lắm quá nữa thôi nhé à ạ vậy thế nhiều ít các những mọi mỗi cái con người một hai ba ấy này đó kia nào gì ai đâu
bao sao nhưng nếu vì nên hay hoặc thật lúc khi biết thấy'''.split())
KO_NOT = {'이다', '있다', '없다', '아니다'}
# the direction verbs the vote misses (về đi = go home)
HAND_VERBS = {'về', 'vào', 'ra', 'lên', 'xuống', 'đến'}   # not qua/lại/sang: there they are mostly 'through', 'again'


def is_verb_vote(lang: str, entry: str) -> bool:
    w = bare(entry).strip()
    if lang == 'ko':
        return w.endswith('다') and w not in KO_NOT and len(w) >= 2
    if lang == 'ja':
        return bool(re.search(r'[うくぐすつぬぶむる]$', w))
    if lang == 'es':
        return bool(re.fullmatch(r'[a-zñáéíóú]*(ar|er|ir)(se)?', w))
    if lang == 'fr':
        return bool(re.fullmatch(r'((se |s[’\'])?)[a-zàâçéèêëîïôûùüÿœ]+(er|ir|re)', w))
    return False


def verbs_of(all_words: dict, en_verbs: set = frozenset()) -> list:
    out = []
    for vi in set().union(*[set(w) for w in all_words.values()]):
        if vi in NOT_VERBS or ' ' in vi and vi.split()[0] in NOT_VERBS:
            continue
        votes = sum(1 for lang, words in all_words.items() if words.get(vi) and is_verb_vote(lang, words[vi][0])) + (vi in en_verbs)
        if votes >= 2:
            out.append(vi)
    return sorted(set(out) | {v for v in HAND_VERBS if any(v in w for w in all_words.values())})


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else 'public/dict'
    common = json.load(open('scripts/vidict_common.json', encoding='utf-8'))
    datas = {}
    for lang in ('ja', 'zh', 'ko', 'es', 'fr', 'en'):
        datas[lang] = apply(json.load(open(f'{root}/vi-{lang}.json', encoding='utf-8')), common.get(lang, {}))
    # English carries no verb ending to vote with: its list says which Vietnamese words are verbs (their first sense)
    en_verbs = set(datas['en'].get('viVerbs', []))
    verbs = verbs_of({l: d['words'] for l, d in datas.items() if l != 'en'}, en_verbs)
    print(len(verbs), 'Vietnamese verbs')
    for lang, data in datas.items():
        path = f'{root}/vi-{lang}.json'
        data['verbs'] = verbs
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        print(lang, len(common.get(lang, {})), 'hand-listed ->', path)
