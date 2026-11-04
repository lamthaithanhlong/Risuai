"""Test stand-in for tools/assets/shared_assets.py, shaped by the finds spec: for_card(card_id) returns one entry per portable find of
another card ("Thu được: <name vi>", keys = [vi, en], body with the translation rule). Non-portable finds only load into their source card.
It exists so finds.check.mjs can show finds.saved red and green before the real loader lands; the real one is tested the same way when present."""
import json, os, glob

RULE = ("In this world apply it only as this world's own mechanics allow: express the effect through this world's own mechanics, "
        "power scale and cost; never let it break this world's canon; if it cannot exist here, it appears only as a curiosity with no effect.")


def for_card(card_id, shared_dir=None):
    root = shared_dir or os.environ['RISU_SHARED_DIR']
    out = []
    for p in sorted(glob.glob(os.path.join(root, 'finds', '*.json'))):
        r = json.load(open(p, encoding='utf-8'))
        own = r['source']['card'] == card_id
        if not (r['portable'] or own):
            continue
        out.append({'id': 'finds/' + r['id'], 'folder': 'finds', 'title': 'Thu được: ' + r['name']['vi'], 'keys': [r['name']['vi'], r['name']['en']],
                    'body': r.get('effect', '') + '\n' + r.get('conditions', '') + '\n' + RULE, 'path': p})
    return out
