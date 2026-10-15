#!/usr/bin/env python3
"""Builds the offline Vietnamese → Japanese / Chinese / Korean / Spanish word lists for the learning bar, by way of English.

No free Vietnamese → Japanese (or Chinese, Korean, Spanish) word list exists, but each language has a good one against
English. A Vietnamese word is joined to a foreign word when an English meaning of the first is an English meaning of the
second ("uống" = to drink = 飲む). English words carry several senses, so a join is kept only when it is likely the same sense:
  - the Vietnamese meanings are taken in their order (the first sense is the everyday one), at most three senses;
  - a foreign word is ranked by where the shared meaning sits among its own meanings (first is best) and how common it is;
  - a foreign word reached by a meaning that is also the first meaning of many other words ("thing", "person") is ranked
    below one reached by a meaning that picks few words.
What the join cannot find, the bar asks the model (src/lib/ChatScreens/VietjiBar.svelte).

Sources (all downloaded by hand, see the commit that added this file):
  vi-en   kaikki.org-dictionary-Vietnamese.jsonl   English Wiktionary via wiktextract, CC BY-SA 4.0
  ja      JMdict_e.gz                               EDRDG JMdict, CC BY-SA 4.0
  zh      cedict_1_0_ts_utf-8_mdbg.txt.gz           CC-CEDICT, CC BY-SA 4.0
  ko      kaikki Korean, slimmed to {w, pos, g}      English Wiktionary via wiktextract, CC BY-SA 4.0
  es      freedict-eng-spa .tei                     FreeDict eng-spa (from Wiktionary), CC BY-SA 3.0
  pairs   Tatoeba sentences + links (vie-X direct, and vie-eng + eng-X), CC BY 2.0 FR, as JSONL [vi, x]
  ko also needs the slimmed Korean file with tags and an etymology loan flag (see the commit that added --pairs)

    python3 scripts/build_vidict_pivot.py ja --vi vi-en.jsonl --src JMdict_e.gz --out public/dict/vi-ja.json
    python3 scripts/build_vidict_pivot.py ja ... --golden scripts/vidict_golden.json      # score only, nothing written
"""
import argparse
import gzip
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from collections import defaultdict

MAX_OUT = 3
ZIPF_WEIGHT = 0.5
# per language (frequency weight, weight of where the meaning sits), picked by a grid search on scripts/vidict_golden.json
# and scripts/vidict_holdout.json (64 words); Korean was then improved against scripts/vidict_holdout_ko2.json, 50 words written
# before any Korean tuning: top-1 54% -> 68%, top-3 64% -> 78% (2026-10-15, before vidict_common.json);
# then sentence pairs (Tatoeba) and Korean etymology; scripts/vidict_final.json (60 words a language, committed before that
# round, scored once): top-1 ja 58->73%, zh 65->70%, ko 63->70%, es 65->77%.
# Korean trusts frequency least: its list has conjugated forms, so a dictionary form (작다) is only estimated
WEIGHTS = {'ja': (0.6, 0.3), 'zh': (0.9, 0.3), 'es': (0.9, 0.3), 'ko': (0.5, 0.9)}
TATOEBA_BY_LANG = {'ja': 2.5, 'zh': 1.5, 'es': 4.0, 'ko': 6.0}   # grid on the tuning sets with the sentence pairs (2026-10-15)
OLD_OR_RARE = {'historical', 'archaic', 'obsolete', 'dated', 'rare', 'euphemistic', 'vulgar', 'slang', 'derogatory'}
VI_SENSES = 3

# ---------------------------------------------------------------- English meanings as join keys

REDIRECT = re.compile(r'^(?:alternative (?:form|spelling) of|synonym of|short for|clipping of|abbreviation of|'
                      r'misspelling of|obsolete form of|nonstandard form of|eye dialect spelling of)\s+\S.*?(?:“([^”]+)”|\(“([^”]+)”\))', re.I)
