#!/usr/bin/env python3
"""Drafts a card's knowledge graph from its lore books (owner, 2026-10-21: "librarian nên có … Knowledge Graph … phân biệt sự thật,
tin đồn, điều chưa biết và thông tin đã lỗi thời").

A model only DRAFTS: the batches of books go in turn to haiku through a lean `claude -p` and to main-deepseek through 9Router
(the default runs both side by side; ask(); never Codex) with the brief below, and the answer is one JSON object. merge.cjs then checks every entity and fact against
story/schema/lore-graph.schema.json, drops what fails (dangling ids, a status the text does not support), and writes
story/graphs/<world>.json. Nothing here touches the save or the live server.

  extract.py <world> <card repo>/fate-simulator/risu_lorebook.json [--out DIR] [--jobs 4] [--model claude:haiku,main-deepseek] [--only N,M]
"""
from __future__ import annotations
import argparse
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BATCH_CHARS = 14_000          # ~3.6k tokens of books a call: a bigger batch outran the 9Router call (measured 2026-10-21)
RULE_SHELF = re.compile(r'^\s*rules\b', re.I)

BRIEF = """You build a knowledge graph from a story's lore books for a game master. Read the BOOKS and answer with ONE JSON object
and nothing else:
{"entities":[{"id":"…","kind":"person|faction|place|item|event","name":"…","aliases":["…"]}],
 "facts":[{"s":"<entity id>","r":"<relation>","o":"<entity id or a short literal or null>","status":"fact|rumor|unknown|outdated",
           "text":"<one plain English sentence stating it, max 30 words>","source":"book:<exact book title>","until":"<only for outdated>",
           "known_by":[{"who":"<entity id>","as":"fact|rumor"}]}]}

ENTITY ids: the lower-case canonical name ("sunny", "the forgotten shore", "church of the evernight goddess"). Keep the same id for
the same thing across books. aliases: every other name the books use, in any language (Vietnamese names in KEYS lines count:
copy them exactly, with their accents), titles, nicknames. Only named things; no generic nouns ("a soldier").

RELATIONS (r), use only these: knows, member_of, leads, located_at, part_of, owns, enemy_of, ally_of, controls, kin_of, serves,
mentor_of, loves, status, identity, rank, ability, wants, created, killed, happened_at.
  status: o = alive | dead | missing | sealed | destroyed | infected ...   identity: o = who/what s really is (a secret identity)
  rank: o = the rank, sequence or level as written.  located_at: where s lives or is based.  part_of: place inside place.
  controls: a faction or person rules a place.  happened_at: an event and its place.

STATUS (the point of this graph; be strict):
  fact      the book states it as true in the story's world.
  rumor     the book says it is rumored, whispered, believed, claimed, a legend, unconfirmed, or "some say".
  unknown   the book says nobody knows it, it is a mystery, or it is hidden from the world; o may be null.
  outdated  it WAS true and the book says it no longer is (former leader, destroyed city, used to belong); put what ended it in until.
known_by: only when the book says who knows it (a secret, something only some people learned). "as":"rumor" when they only heard it.
Leave it out for common knowledge.

Rules: every s and every entity id o must be in "entities" (the same answer). 4-15 facts a book, the ones a game master needs
(who is who, who belongs where, who is enemy of whom, secrets, what is rumor). Never invent; skip what the books do not say.
Compact JSON, no comments, no text before or after it.

BOOKS
"""


def books_of(path: Path):
    raw = json.loads(path.read_text())
    entries = raw.get('data', raw)
    folder = {e.get('key'): e.get('comment', '') for e in entries if e.get('mode') == 'folder'}
    out, at = [], {}
    for e in entries:
        if e.get('mode') == 'folder' or str(e.get('alwaysActive')) == 'True' or not (e.get('content') or '').strip():
            continue
        shelf = folder.get(e.get('folder'), '')
        if RULE_SHELF.match(shelf):
            continue
        title = (e.get('comment') or '').strip() or e['content'][:60]
        if title not in at:
            at[title] = {'title': title, 'shelf': shelf, 'keys': e.get('key', ''), 'content': ''}
            out.append(at[title])
        at[title]['content'] += '\n' + e['content']
    return out


