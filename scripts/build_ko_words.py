#!/usr/bin/env python3
"""Builds public/dict/ko-words.json: the most used Korean words (hangul), most used first, for the bar's sound typing
(vietjiIme.ts reads each into Việt-ji on the page with the same reader the chat uses). From wordfreq (Apache-2.0), build time.

    python3 scripts/build_ko_words.py public/dict/ko-words.json [30000]
"""
import json, re, sys
from wordfreq import get_frequency_dict

out, top = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 30000
freq = get_frequency_dict('ko')
words = [w for w, _ in sorted(freq.items(), key=lambda x: -x[1]) if re.fullmatch(r'[가-힣]{1,6}', w)][:top]
json.dump({'_source': 'wordfreq (Apache-2.0), Korean; scripts/build_ko_words.py', 'words': words}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'{len(words)} words -> {out}')