SKIP_GLOSS = re.compile(r'^(?:surname|variant of|old variant|used in|see |cl:|abbr\. for|classifier|counter for|measure word|\(?archaic\)?|'
                        r'name of|romanization of|hanja form of|alternative form)', re.I)


def coarse_pos(pos) -> str:
    """'verb', 'Godan verb with mu ending', 'v' → 'verb'; noun / adj likewise; anything else ''."""
    p = (pos or '').lower()
    if p in ('v', 'verb') or 'verb' in p and 'adverb' not in p:
        return 'verb'
    if p in ('n', 'noun') or p.startswith('noun'):
        return 'noun'
    if p in ('adj', 'adjective') or 'adjective' in p or 'keiyou' in p:
        return 'adj'
    return ''


def head_word(key: str):
    """'medical doctor' → 'doctor', "cow's milk" → 'milk': the head of a short phrase, a weaker key."""
    parts = key.split()
    return parts[-1] if 2 <= len(parts) <= 3 and len(parts[-1]) > 2 else None


def qualified(gloss: str, key: str = '') -> bool:
    """'go (board game)', 'cold (of a person)': a narrower sense than the bare English word. With a key, only the part of
    the gloss that holds it counts: in 'to eat, drink, consume (food)' the note belongs to 'consume', not to 'eat'."""
    if key:
        part = next((p for p in re.split(r'[;,/]', gloss or '') if key in p.lower()), gloss or '')
        return qualified(part)
    g = re.sub(r'\((?:CL|Tw|abbr|lit|fig|coll|dialect|loanword|onom)[^)]*\)', '', gloss or '', flags=re.I)   # 鱼 "fish (CL:条)"
    return bool(re.search(r'\([^)]*\)', g))


def en_keys(gloss: str) -> list:
    """'to have, to possess' → ['have', 'possess']; 'how many?' → ['how many']; at most three words each."""
    m = REDIRECT.match(gloss)
    if m:
        gloss = m.group(1) or m.group(2) or ''
    elif SKIP_GLOSS.match(gloss.strip()):
        return []
    g = re.sub(r'\([^)]*\)|\[[^\]]*\]|“[^”]*”|"[^"]*"', ' ', gloss)
    out = []
    for part in re.split(r'[;,/]', g):
        p = part.strip().lower().rstrip('?!.').strip()
        p = re.sub(r'^(?:to|a|an|the)\s+', '', p)
        p = re.sub(r'^(?:be|become|feel)\s+(?=\w+$)', '', p)       # Korean "to be big" = Vietnamese "big"; not "be able to"
        p = re.sub(r'^(?:a|an|the)\s+', '', p)
        p = re.sub(r'\s+', ' ', p)
        if p and re.fullmatch(r"[a-z][a-z' -]*", p) and len(p.split()) <= 3 and p not in out:
            out.append(p)
    return out


BARE_REDIRECT = re.compile(r'^(?:alternative (?:letter-case )?(?:form|spelling) of|synonym of|short for)\s+([^\W\d_][^\W\d_ ]*(?: [^\W\d_]+){0,3})\s*$', re.I)


