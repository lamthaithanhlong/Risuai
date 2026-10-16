#!/usr/bin/env python3
"""Builds the offline Vietnamese → English word list for the learning bar (public/dict/vi-en.json).

English is the pivot the other lists are joined through (build_vidict_pivot.py), so here no join is needed: the English
Wiktionary's Vietnamese entries give each word's English meanings in sense order, the everyday sense first, and those are
the chips. The same hand list (scripts/vidict_common.json, key "en") then puts the conventions first (tôi = I, cô = you,
đừng lo = don't worry), and apply_vidict_common.py adds the verb vote.

Source (downloaded by hand, asked 2026-10-15): kaikki.org-dictionary-Vietnamese.jsonl.gz, English Wiktionary via
wiktextract, CC BY-SA 4.0. The Vietnamese everyday order is the one already in vi-zh.json (it is the Vietnamese side's).

    python3 scripts/build_vidict_en.py --vi kaikki.org-dictionary-Vietnamese.jsonl.gz --out public/dict/vi-en.json \\
        [--words-out en-words.txt]          # every English word the list uses, for build_en_vietji (the readings)
"""
import argparse
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_vidict_pivot import vietnamese  # noqa: E402

MAX_OUT = 4


def english(key: str) -> str:
    """The key as written in English: I, I'm, and nothing else changes."""
    return ' '.join('I' if w == 'i' else "I'm" if w == "i'm" else w for w in key.split(' '))


def build(vi_path: str) -> dict:
    path = vi_path
    if vi_path.endswith('.gz'):                                   # vietnamese() reads a plain file: unpack beside it once
        path = vi_path[:-3]
        if not os.path.exists(path):
            with gzip.open(vi_path, 'rt', encoding='utf-8') as src, open(path, 'w', encoding='utf-8') as dst:
                dst.write(src.read())
    keys = vietnamese(path)
    words, verbs = {}, []
    for w, ks in keys.items():
        out = []
        for k, _pos in ks:
            e = english(k)
            if e not in out:
                out.append(e)
        words[w] = out[:MAX_OUT]
        if ks[0][1] == 'verb':
            verbs.append(w)
    return {'words': dict(sorted(words.items())), 'viVerbs': sorted(verbs)}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--vi', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--order-from', default='public/dict/vi-zh.json')
    ap.add_argument('--words-out')
    ap.add_argument('--order-readings', help='public/dict/en-vietji.json: rewritten most used first, for the sound typing')
    a = ap.parse_args()
    data = build(a.vi)
    data = {'_source': 'English Wiktionary Vietnamese entries (kaikki.org, wiktextract), CC BY-SA 4.0', **data, 'unsure': []}
    if os.path.exists(a.order_from):
        data['order'] = [w for w in json.load(open(a.order_from, encoding='utf-8')).get('order', []) if w in data['words']]
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    if a.words_out:
        seen = sorted({t for picks in data['words'].values() for p in picks for t in p.replace("'", ' ').split() if t.isalpha()})
        open(a.words_out, 'w').write('\n'.join(seen) + '\n')
    print(f"{len(data['words'])} words, {len(data['viVerbs'])} verbs -> {a.out}", file=sys.stderr)
    if a.order_readings:
        # an English word is as used as the most used Vietnamese word it translates (hello for xin chào), its own pick
        # position breaking ties; the sound typing offers the most used word with a sound first (I before eye)
        # ranked on the list as shipped (hand list applied: tôi = I, me; not temper, anneal), first two picks only
        shipped = json.load(open('public/dict/vi-en.json', encoding='utf-8')) if os.path.exists('public/dict/vi-en.json') else data
        order = {w: i for i, w in enumerate(shipped.get('order', []))}
        rank = {}
        for vi, picks in shipped['words'].items():
            for j, p in enumerate(picks[:2]):
                for t in p.lower().split():
                    r = order.get(vi, 50_000) * 4 + j
                    rank[t] = min(rank.get(t, 10**9), r)
        r = json.load(open(a.order_readings, encoding='utf-8'))
        r['words'] = dict(sorted(r['words'].items(), key=lambda kv: (rank.get(kv[0], 10**9), kv[0])))
        r['_order'] = 'most used first: by the everyday order of the Vietnamese words they translate'
        json.dump(r, open(a.order_readings, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        print(f"{len(r['words'])} readings reordered -> {a.order_readings}", file=sys.stderr)
