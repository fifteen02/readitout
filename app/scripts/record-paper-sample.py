"""Record the public sample locally. Sentence boundaries come from PCM sample counts."""
import json, pathlib, subprocess, tempfile, wave
ROOT = pathlib.Path(__file__).resolve().parents[1]
SENTENCES = [
    "The lighthouse had been dark for eleven years before Mira decided it was her problem.",
    "She had walked past it every morning of that time, and every morning it had looked back at her with the same patient indifference, and somewhere in the eleventh winter the arrangement stopped feeling neutral.",
    "Her father would have called this a symptom.",
    "He had a whole vocabulary for the things people did instead of sleeping, instead of eating, instead of speaking to one another about the thing that had actually happened.",
    "Mira had inherited the vocabulary and almost none of the discipline that was supposed to come with it."
]
voices = []
with tempfile.TemporaryDirectory() as tmp:
    tmp = pathlib.Path(tmp)
    for name in ['Samantha', 'Daniel']:
        frames, cues, offset = [], [], 0
        for index, text in enumerate(SENTENCES):
            aiff, wav = tmp / 'part.aiff', tmp / 'part.wav'
            subprocess.run(['say', '-v', name, '-r', '165', '-o', str(aiff), text], check=True)
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(aiff), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True)
            with wave.open(str(wav), 'rb') as clip:
                data = clip.readframes(clip.getnframes())
            count = len(data) // 2
            cues.append({'text': text, 'start': offset / 24000, 'end': (offset + count) / 24000, 'paragraph': 0 if index < 2 else 1})
            frames.append(data)
            offset += count
        joined = tmp / 'joined.wav'
        with wave.open(str(joined), 'wb') as out:
            out.setnchannels(1); out.setsampwidth(2); out.setframerate(24000)
            out.writeframes(b''.join(frames))
        filename = f'paper-sample-{name.lower()}.mp3'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(joined), '-c:a', 'libmp3lame', '-q:a', '3', str(ROOT / 'public' / filename)], check=True)
        voices.append({'name': name, 'file': '/' + filename, 'duration': offset / 24000, 'sentences': cues})
(ROOT / 'public' / 'paper-sample.json').write_text(json.dumps({'title':'The Quiet Hour', 'text':' '.join(SENTENCES), 'voices':voices, 'timingSource':'Sentence clips concatenated as PCM; offsets measured in audio samples.'}, indent=2) + '\n')
print('Recorded two sample voices with five measured sentence boundaries each.')
