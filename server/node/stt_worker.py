"""Long-lived local speech-to-text worker for the Risu server (server/node/stt.cjs).

Protocol (one JSON object per line):
  stdin : {"id": 1, "path": "/tmp/x.m4a", "language": "vi" | "en" | "auto" (vi or en, whichever is likelier)}
  stdout: {"ready": true, "model": "turbo", "load_s": 2.1}            once, after the main model is loaded
          {"id": 1, "ok": true, "text": "...", "language": "vi", "seconds": 1.4, "audio_s": 6.3, "model": "turbo"}
          {"id": 1, "ok": false, "error": "..."}
Nothing leaves this Mac: faster-whisper on CPU (int8). The main model stays loaded between turns; a clip longer than
LONG_AFTER seconds goes to the fast model, decoded greedily, instead (measured: 75 s of speech takes turbo ~25 s, small ~10 s;
a short clip costs turbo 6-8 s, small 2-3 s, mostly the fixed 30 s window), so a 2-minute recording still ends inside the server's 60 s.
Install (once): uv venv --python 3.12 ~/.risu-lan/stt-venv && uv pip install --python ~/.risu-lan/stt-venv/bin/python faster-whisper "av<17"
(faster-whisper 1.2.1 breaks on PyAV 19: av.open() lost the metadata_errors argument.) Models download on first use (~1.6 GB turbo).
Usage: stt_worker.py <main model> [<fast model> [<long_after seconds>]]
"""
import json
import sys
import time


def reply(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    main_name = sys.argv[1] if len(sys.argv) > 1 else "turbo"
    fast_name = sys.argv[2] if len(sys.argv) > 2 else "small"
    long_after = float(sys.argv[3]) if len(sys.argv) > 3 else 60.0
    t0 = time.time()
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio

    models = {}

    def get(name):
        if name not in models:
            models[name] = WhisperModel(name, device="cpu", compute_type="int8")
        return models[name]

    get(main_name)
    get(fast_name)   # also decides the language of every clip (see below), so it is loaded before the first one
    reply({"ready": True, "model": main_name, "load_s": round(time.time() - t0, 2)})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            t1 = time.time()
            audio = decode_audio(req["path"], sampling_rate=16000)
            audio_s = len(audio) / 16000.0
            name = fast_name if audio_s > long_after else main_name
            model = get(name)
            lang = req.get("language")
            if not lang or lang == "auto":
                # Vietnamese or English only: the owner plays Vietnamese cards but sometimes speaks English; letting Whisper
                # pick among all 99 languages sends a short, accented Vietnamese clip to Thai or Chinese now and then.
                # (the fast model decides: detection is one more encoder pass, ~1 s on small against ~4 s on turbo)
                _, _, probs = get(fast_name).detect_language(audio)
                p = dict(probs)
                lang = "en" if p.get("en", 0.0) > p.get("vi", 0.0) else "vi"
            segments, info = model.transcribe(
                audio,
                language=lang,
                beam_size=1 if audio_s > long_after else 5,   # a long clip must still finish in time: greedy decoding, about twice as fast
                vad_filter=True,
                condition_on_previous_text=False,
                # the default 2.4 reads ordinary Vietnamese (short syllables, repeated sounds) as a loop and re-decodes the window up
                # to six times (25 s instead of 2 s, measured); a real loop compresses far beyond 3.5
                compression_ratio_threshold=3.5,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            reply({"id": rid, "ok": True, "text": text, "language": info.language,
                   "seconds": round(time.time() - t1, 2), "audio_s": round(audio_s, 1), "model": name})
        except Exception as e:  # one bad clip must not kill the worker
            reply({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
