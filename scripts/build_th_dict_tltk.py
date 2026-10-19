"""Step 1 of public/dict/th-words.json: the word list and tltk's dictionary reading of each word.

Words: TNC frequency order (pythainlp.corpus.tnc), kept only when pythainlp's curated word list (thai_words) has them, since
TNC alone carries typos and fragments (กล่ม, ดเวด); Thai letters only, no ๆ; the top N (20000).
tltk.nlp.g2p gives 'ผล~ไม้<tr/>phon4'la3~maaj3|<s/>': '|' between words, '~' between written units, "'" between the syllables
said in one unit, tone 0 mid 1 low 2 falling 3 high 4 rising. A word whose Thai and romanization do not line up is kept with
no reading (tltk gave สิบเอ็ด as สิ~บเอ็ด / si1~). Each row also carries pythainlp's written syllables (syllable_tokenize, engine
dict), the units the word is shown in.

    pip install pythainlp tltk python-crfsuite "numpy<2" "scipy<1.14"   (Python 3.12)
    python3 scripts/build_th_dict_tltk.py ~/.risu-thai-build/tltk_words.json [20000]
then node scripts/build_th_dict.mjs (step 2).
"""
import json, re, sys, warnings
warnings.filterwarnings('ignore')
from multiprocessing import Pool

THAI_ONLY = re.compile(r'^[ก-๎]+$')


def parse(raw):
    """[(units, [[ [roman, tone], ...] per unit ])] per tltk word, or None when the Thai and the romanization do not line up."""
    raw = raw.replace('<s/>', '|')
    thai, rom = raw.split('<tr/>') if '<tr/>' in raw else (raw, '')
    tw = [w for w in thai.split('|') if w.strip()]
    rw = [w for w in rom.split('|') if w.strip()]
    if len(tw) != len(rw):
        return None
    out = []
    for t, r in zip(tw, rw):
        units, groups = t.split('~'), r.split('~')
        if len(units) != len(groups) or not all(units) or not all(groups):
            return None
        syl = []
        for g in groups:
            gs = []
            for s in g.split("'"):
                m = re.match(r'^(.*?)([0-4])$', s)
                if not m or not m.group(1):
                    return None
                gs.append([m.group(1), int(m.group(2))])
            syl.append(gs)
        out.append((units, syl))
    return out


def one(wf):
    import tltk
    from pythainlp.tokenize import syllable_tokenize
    w, f = wf
    try:
        p = parse(tltk.nlp.g2p(w))
    except Exception:
        p = None
    if p is not None and ''.join(u for x in p for u in x[0]) != w:
        p = None
    # pythainlp's written syllables: the units the word is shown in
    return [w, f, p, syllable_tokenize(w, engine='dict')]


if __name__ == '__main__':
    from pythainlp.corpus import tnc, thai_words
    out_path = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 20000
    dic = thai_words()
    freq = sorted((x for x in tnc.word_freqs() if THAI_ONLY.match(x[0]) and 'ๆ' not in x[0] and x[0] in dic), key=lambda x: -x[1])[:n]
    with Pool(6) as pool:
        out = pool.map(one, freq, chunksize=50)
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print('words', len(out), 'unread', sum(1 for x in out if x[2] is None))
