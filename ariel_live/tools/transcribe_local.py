"""Persistent offline ASR worker; JSON lines over stdin/stdout, no API keys/network."""
import base64
import io
import json
import os
import sys

# Node writes UTF-8 JSON to the pipe. Windows' locale default can otherwise
# corrupt the Hebrew prompt before it reaches the tokenizer.
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
from faster_whisper import WhisperModel

model = WhisperModel(sys.argv[1], device='cpu', compute_type='int8',
                     cpu_threads=4, local_files_only=True)
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        audio = io.BytesIO(base64.b64decode(request['b64'], validate=True))
        language = request.get('language')
        if language not in ('he', 'en'):
            language = None
        prompt = str(request.get('initialPrompt') or '')[:250] or None
        segments, info = model.transcribe(audio, beam_size=3, vad_filter=True,
                                         condition_on_previous_text=False,
                                         language=language, initial_prompt=prompt)
        lines = [{'who': 'UNKNOWN', 'text': s.text.strip(),
                  'start': s.start, 'end': s.end, 'avgLogprob': s.avg_logprob,
                  'noSpeechProb': s.no_speech_prob}
                 for s in segments if s.text.strip()]
        result = {'id': request['id'], 'lines': lines, 'language': info.language,
                  'languageProbability': info.language_probability}
    except Exception as exc:
        result = {'id': request.get('id'), 'error': type(exc).__name__, 'detail': str(exc)[:300]}
    print(json.dumps(result, ensure_ascii=True), flush=True)
