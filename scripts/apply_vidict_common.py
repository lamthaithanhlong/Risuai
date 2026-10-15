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


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else 'public/dict'
    common = json.load(open('scripts/vidict_common.json', encoding='utf-8'))
    for lang in ('ja', 'zh', 'ko', 'es', 'fr'):
        path = f'{root}/vi-{lang}.json'
        data = json.load(open(path, encoding='utf-8'))
        apply(data, common.get(lang, {}))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        print(lang, len(common.get(lang, {})), 'hand-listed ->', path)
