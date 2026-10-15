#!/usr/bin/env python3
"""Build-time review of the offline word lists by a model, so the bar rarely has to ask one while the learner types.

The everyday Vietnamese words (ranked by how often they occur in Tatoeba's Vietnamese sentences) that at least one list marks
`unsure` are sent in batches with the list's picks for every language. The model returns the word a learner would say, in the
list's own format (漢字[かな], 汉字[pinyin], hangul, Spanish); every answer is checked for script and format, and an answer that
fails the check is dropped. Batches are stored as they come back (--cache), so a stopped run goes on where it was.

    python3 scripts/vidict_ai_review.py --lists public/dict --sentences vie_sentences.tsv.bz2 \
        --key-file ~/Downloads/shadow-slave-the-dream-realm/assets/gen_images.sh --model cx/gpt-6-sol \
        --top 5000 --cache /tmp/vidict_ai.cache.jsonl --out scripts/vidict_ai.json

The router key is read from the key file and never printed.
"""
import argparse
import bz2
import concurrent.futures as cf
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from collections import Counter

LANGS = ('ja', 'zh', 'ko', 'es')
NAMES = {'ja': 'Japanese', 'zh': 'Chinese (Mandarin, simplified)', 'ko': 'Korean', 'es': 'Spanish'}
FORMAT = {
    'ja': 'kanji with the hiragana reading in square brackets, e.g. 飲む[のむ]; a word written in kana alone has no brackets',
    'zh': 'simplified characters with pinyin in tone marks in square brackets, e.g. 喝[hē], 自行车[zìxíngchē]',
    'ko': 'hangul only, verbs and adjectives in their dictionary form ending in 다, e.g. 마시다',
    'es': 'lower case, verbs in the infinitive, e.g. beber',
}
VALID = {
    'ja': re.compile(r'^(?:[ぁ-ゖァ-ヺー]+|[ぁ-ゖァ-ヺー一-鿿々〆〜]*[一-鿿々〆][ぁ-ゖァ-ヺー一-鿿々〆〜]*\[[ぁ-ゖー]+\])$'),
    'zh': re.compile(r'^[一-鿿]+\[[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+\]$'),
    'ko': re.compile(r'^[가-힣]+(?: [가-힣]+)?$'),
    'es': re.compile(r'^[a-záéíóúñü]+(?: [a-záéíóúñü]+){0,2}$'),
}


def valid(lang: str, text: str) -> bool:
    return isinstance(text, str) and bool(VALID[lang].match(text.strip()))


def everyday_order(words, sentences_bz2: str):
    """The words, most frequent first, by occurrences in Tatoeba's Vietnamese sentences (whole syllables only)."""
    counts = Counter()
    want = set(words)
    longest = max((len(w.split()) for w in want), default=1)
    for line in bz2.open(sentences_bz2, 'rt', encoding='utf-8'):
        parts = line.rstrip('\n').split('\t')
        if len(parts) < 3:
            continue
        syl = re.findall(r'[^\W\d_]+', unicodedata.normalize('NFC', parts[2].lower()))
        for n in range(1, longest + 1):
            for i in range(len(syl) - n + 1):
                g = ' '.join(syl[i:i + n])
                if g in want:
                    counts[g] += 1
    return sorted((w for w in words if counts[w] > 0), key=lambda w: (-counts[w], w)), counts


def prompt(batch, lists):
    lines = []
    for w in batch:
        cands = {l: lists[l]['words'].get(w, []) for l in LANGS}
        lines.append(json.dumps({'vi': w, **cands}, ensure_ascii=False))
    rules = '\n'.join(f'- {l} ({NAMES[l]}): {FORMAT[l]}' for l in LANGS)
    return (
        'You check a Vietnamese learner\'s dictionary. For each Vietnamese word below you get the candidates a word list picked '
        'for four languages. For each language give the word a learner would actually say for the everyday meaning of the '
        'Vietnamese word: the best candidate copied exactly, or a better word if none fits. Give one or two words per '
        'language, best first. Formats:\n' + rules + '\n'
        'Answer with only a JSON object mapping each Vietnamese word to {"ja": [...], "zh": [...], "ko": [...], "es": [...]}.\n\n'
        + '\n'.join(lines)
    )


