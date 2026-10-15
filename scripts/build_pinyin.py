#!/usr/bin/env python3
"""Builds public/dict/zh-pinyin.json: Chinese words → pinyin, for text the model wrote without [pinyin] brackets.

From CC-CEDICT (CC BY-SA 4.0): the most used words (wordfreq, build time only) up to four characters, plus every single
character, each with one reading. A character with several readings keeps the reading of its fullest everyday entry (not a
surname, not "variant of", most meanings): 了 → le, 行 → xíng. Words carry their own reading, so 银行 is yínháng.

    python3 scripts/build_pinyin.py cedict_1_0_ts_utf-8_mdbg.txt.gz public/dict/zh-pinyin.json [words=30000]
"""
import gzip, json, re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from build_vidict_pivot import tone_mark

SKIP = re.compile(r'^(surname|variant of|old variant|used in|see |abbr\.|archaic|\(archaic|\(old\)|erhua variant)', re.I)


def main(src, out, top=30000):
    from wordfreq import get_frequency_dict
    freq = get_frequency_dict('zh')
    best = {}                                                # word -> (score, pinyin)
    for line in gzip.open(src, 'rt', encoding='utf-8'):
        m = re.match(r'(\S+) (\S+) \[([^\]]+)\] /(.*)/\s*$', line)
        if not m or line.startswith('#'):
            continue
        simp, pin, gl = m.group(2), m.group(3), [g for g in m.group(4).split('/') if g and not g.startswith('CL:')]
        if len(simp) > 4 or not re.fullmatch(r'[一-鿿]+', simp) or pin[:1].isupper():
            continue
        useful = [g for g in gl if not SKIP.match(g)]
        score = len(useful) - (5 if not useful else 0)
        if simp not in best or score > best[simp][0]:
            best[simp] = (score, ''.join(tone_mark(p) for p in pin.split()))
    words = sorted((w for w in best if len(w) > 1), key=lambda w: -freq.get(w, 0))[:top]
    keep = {w: best[w][1] for w in words if freq.get(w, 0) > 0}
    keep.update({w: p for w, (_, p) in best.items() if len(w) == 1})
    json.dump({'_source': 'CC-CEDICT (CC BY-SA 4.0), ranked with wordfreq; scripts/build_pinyin.py', 'words': keep},
              open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(keep)} entries -> {out}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 30000)
