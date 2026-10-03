"""Fail closed: verified distributor channel and Portuguese speech required."""
import json
import re
import sys
import unicodedata
from pathlib import Path

def clean(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c)).lower()

def reject(code):
    Path('/tmp/nexus-render-error.txt').write_text(code)
    raise SystemExit(code)

def verify(info_path, source):
    info = json.loads(Path(info_path).read_text(encoding='utf-8'))
    title, channel = clean(info.get('title')), clean(info.get('channel') or info.get('uploader'))
    studio = re.fullmatch(r'(?:amazon )?(?:prime video|netflix|warner bros\.? pictures|warner play|universal pictures|paramount pictures|sony pictures|disney|disney studios|20th century studios|diamond films|paris filmes|imagem filmes|hbo|max|globoplay|lionsgate|mubi)(?: brasil| brazil| br)?', channel)
    official_identity = info.get('channel_is_verified') or info.get('channel_id') == 'UCuNjvqjTzw9LcD9PVpTVWRA'
    if not studio or not official_identity or 'trailer' not in title:
        reject('trailer_not_official')
    if re.search(r'legendad|subtitled|english|ingles', title):
        reject('trailer_not_portuguese')
    import whisper
    audio = whisper.load_audio(source)
    model = whisper.load_model('tiny', device='cpu')
    votes = []
    for fraction in (.15, .4, .65):
        offset = int(len(audio) * fraction)
        sample = whisper.pad_or_trim(audio[offset:offset + 30 * 16000])
        mel = whisper.log_mel_spectrogram(sample).to(model.device)
        _, probabilities = model.detect_language(mel)
        votes.append(max(probabilities, key=probabilities.get) == 'pt' and probabilities.get('pt', 0) >= .6)
    if sum(votes) < 2:
        reject('trailer_not_portuguese')
    print('Verified official trailer with Portuguese speech.')

if __name__ == '__main__':
    verify(sys.argv[1], sys.argv[2])