def call(url, key, model, text, timeout=300):
    body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': text}], 'temperature': 0}).encode()
    req = urllib.request.Request(url, data=body, headers={'content-type': 'application/json', 'authorization': f'Bearer {key}'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)
    return data['choices'][0]['message']['content']


def parse(answer: str):
    m = re.search(r'\{.*\}', answer or '', re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


def clean(result, batch):
    """Only answers for words that were asked, in the right script and format."""
    out, dropped = {}, 0
    for w in batch:
        r = result.get(w) or {}
        for l in LANGS:
            picks = [p.strip() for p in (r.get(l) or []) if isinstance(p, str)]
            good = [p for p in picks if valid(l, p)][:2]
            dropped += len(picks) - len(good)
            if good:
                out.setdefault(w, {})[l] = good
    return out, dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lists', required=True)
    ap.add_argument('--sentences', required=True)
    ap.add_argument('--key-file', required=True)
    ap.add_argument('--url', default='http://127.0.0.1:20128/v1/chat/completions')
    ap.add_argument('--model', required=True)
    ap.add_argument('--top', type=int, default=5000)
    ap.add_argument('--batch', type=int, default=25)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--only', nargs='*', help='review exactly these words (a trial)')
    ap.add_argument('--cache', required=True)
    ap.add_argument('--out')
    a = ap.parse_args()

    key = re.search(r'sk-[A-Za-z0-9_-]+', open(os.path.expanduser(a.key_file)).read()).group(0)
    lists = {l: json.load(open(f'{a.lists}/vi-{l}.json', encoding='utf-8')) for l in LANGS}
    if a.only:
        todo = a.only
    else:
        unsure = set().union(*(set(lists[l]['unsure']) for l in LANGS))
        todo, counts = everyday_order(unsure, a.sentences)
        todo = todo[:a.top]
        print(f'{len(unsure)} words unsure somewhere; reviewing the {len(todo)} most used (last seen {counts[todo[-1]]}x)', file=sys.stderr)

    done = {}
    if os.path.exists(a.cache):
        for line in open(a.cache, encoding='utf-8'):
            done.update(json.loads(line))
    batches = [todo[i:i + a.batch] for i in range(0, len(todo), a.batch)]
    batches = [b for b in batches if not all(w in done for w in b)]
    print(f'{len(batches)} batches to ask ({len(done)} words already answered)', file=sys.stderr)

    def run(batch):
        for attempt in range(3):
            try:
                t = time.time()
                got, dropped = clean(parse(call(a.url, key, a.model, prompt(batch, lists))), batch)
                return batch, got, dropped, time.time() - t
            except Exception as e:  # network, quota, bad JSON: wait and try again, then give up on this batch
                err = e
                time.sleep(5 * (attempt + 1))
        return batch, None, 0, str(err)

    with cf.ThreadPoolExecutor(a.workers) as ex, open(a.cache, 'a', encoding='utf-8') as cache:
        for n, (batch, got, dropped, info) in enumerate(ex.map(run, batches), 1):
            if got is None:
                print(f'[{n}/{len(batches)}] failed: {info}', file=sys.stderr)
                continue
            cache.write(json.dumps({w: got.get(w, {}) for w in batch}, ensure_ascii=False) + '\n'); cache.flush()
            done.update({w: got.get(w, {}) for w in batch})
            print(f'[{n}/{len(batches)}] {len(got)}/{len(batch)} words, {dropped} answers dropped by the format check, {info:.0f}s', file=sys.stderr)

    if a.out:
        by_lang = {l: {w: r[l] for w, r in sorted(done.items()) if r.get(l)} for l in LANGS}
        json.dump({'_source': f'model review ({a.model}) of the unsure picks, format-checked; see scripts/vidict_ai_review.py',
                   **by_lang}, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(f'wrote {a.out}: ' + ', '.join(f'{l} {len(by_lang[l])}' for l in LANGS), file=sys.stderr)


if __name__ == '__main__':
    main()