def vietnamese(path: str) -> dict:
    """vi word → English keys in order of sense, everyday sense first, with the sense's part of speech."""
    keys = defaultdict(list)
    alias = {}
    names = defaultdict(list)                                  # Mặt Trời (the Sun): only reached through "mặt trời"
    for line in open(path, encoding='utf-8'):
        e = json.loads(line)
        if e.get('lang_code') == 'vi' and e.get('pos') == 'name':
            for s in e.get('senses', [])[:2]:
                for g in s.get('glosses', [])[:1]:
                    names[unicodedata.normalize('NFC', e['word'].strip().lower())] += [(k, 'noun') for k in en_keys(g)]
            continue
        if e.get('lang_code') != 'vi' or e.get('pos') in ('character', 'romanization', 'prefix', 'suffix', 'symbol'):
            continue
        w = unicodedata.normalize('NFC', e['word'].strip().lower())
        if not re.fullmatch(r'[^\W\d_]+(?: [^\W\d_]+){0,3}', w):
            continue
        for s in e.get('senses', []):
            if len({k for k, _ in keys[w]}) >= 8:
                break
            if set(s.get('tags') or []) & OLD_OR_RARE:                # "tôi" = slave (historical) is not what a learner means
                continue
            for g in s.get('glosses', [])[:1]:
                m = BARE_REDIRECT.match(g.strip())
                if m and '“' not in g:
                    alias.setdefault(w, unicodedata.normalize('NFC', m.group(1).lower()))
                    continue
                for k in en_keys(g):
                    keys[w].append((k, e.get('pos')))
    for w, target in alias.items():
        if not keys.get(w) and (keys.get(target) or names.get(target)):
            keys[w] = list(keys.get(target) or names[target])
    return {w: v for w, v in keys.items() if v}

# ---------------------------------------------------------------- foreign lists: english key → (text, rank among its meanings, common)


def tone_mark(syl: str) -> str:
    """'hao3' → 'hǎo', 'lu:4' → 'lǜ'."""
    m = re.fullmatch(r'([a-zü:]+)([1-5])', syl.lower().replace('u:', 'ü').replace('v', 'ü'))
    if not m:
        return syl
    s, t = m.group(1), int(m.group(2))
    if t == 5:
        return s
    marks = {'a': 'āáǎà', 'e': 'ēéěè', 'i': 'īíǐì', 'o': 'ōóǒò', 'u': 'ūúǔù', 'ü': 'ǖǘǚǜ'}
    if 'a' in s or 'e' in s:
        v = 'a' if 'a' in s else 'e'
    elif 'ou' in s:
        v = 'o'
    else:
        v = [c for c in s if c in marks][-1] if any(c in marks for c in s) else None
    if not v:
        return s
    i = s.index(v) if v != 'o' or 'ou' not in s else s.index('o')
    return s[:i] + marks[v][t - 1] + s[i + 1:]


def chinese(path: str):
    out = []
    for line in gzip.open(path, 'rt', encoding='utf-8'):
        if line.startswith('#'):
            continue
        m = re.match(r'(\S+) (\S+) \[([^\]]+)\] /(.*)/\s*$', line)
        if not m or re.search(r'[A-Za-z0-9]', m.group(2)):
            continue
        simp, pin, glosses = m.group(2), m.group(3), m.group(4).split('/')
        if pin[:1].isupper():                                  # proper names have capitalised pinyin
            continue
        text = f"{simp}[{''.join(tone_mark(p) for p in pin.split())}]"
        try:
            simp.encode('gb2312'); rare = 0.0
        except UnicodeEncodeError:
            rare = 1.5                                         # outside the 6763 everyday characters
        for rank, g in enumerate(x for x in glosses if x and not x.startswith('CL:')):
            for j, k in enumerate(en_keys(g)):
                out.append((k, text, rank, -0.15 * max(0, len(simp) - 2) - rare - 0.8 * qualified(g, k) - PART * j, 'verb' if g.startswith('to ') else ''))
    return out


JA_COMMON = {'news1', 'ichi1', 'spec1', 'spec2', 'gai1'}


