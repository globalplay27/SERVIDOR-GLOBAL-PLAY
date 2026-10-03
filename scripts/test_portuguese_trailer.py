import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import verify_portuguese_trailer as verifier

class VerificationTests(unittest.TestCase):
    def check(self, languages, patch_info=None):
        info = {'title':'Reacher Trailer oficial dublado', 'channel':'Prime Video Brasil', 'channel_is_verified':True}
        info.update(patch_info or {})
        probabilities = iter(languages)
        model = SimpleNamespace(device='cpu',detect_language=lambda mel: (None,next(probabilities)))
        fake = SimpleNamespace(load_audio=lambda path:[0]*16000*100,load_model=lambda *a,**kw:model,pad_or_trim=lambda a:a,log_mel_spectrogram=lambda a:SimpleNamespace(to=lambda device:None))
        def reject(code): raise ValueError(code)
        with tempfile.TemporaryDirectory() as directory:
            filename=Path(directory)/'info.json'
            filename.write_text(json.dumps(info),encoding='utf-8')
            with patch.dict('sys.modules',{'whisper':fake}),patch.object(verifier,'reject',reject):
                verifier.verify(filename,'source.mp4')

    def test_portuguese_speech_passes(self):
        self.check([{'pt':.9,'en':.1}]*3)

    def test_english_speech_with_dubbed_title_fails(self):
        with self.assertRaisesRegex(ValueError,'trailer_not_portuguese'):
            self.check([{'en':.95,'pt':.05}]*3)

    def test_unverified_and_imitation_channels_fail(self):
        for info in [{'channel_is_verified':False},{'channel':'Prime Video Brasil Fan Trailers'}]:
            with self.assertRaisesRegex(ValueError,'trailer_not_official'):
                self.check([],info)

    def test_subtitled_rejected_before_audio_check(self):
        with self.assertRaisesRegex(ValueError,'trailer_not_portuguese'):
            self.check([],{'title':'Reacher Trailer legendado'})

if __name__=='__main__': unittest.main()