def batches(books):
    """Books packed into batches of BATCH_CHARS. A longer book's first part goes in its place and the rest in batches of their own
    AFTER all the others, so adding them did not renumber (and re-ask) the batches drafted before (2026-10-21: 20 books were cut)."""
    cur, size, rest = [], 0, []
    for b in books:
        head = f"=== BOOK: {b['title']}  (shelf: {b['shelf']})\nKEYS: {b['keys']}\n"
        text = head + b['content'].strip() + '\n'
        if len(text) > BATCH_CHARS:
            body = b['content'].strip()
            step = BATCH_CHARS - len(head) - 40
            parts = [body[i:i + step] for i in range(0, len(body), step)]
            text = head + parts[0] + '\n'
            rest += [[head.replace('\nKEYS:', f' (part {k + 2} of {len(parts)})\nKEYS:', 1) + p + '\n'] for k, p in enumerate(parts[1:])]
        if cur and size + len(text) > BATCH_CHARS:
            yield cur
            cur, size = [], 0
        cur.append(text)
        size += len(text)
    if cur:
        yield cur
    yield from rest


ROUTER = 'http://127.0.0.1:20128/v1/chat/completions'
NO_CODEX = re.compile(r'^(cx/|gpt-|web-codex|cgw/)', re.I)
# modelapi.vn bills mvn/deepseek-v4-flash, mvn/deepseek-flash and deepseek-v4-pro at 43.2x ($12.96 / M in, $51.84 / M out); the
# first full build ran on v4-flash (613 calls, most of 2026-10-21's $64.56, while 9Router logged $0.58). The owner the same day:
# "64$ này tượng trưng thui vẫn đặt ngang nó với haiku": the cost is symbolic and DeepSeek stands level with haiku. So the
# default sends the batches to both side by side, and those models are only flagged, not refused.
EXPENSIVE = re.compile(r'^(mvn/)?(deepseek-flash|deepseek-v4-flash|deepseek-v4-pro)$', re.I)
CLAUDE = re.compile(r'^claude:(haiku|sonnet)$', re.I)
CLAUDE_FLAGS = ['--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
                '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json',
                '--system-prompt', 'You turn lore books into a knowledge graph. Answer only with the JSON object asked for.']


def ask_claude(model: str, prompt: str, tries: int = 2) -> tuple[str, dict, float]:
    """The default: a lean `claude -p` on the Claude plan (no tools, MCP, settings, hooks or kept session), $0 on top of it.
    Pulling entities and facts out of a book into a fixed JSON shape is extraction, haiku's work (CFO 2026-10-21)."""
    t, last = time.time(), ''
    for k in range(tries):
        try:
            r = subprocess.run(['claude', '-p', '--model', CLAUDE.match(model).group(1).lower(), *CLAUDE_FLAGS], input=prompt,
                               capture_output=True, text=True, timeout=600)
            j = json.loads(r.stdout)
            if j.get('is_error'):
                raise RuntimeError(str(j.get('result'))[:200])
            u = j.get('usage') or {}
            return str(j.get('result') or ''), {'prompt_tokens': u.get('input_tokens'), 'completion_tokens': u.get('output_tokens')}, time.time() - t
        except Exception as e:  # noqa: BLE001 - a limit, a timeout or a non-JSON answer: once more
            last = f'{type(e).__name__}: {e}'
            time.sleep(5 * (k + 1))
    raise RuntimeError(last[:300])