def japanese(path: str):
    out = []
    with gzip.open(path, 'rb') as f:
        for _, el in ET.iterparse(f, events=('end',)):
            if el.tag != 'entry':
                continue
            kebs = [(k.findtext('keb'), {p.text for p in k.findall('ke_pri')}) for k in el.findall('k_ele')]
            rebs = [(r.findtext('reb'), {p.text for p in r.findall('re_pri')}, r.find('re_nokanji') is not None) for r in el.findall('r_ele')]
            senses = el.findall('sense')
            if not rebs or not senses:
                el.clear(); continue
            uk = any('usually written using kana' in (m.text or '') for m in senses[0].findall('misc'))
            common = any(p & JA_COMMON for _, p in kebs) or any(p & JA_COMMON for _, p, _ in rebs)
            reb = rebs[0][0]
            keb = next((k for k, p in kebs if p & JA_COMMON), kebs[0][0] if kebs else None)
            text = reb if (uk or not keb) else f'{keb}[{reb}]'
            katakana = 1.0 if re.fullmatch(r'[ァ-ヺー・]+', bare(text)) else 0.0   # ハングリー for đói: a loanword, not the word
            rank = 0
            pos = ''
            for s in senses:
                pos = coarse_pos(' '.join(p.text or '' for p in s.findall('pos'))) or pos
                if any('archaic' in (m.text or '') or 'obsolete' in (m.text or '') for m in s.findall('misc')):
                    continue
                for g in s.findall('gloss')[:3]:
                    for j, k in enumerate(en_keys(g.text or '')):
                        out.append((k, text, rank, (1.0 if common else 0.0) - katakana - 0.8 * qualified(g.text, k) - PART * j, pos))
                    rank += 1
            el.clear()
    return out


HOMOGRAPH = 0.6       # per place behind the first entry of the same spelling (Wiktionary lists the everyday word first:
                      # 눈 eye before snow, 개 dog, 달 moon, 강 river)

# hangul → a rough romanization, enough to see a loanword's English consonants (밀크 → milkeu, 핫 → hat)
_L = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
_V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
_T = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']


