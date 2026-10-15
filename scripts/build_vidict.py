#!/usr/bin/env python3
"""Builds the offline Vietnamese → French word list for the learning bar (public/dict/vi-fr.json).

Source: the Vietnamese entries of the French Wiktionary, as extracted by wiktextract (kaikki.org,
kaikki.org-dictionary-Vietnamien.jsonl), CC BY-SA 4.0. Each word keeps up to four short French
glosses, everyday senses first; Han characters and proper names are left out.

    python3 scripts/build_vidict.py kaikki.org-dictionary-Vietnamien.jsonl public/dict/vi-fr.json [vie_sentences.tsv.bz2]
"""
import json
import re
import sys

# the most used words, where the Wiktionary order puts a rare sense first ("tôi" = servant before je)
COMMON = {
    'tôi': ['je', 'moi'], 'bạn': ['tu', 'vous', 'ami'], 'anh': ['tu', 'vous', 'grand frère'], 'em': ['tu', 'petit frère'],
    'chị': ['tu', 'vous', 'grande sœur'], 'nó': ['il', 'elle'], 'chúng tôi': ['nous'], 'họ': ['ils', 'elles'],
    # kin words are "you" when spoken to (cô gave tante paternelle; mày gave sourcils, tớ valet, mình corps)
    'cô': ['vous', 'tu', 'tante'], 'ông': ['vous', 'grand-père'], 'bà': ['vous', 'grand-mère'], 'chú': ['vous', 'oncle'],
    'bác': ['vous', 'oncle'], 'cậu': ['tu'], 'cháu': ['je'], 'con': ['je', 'enfant'], 'mày': ['tu', 'toi'], 'tao': ['je', 'moi'],
    'tớ': ['je', 'moi'], 'mình': ['je', 'nous'], 'cô ấy': ['elle'], 'chị ấy': ['elle'], 'bà ấy': ['elle'], 'anh ấy': ['il'],
    'ông ấy': ['il'], 'chúng ta': ['nous'],
    'có': ['avoir', 'il y a', 'oui'], 'không': ['non', 'ne... pas'], 'vâng': ['oui'], 'dạ': ['oui'],
    'ở đâu': ['où'], 'đâu': ['où'], 'gì': ['quoi', 'que'], 'ai': ['qui'], 'tại sao': ['pourquoi'], 'sao': ['pourquoi', 'comment'],
    'thế nào': ['comment'], 'khi nào': ['quand'], 'đây': ['ici', 'voici'], 'kia': ['là-bas'], 'này': ['ce', 'cet', 'cette'],
    'là': ['être', 'c\'est'], 'và': ['et'], 'nhưng': ['mais'], 'rất': ['très'], 'nữa': ['encore'], 'rồi': ['déjà'],
    'xin lỗi': ['pardon', 'excusez-moi'], 'cảm ơn': ['merci', 'remercier'], 'chào': ['bonjour', 'salut'],
}

SKIP_POS = {'character', 'name', 'symbol', 'abbrev', 'prefix', 'suffix'}
MAX_GLOSSES = 4
MAX_LEN = 28


def short_glosses(gloss: str):
    g = re.sub(r'\([^)]*\)', '', gloss)                       # "(de tortue)"
    g = g.replace('…', '...').strip().rstrip('.').strip()
    if not g or g.lower().startswith(('xem ', 'voir ', 'variante', 'forme ', 'pluriel', 'nom ', 'mot ', 'abréviation')):
        return []
    out = []
    for part in re.split(r'\s*[;,]\s*', g):
        p = part.strip().rstrip('.').strip()
        if not p or len(p) > MAX_LEN:
            continue
        out.append(p[0].lower() + p[1:] if p[:1].isupper() and not p[1:2].isupper() else p)
    return out


def build(src: str):
    words = {}
    for line in open(src, encoding='utf-8'):
        e = json.loads(line)
        if e.get('lang_code') != 'vi' or e.get('pos') in SKIP_POS:
            continue
        w = e['word'].strip().lower()
        if not w or not re.fullmatch(r"[a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ ]+", w):
            continue
        have = words.setdefault(w, [])
        for s in e.get('senses', []):
            for gl in s.get('glosses', [])[:1]:
                for g in short_glosses(gl):
                    if g not in have and len(have) < MAX_GLOSSES:
                        have.append(g)
    for w, g in COMMON.items():
        words[w] = (g + [x for x in words.get(w, []) if x not in g])[:MAX_GLOSSES]
    return {w: g for w, g in sorted(words.items()) if g}


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    words = build(src)
    data = {'_source': 'French Wiktionary (fr.wiktionary.org), Vietnamese entries, via wiktextract/kaikki.org; CC BY-SA 4.0', 'words': words}
    if len(sys.argv) > 3:                                      # Tatoeba vie_sentences.tsv.bz2: the words' everyday order
        sys.path.insert(0, __import__('os').path.dirname(__file__))
        from build_vidict_pivot import vi_order
        data['order'] = vi_order(sys.argv[3], words)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(words)} words -> {out}')