def ask(model: str, prompt: str, max_tokens: int = 9000, tries: int = 4) -> tuple[str, dict, float]:
    """One chat completion through 9Router, reasoning OFF: DeepSeek v4 spent the whole 9000-token answer thinking out loud on a
    3.6k-token batch (measured 2026-10-21: content empty, or 32 KB of notes and no JSON); reasoning_effort "none" answers directly."""
    if CLAUDE.match(model):
        return ask_claude(model, prompt)
    if NO_CODEX.match(model):
        raise SystemExit(f'refused: {model} (worker calls never go to Codex)')
    if EXPENSIVE.match(model) and not getattr(ask, 'warned', False):
        ask.warned = True
        print(f'note: {model} is billed at 43.2x by modelapi.vn (main-deepseek is deepseek-v4.1-flash)', file=sys.stderr, flush=True)
    body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': prompt}], 'max_tokens': max_tokens, 'stream': False,
                       'reasoning_effort': 'none', 'response_format': {'type': 'json_object'}}).encode()
    t, last = time.time(), ''
    for k in range(tries):
        try:
            req = urllib.request.Request(ROUTER, body, {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.environ['BR_9ROUTER']})
            r = json.JSONDecoder().raw_decode(urllib.request.urlopen(req, timeout=300).read().decode('utf-8', 'replace').strip())[0]
            return r['choices'][0]['message'].get('content') or '', r.get('usage') or {}, time.time() - t
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code}: {e.read(200).decode("utf-8", "replace")}'
            if e.code not in (408, 429) and e.code < 500:
                break
        except Exception as e:  # noqa: BLE001 - a hang, a reset or a non-JSON body: try again
            last = f'{type(e).__name__}: {e}'
        time.sleep((2, 5, 10, 20)[k])
    raise RuntimeError(last[:300])


def run(i, texts, out: Path, model: str, others: tuple = ()):
    """One batch on `model`; if it fails (a 503, a limit, a channel out of balance), on each of `others` in turn."""
    js = out / f'batch-{i:03d}.json'
    if js.exists():
        return i, 'cached'
    prompt = BRIEF + '\n'.join(texts)
    (out / f'batch-{i:03d}.brief').write_text(prompt)
    errors = []
    for m in (model, *[o for o in others if o != model]):
        try:
            body, usage, sec = ask(m, prompt)
            model = m
            break
        except Exception as e:  # noqa: BLE001
            errors.append(f'{m}: {str(e)[:160]}')
    else:
        return i, 'failed: ' + ' | '.join(errors)
    (out / f'batch-{i:03d}.txt').write_text(body)
    m = re.search(r'\{[\s\S]*\}', body)
    if not m:
        return i, f'no json ({usage.get("completion_tokens")} tokens)'
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        return i, f'bad json: {e} ({usage.get("completion_tokens")} tokens)'
    js.write_text(json.dumps(obj, ensure_ascii=False))
    with open(out / 'usage.jsonl', 'a') as f:
        f.write(json.dumps({'batch': i, 'model': model, 'sec': round(sec, 1), **{k: usage.get(k) for k in ('prompt_tokens', 'completion_tokens')}}) + '\n')
    return i, f"ok {len(obj.get('entities', []))} entities {len(obj.get('facts', []))} facts in {sec:.0f}s on {model}" + (f' (after {errors[0][:80]})' if errors else '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('world')
    ap.add_argument('lorebook')
    ap.add_argument('--out', default=str(Path.home() / '.backend-review/work/risu-librarian-kg/extract'))
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--model', default='claude:haiku,main-deepseek',
                    help='one model or several, comma-separated, taken in turn batch by batch (default: haiku on the plan and main-deepseek side by side)')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    models = [m.strip() for m in a.model.split(',') if m.strip()]
    if any(not CLAUDE.match(m) for m in models) and 'BR_9ROUTER' not in os.environ:      # the key comes from the Keychain, never through this process's argv or output
        sec = Path.home() / '.claude/skills/backend-review/scripts/secret_run.py'
        raise SystemExit(subprocess.call([sys.executable, str(sec), 'br-9router', '--', sys.executable, *sys.argv]))
    out = Path(a.out) / a.world
    out.mkdir(parents=True, exist_ok=True)
    bs = list(batches(books_of(Path(a.lorebook))))
    only = {int(x) for x in a.only.split(',') if x}
    print(f'{a.world}: {len(bs)} batches', flush=True)
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        todo = [(i, t) for i, t in enumerate(bs) if not only or i in only]
        futs = [ex.submit(run, i, t, out, models[k % len(models)], tuple(models)) for k, (i, t) in enumerate(todo)]
        for f in cf.as_completed(futs):
            i, msg = f.result()
            print(f'  batch {i}: {msg}', flush=True)


if __name__ == '__main__':
    main()
