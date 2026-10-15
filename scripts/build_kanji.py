#!/usr/bin/env python3
"""Builds public/dict/ja-kanji.json: kanji spellings → hiragana, for Japanese the model wrote without [reading] brackets.

From JMdict (EDRDG, CC BY-SA 4.0), common entries only (news1/ichi1/spec1/spec2/gai1). Japanese inflects, so a dictionary
form alone would not match what is written (開けて, 開いた); each entry also gives its stem with okurigana (開け → あけ) and its
kanji part alone (開 → ひら) when the kana it ends with is the end of its reading. Where two entries give the same key, the
more used word wins (wordfreq, build time only).

    python3 scripts/build_kanji.py JMdict_e.gz public/dict/ja-kanji.json
"""
import gzip, json, re, sys
import xml.etree.ElementTree as ET

COMMON = {'news1', 'ichi1', 'spec1', 'spec2', 'gai1'}
KANA = re.compile(r'[ぁ-ゖァ-ヺー]')
HAN = re.compile(r'[一-鿿々〆]')


def kata_to_hira(s):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in s)


def main(src, out):
    from wordfreq import get_frequency_dict
    freq = get_frequency_dict('ja')
    best = {}                                                   # key -> (frequency, reading)

    def offer(key, reading, f):
        if key and reading and HAN.search(key) and (key not in best or f > best[key][0]):
            best[key] = (f, reading)

    with gzip.open(src, 'rb') as fh:
        for _, el in ET.iterparse(fh, events=('end',)):
            if el.tag != 'entry':
                continue
            rebs = [(r.findtext('reb'), {p.text for p in r.findall('re_pri')}, [x.text for x in r.findall('re_restr')], r.find('re_nokanji') is not None) for r in el.findall('r_ele')]
            for k in el.findall('k_ele'):
                keb, kpri = k.findtext('keb'), {p.text for p in k.findall('ke_pri')}
                if not keb or not (kpri & COMMON):
                    continue
                reb = next((r for r, _, restr, nok in rebs if not nok and (not restr or keb in restr)), None)
                if not reb:
                    continue
                reb = kata_to_hira(reb)
                f = freq.get(keb, 0.0) + 1e-9
                offer(keb, reb, f)
                tail = re.search(r'[ぁ-ゖ]+$', keb)
                if tail and reb.endswith(tail.group(0)):
                    t = tail.group(0)
                    if len(t) >= 1 and len(keb) - 1 > 0:
                        offer(keb[:-1], reb[:-1], f * 0.9)                    # 開け → あけ (開ける)
                    offer(keb[:-len(t)], reb[:-len(t)], f * 0.8)              # 開 → ひら (開く)
            el.clear()
    words = {k: r for k, (_, r) in best.items()}
    json.dump({'_source': 'JMdict (EDRDG, CC BY-SA 4.0), common entries, ranked with wordfreq; scripts/build_kanji.py', 'words': words},
              open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(words)} keys -> {out}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
