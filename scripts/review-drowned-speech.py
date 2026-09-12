"""Local ASR evidence, not a human listening or lip-sync certification.

Run in work/audio-review-venv; no audio leaves this computer.
The model is downloaded once to the project-local cache.
"""
import json
import sys
from faster_whisper import WhisperModel

model = WhisperModel("base.en", device="cpu", compute_type="int8", download_root="work/speech-models")
for filename in sys.argv[1:]:
    segments, info = model.transcribe(filename, language="en", beam_size=5, vad_filter=True, condition_on_previous_text=False)
    result = {"file": filename, "method": "faster-whisper base.en; no prompt or expected dialogue supplied", "segments": [
        {"start": s.start, "end": s.end, "text": s.text.strip(), "avg_logprob": s.avg_logprob}
        for s in segments
    ]}
    print(json.dumps(result), flush=True)