def romanize(w: str) -> str:
    out = []
    for ch in w:
        c = ord(ch) - 0xAC00
        if 0 <= c < 11172:
            out.append(_L[c // 588] + _V[(c % 588) // 28] + _T[c % 28])
    return ''.join(out)


def skeleton(word: str) -> str:
    """The consonants as heard, voicing and l/r merged: milk → mlk, white → wt, 밀크 (milkeu) → mlk, 화이트 (hwaiteu) → wt."""
    w = word.lower().replace('wh', 'w').replace('hw', 'w').replace('ph', 'p').replace('th', 't').replace('ck', 'k').replace('ng', 'n')
    w = w.translate(str.maketrans('bdgvfzqcxr', 'ptkppjkksl'))
    w = re.sub(r'[^ptkjslmnwh]', '', w)
    return re.sub(r'(.)\1+', r'\1', w)


def loanword_of(text: str, key: str) -> bool:
    """밀크 for milk, 핫 for hot, 모드 for mode: the hangul spells the English word itself."""
    a, b = skeleton(romanize(text)), skeleton(key)
    return len(b) >= 2 and a == b


# only words a learner must not be handed (measured: marking informal / rare / dialect words as well cost accuracy, since
# Wiktionary tags many everyday words that way)
KO_MARKED = {'vulgar', 'derogatory'}
MARKED = 0.8
KO_OTHER_WORDS = set()                                         # spellings that are also a word other than a verb/adjective


def korean(path: str):
    out = []
    seen = defaultdict(int)
    for line in open(path, encoding='utf-8'):
        e = json.loads(line)
        w = e['w']
        if e.get('pos') in ('character', 'syllable', 'romanization'):
            continue
        if e.get('pos') not in ('verb', 'adj'):
            KO_OTHER_WORDS.add(w)
        h = seen[w]                                            # how many entries of this spelling came before
        seen[w] += 1
        if e.get('pos') in ('name', 'suffix', 'prefix', 'symbol') or not re.fullmatch(r'[가-힣]+(?: [가-힣]+)?', w):
            continue
        marked = MARKED * bool(set(e.get('tags') or []) & KO_MARKED)     # 찌찌, 개새끼: not what a learner should say
        loan = LOANWORD / 2 * bool(e.get('loan'))                      # borrowed (etymology says so): a native word first
        for rank, g in enumerate(e['g']):
            for j, k in enumerate(en_keys(g)):
                out.append((k, w, rank, -0.1 * max(0, len(w) - 3) - 0.8 * qualified(g, k) - min(HOMOGRAPH * h, 2.0) - PART * j
                            - LOANWORD * loanword_of(w, k) - marked - loan, coarse_pos(e.get('pos'))))
    return out


def spanish(path: str):
    out = []
    ns = {'t': 'http://www.tei-c.org/ns/1.0'}
    root = ET.parse(path).getroot()
    for entry in root.iter('{http://www.tei-c.org/ns/1.0}entry'):
        orth = (entry.findtext('t:form/t:orth', namespaces=ns) or '').strip().lower()
        pos = entry.findtext('t:gramGrp/t:pos', namespaces=ns)
        if not orth or pos == 'pn':
            continue
        key = re.sub(r'^(?:to|a|an|the)\s+', '', orth)
        quotes = [q.text.strip() for q in entry.iter('{http://www.tei-c.org/ns/1.0}quote') if q.text and q.text.strip()]
        for rank, q in enumerate(dict.fromkeys(quotes)):
            if len(q.split()) <= 3:                              # "hospital" is Spanish too: frequency sorts out "go"
                out.append((key, q, rank, 1.0 if rank == 0 else 0.5, coarse_pos(pos)))
    return out

# ---------------------------------------------------------------- how common a word is (wordfreq, Apache-2.0; build time only)

def zipf_lookup(lang: str):
    """word → Zipf frequency (0 = unseen, 3 = once per million words, 7 = 'the'); None when wordfreq is not installed."""
    try:
        from wordfreq import get_frequency_dict
    except ImportError:
        return None
    import math
    freq = get_frequency_dict(lang)

    def zipf(word: str) -> float:
        w = bare(word)
        f = freq.get(w, 0.0)
        if not f and lang == 'ko' and w.endswith('다') and len(w) >= 2:
            # the Korean list is cut into morphemes: 먹다 is counted as its stem 먹, 사랑하다 as 사랑 + 하
            if w.endswith('하다') and len(w) > 2:
                f = freq.get(w[:-2], 0.0) / 2
            else:
                f = freq.get(w[:-1], 0.0)
                if w[:-1] in KO_OTHER_WORDS:
                    f /= 4                                     # 잘 (well) is not the stem of 잘다; 가 is mostly the particle
        return math.log10(f * 1e9) if f > 0 else 0.0
    return zipf


# ---------------------------------------------------------------- sentence pairs (Tatoeba, CC BY 2.0 FR; build time only)

def forms(text: str, lang: str) -> list:
    """What to look for in a translated sentence: 飲む[のむ] → 飲む, のむ, 飲; 먹다 → 먹; 사랑하다 → 사랑; beber → beb."""
    b = bare(text)
    out = [b]
    m = re.search(r'\[([^\]]+)\]', text)
    if lang == 'ja':
        if m:
            out.append(m.group(1))
        if len(b) >= 2 and re.search(r'[うくぐすつぬぶむるい]$', b):
            out.append(b[:-1])                                 # 飲む → 飲 (飲みます, 飲んだ)
    elif lang == 'ko' and b.endswith('다') and len(b) >= 2:
        out.append(b[:-2] if b.endswith('하다') and len(b) > 2 else b[:-1])
    elif lang == 'es':
        out = [b.lower()]
        if len(b) >= 5 and re.search(r'(ar|er|ir)$', b):
            out.append(b.lower()[:-2])                          # beber → beb (bebo, bebes, bebió)
    return [f for f in dict.fromkeys(out) if f]


class Evidence:
    """How often a Vietnamese word's sentences are translated with a given foreign word."""
    def __init__(self, path: str, lang: str):
        self.lang = lang
        self.vi, self.x = [], []
        self.by_syl = defaultdict(set)
        for i, line in enumerate(open(path, encoding='utf-8')):
            v, x = json.loads(line)
            v = ' ' + ' '.join(re.findall(r'[^\W\d_]+', unicodedata.normalize('NFC', v.lower()))) + ' '
            self.vi.append(v); self.x.append(x.lower() if lang == 'es' else x)
            for syl in set(v.split()):
                self.by_syl[syl].add(i)

    def rows(self, w: str):
        syls = w.split()
        ids = set.intersection(*(self.by_syl.get(x, set()) for x in syls)) if syls else set()
        return [i for i in ids if f' {w} ' in self.vi[i]]

    def share(self, w: str, text: str, rows=None):
        """(share of w's sentence pairs whose translation holds the word, number of pairs)."""
        rows = self.rows(w) if rows is None else rows
        if not rows:
            return 0.0, 0
        fs = forms(text, self.lang)
        hit = sum(1 for i in rows if any(f in self.x[i] for f in fs))
        return hit / len(rows), len(rows)


# ---------------------------------------------------------------- the join


POS_MISMATCH = 0.8
PART = 0.3                                                     # 먹다 = "to eat, drink, ...": drink is its second meaning, 마시다's first
LOANWORD = 0.8                                                 # a native or Sino-Korean word beats the English one in hangul
UNSURE_MARGIN = 0.2                                            # measured: 'sure' picks right 73-88% (ko lowest)
UNSURE = set()                                                 # words whose first pick is a guess: the bar also asks the model
HEAD_KEY = 0.7


def index(rows):
    by_key = defaultdict(list)
    for k, text, rank, common, pos in rows:
        by_key[k].append((text, rank, common, pos))
        h = head_word(k)
        if h and pos in ('noun', ''):
            by_key[h].append((text, rank, common - HEAD_KEY, pos))
    return by_key


TATOEBA = 1.5          # score bonus for a word found in every translation of the Vietnamese word's sentences
TATOEBA_MIN = 2        # pairs needed before the sentences count
POOL = 8               # candidates looked at again with the sentences


def join(vi: dict, by_key: dict, zipf=None, rank_weight: float = 0.6, evidence=None) -> dict:
    out = {}
    for w, keys in vi.items():
        scored = {}                                            # text → (score, which sense led to it)
        expanded = []
        for k, vpos in keys:
            expanded.append((k, vpos, 0.0))
            h = head_word(k)
            if h and coarse_pos(vpos) == 'noun':                # "medical doctor" → doctor; "thank you" is not a "you"
                expanded.append((h, vpos, HEAD_KEY))
        for i, (k, vpos, extra) in enumerate(expanded):
            cands = by_key.get(k)
            if not cands:
                continue
            first_meaning = sum(1 for _, r, _, _ in cands if r == 0)  # how many foreign words have k as their first meaning
            spread = 0.25 * min(first_meaning, 8) / 8
            vp = coarse_pos(vpos)
            for text, rank, common, tpos in cands:
                s = i * 1.0 + extra + min(rank, 6) * rank_weight - common * 1.2 + spread
                if vp and tpos and vp != tpos:
                    s += POS_MISMATCH                          # "chạy" (to run) is not "partida" (a run)
                if zipf:
                    s -= ZIPF_WEIGHT * zipf(text)
                weak = bool(extra) or bool(vp and tpos and vp != tpos)
                if text not in scored or s < scored[text][0]:
                    scored[text] = (s, k, weak)
        ranked = sorted(scored.items(), key=lambda x: x[1][0])
        backed = False
        if evidence and ranked:
            rows = evidence.rows(w)
            if len(rows) >= TATOEBA_MIN:
                again = {}
                for text, (s, k, weak) in ranked[:POOL]:
                    share, _ = evidence.share(w, text, rows)
                    again[text] = (s - TATOEBA * share, k, weak, share)
                for text, v in ranked[POOL:]:
                    again[text] = (*v, 0.0)
                ranked = sorted(again.items(), key=lambda x: x[1][0])
                backed = ranked[0][1][3] >= 0.3                 # the sentences agree with the first pick
                ranked = [(t, v[:3]) for t, v in ranked]
        # the best word of each sense first, so a rare first sense ("trà" = generation) cannot fill all three places
        best, senses = [], set()
        for text, (s, k, _) in ranked:
            if k not in senses and len(best) < MAX_OUT:
                best.append((text, s)); senses.add(k)
        for text, (s, k, _) in ranked:
            if len(best) >= MAX_OUT:
                break
            if all(text != t for t, _ in best):
                best.append((text, s))
        if best:
            out[w] = [t for t, _ in best]
            margin = ranked[1][1][0] - ranked[0][1][0] if len(ranked) > 1 else 9.0
            if (margin < UNSURE_MARGIN or ranked[0][1][2]) and not backed:
                UNSURE.add(w)
    return out


def bare(text: str) -> str:
    return re.sub(r'\[[^\]]*\]', '', text)


def score(words: dict, golden: dict, lang: str):
    g = golden.get(lang, {})
    top1 = top3 = 0
    misses = []
    for vi, ok in g.items():
        got = [bare(t) for t in words.get(vi, [])]
        if got and got[0] in ok:
            top1 += 1
        if any(x in ok for x in got):
            top3 += 1
        else:
            misses.append(f'{vi}: {got} (want {ok[0]})')
    n = len(g) or 1
    return top1 / n, top3 / n, misses


READERS = {'ja': japanese, 'zh': chinese, 'ko': korean, 'es': spanish}

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('lang', choices=sorted(READERS))
    ap.add_argument('--vi', required=True)
    ap.add_argument('--src', required=True)
    ap.add_argument('--out')
    ap.add_argument('--golden')
    ap.add_argument('--pairs', help='Tatoeba Vietnamese/foreign sentence pairs (JSONL [vi, x]) used as evidence')
    ap.add_argument('--common', help='JSON {lang: {vi: [..]}} of everyday words put first (same role as COMMON in build_vidict.py)')
    a = ap.parse_args()
    vi = vietnamese(a.vi)
    zipf = zipf_lookup(a.lang)
    if zipf is None:
        print('wordfreq not installed: ranking without word frequency', file=sys.stderr)
    ZIPF_WEIGHT, rank_weight = WEIGHTS[a.lang]
    TATOEBA = TATOEBA_BY_LANG[a.lang]
    words = join(vi, index(READERS[a.lang](a.src)), zipf, rank_weight, Evidence(a.pairs, a.lang) if a.pairs else None)
    if a.common:
        for w, g in json.load(open(a.common, encoding='utf-8')).get(a.lang, {}).items():
            words[w] = (g + [x for x in words.get(w, []) if bare(x) not in {bare(y) for y in g}])[:MAX_OUT]
            UNSURE.discard(w)                                  # an everyday word listed by hand is sure
    if a.golden:
        t1, t3, misses = score(words, json.load(open(a.golden, encoding='utf-8')), a.lang)
        print(f'{a.lang}: top1 {t1:.0%}  top3 {t3:.0%}  ({len(words)} words)')
        for m in misses:
            print('  miss', m)
    if a.out:
        src = {'ja': 'JMdict (EDRDG, CC BY-SA 4.0)', 'zh': 'CC-CEDICT (CC BY-SA 4.0)', 'ko': 'English Wiktionary Korean entries (CC BY-SA 4.0)',
               'es': 'FreeDict eng-spa (CC BY-SA 3.0)'}[a.lang]
        data = {'_source': f'Joined through English: English Wiktionary Vietnamese entries (CC BY-SA 4.0) + {src}', 'words': dict(sorted(words.items())),
                'unsure': sorted(UNSURE & set(words))}
        with open(a.out, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        print(f'{len(words)} words -> {a.out}', file=sys.stderr)
