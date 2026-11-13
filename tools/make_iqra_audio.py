"""Make the Iqra card audio files in iqra/audio/.

Ordinary text-to-speech reads a lone letter by its name ("baa'" for بَ) and drops
the last vowel of a word ("katab" for كَتَبَ). This script turns each card's Arabic
(with harakat) into the exact sounds Iqra teaches, then speaks them with the
Piper voice ar_JO-SA_dii-high.

Setup (once):
    pip install piper-tts numpy
    # also needs node and ffmpeg
    curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-ar_JO-SA_dii-high.tar.bz2
    tar xjf vits-piper-ar_JO-SA_dii-high.tar.bz2

Run from the repository root:
    python3 tools/make_iqra_audio.py vits-piper-ar_JO-SA_dii-high/ar_JO-SA_dii-high.onnx
Add --print to only show the sounds for each card.
"""
import json, os, subprocess, sys, tempfile, wave

FATHA, KASRA, DAMMA, SUKUN, SHADDA = "َ", "ِ", "ُ", "ْ", "ّ"
TAN_F, TAN_K, TAN_D, DAGGER = "ً", "ٍ", "ٌ", "ٰ"
HARAKAT = {FATHA, KASRA, DAMMA, SUKUN, SHADDA, TAN_F, TAN_K, TAN_D, DAGGER}

CONS = {
    "ء": "ʔ", "أ": "ʔ", "إ": "ʔ", "ؤ": "ʔ", "ئ": "ʔ",
    "ب": "b", "ت": "t", "ث": "θ", "ج": "dʒ", "ح": "ħ", "خ": "χ", "د": "d",
    "ذ": "ð", "ر": "r", "ز": "z", "س": "s", "ش": "ʃ", "ص": "s̪", "ض": "dˤ",
    "ط": "t̪", "ظ": "ð", "ع": "ʕ", "غ": "ɣ", "ف": "f", "ق": "q", "ك": "k",
    "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "j", "ة": "t",
}
# Letters espeak marks with a "dark" (emphatic) vowel
HEAVY = set("صضطظق")
SUN = set("تثدذرزسشصضطظلن")


def letters(word):
    """Split a word into [letter, set_of_marks] items."""
    out = []
    for ch in word:
        if ch in HARAKAT and out:
            out[-1][1].append(ch)
        else:
            out.append([ch, []])
    return out


def word_to_phonemes(word):
    L = letters(word)
    ph = []
    i = 0
    # Definite article al- at the start
    if len(L) >= 3 and L[0][0] == "ا" and L[1][0] == "ل" and SUKUN not in L[1][1] and SHADDA in L[2][1] and L[2][0] in SUN:
        ph.append("ʔa")          # al + sun letter: the l is silent, next letter doubled
        i = 2
    elif len(L) >= 2 and L[0][0] == "ا" and L[1][0] == "ل" and SUKUN in L[1][1]:
        ph.append("ʔal")         # al + moon letter
        i = 2
    while i < len(L):
        ch, marks = L[i]
        nxt = L[i + 1] if i + 1 < len(L) else None
        if ch == "ا":
            if i == 0:                       # alif carrying a vowel at the start = hamza
                ph.append("ʔ")
                v = {FATHA: "a", KASRA: "i", DAMMA: "u"}.get(next((m for m in marks if m in (FATHA, KASRA, DAMMA)), None), "a")
                ph.append(v)
            i += 1                           # otherwise it is a mad / tanwin seat (handled before)
            continue
        c = CONS.get(ch)
        if c is None:
            i += 1
            continue
        # Mad letters: و / ي with no mark after the matching vowel
        prev_vowel = ph[-1] if ph else ""
        if ch == "و" and not marks and prev_vowel == "u":
            ph[-1] = "uː"; i += 1; continue
        if ch == "ي" and not marks and prev_vowel == "i":
            ph[-1] = "iː"; i += 1; continue
        if ch == "ل" and not marks and nxt and SHADDA in nxt[1] and nxt[0] == "ل":
            i += 1; continue                 # the silent lam in allaah
        ph.append(c + c if SHADDA in marks else c)
        heavy = "." if ch in HEAVY else ""
        if DAGGER in marks:
            ph.append("a" + heavy + "ː")
        elif FATHA in marks:
            if nxt and nxt[0] == "ا" and not nxt[1]:
                ph.append("a" + heavy + "ː")
            else:
                ph.append("a" + heavy)
        elif KASRA in marks:
            ph.append("i")
        elif DAMMA in marks:
            ph.append("u")
        elif TAN_F in marks:
            ph.append("a" + heavy + "n")
        elif TAN_K in marks:
            ph.append("in")
        elif TAN_D in marks:
            ph.append("un")
        i += 1
    return ph


def stress(ph):
    """Put the stress mark on the first vowel-bearing chunk."""
    out = []
    done = False
    for p in ph:
        if not done and p[0] in "aiu":
            out.append("ˈ" + p); done = True
        else:
            out.append(p)
    return "".join(out)


def phonemes(text):
    return " ".join(stress(word_to_phonemes(w)) for w in text.split())



def load_cards():
    """Read the Iqra cards (not the surahs) out of iqra/index.html."""
    js = r"""
const h = require("fs").readFileSync("iqra/index.html", "utf8");
eval(h.slice(h.indexOf("const DECKS ="), h.indexOf("// Qari recitation")).replace("const DECKS", "global.DECKS"));
const out = [];
DECKS.filter(d => !d.surah).forEach(d => d.cards.forEach((c, i) => out.push({ id: d.id + "-" + i, ar: c[0], rumi: c[1] })));
console.log(JSON.stringify(out));
"""
    return json.loads(subprocess.check_output(["node", "-e", js]))


if __name__ == "__main__":
    only_print = "--print" in sys.argv
    cards = load_cards()
    if only_print:
        for c in cards:
            print(c["id"], c["rumi"], "|", phonemes(c["ar"]))
        sys.exit()

    import numpy as np
    from piper.voice import PiperVoice
    from piper.config import SynthesisConfig
    voice = PiperVoice.load(sys.argv[1])
    cfg = SynthesisConfig(length_scale=1.25, noise_scale=0.5, noise_w_scale=0.6)
    os.makedirs("iqra/audio", exist_ok=True)
    rate = voice.config.sample_rate
    with tempfile.TemporaryDirectory() as tmp:
        for c in cards:
            p = phonemes(c["ar"])
            print(c["id"], c["rumi"], "|", p)
            audio = voice.phoneme_ids_to_audio(voice.phonemes_to_ids(list(p)), cfg)
            pcm = (audio * 32767).clip(-32768, 32767).astype("int16")
            pad = np.zeros(int(rate * 0.15), dtype="int16")   # so phones don't clip the start
            pcm = np.concatenate([pad, pcm, pad])
            wav = os.path.join(tmp, "a.wav")
            with wave.open(wav, "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
                w.writeframes(pcm.tobytes())
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav,
                            "-af", "loudnorm=I=-16:TP=-1.5", "-ar", "22050", "-ac", "1", "-b:a", "48k",
                            "iqra/audio/" + c["id"] + ".mp3"], check=True)
