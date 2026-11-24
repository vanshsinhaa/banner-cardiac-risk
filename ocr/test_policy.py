"""
Checks for the unknown-text policy in pipeline.py, using made-up text. No OCR needed.
Run from the repo root with the venv active:   python -m ocr.test_policy
"""
import sys

from PIL import Image

from .pipeline import PrivacyError, has_unknown_text, identifying_rows, read_words

def row(text, conf=0.9):
    return {"text": text, "box": [0, 0, 100, 20], "conf": conf}


def test_lead_labels_run_together_are_allowed():
    for text in ["I II III aVR aVL aVF", "V1V2V3V4", "i.avl..", "IIaVL", "aVF V1"]:
        assert not has_unknown_text(text), text


def test_words_and_names_still_block():
    for text in ["Jane", "Speed", "Smith 1234", "Aaaaaaa Aaaaaaaa"]:
        assert has_unknown_text(text), text


def test_short_text_does_not_block():
    # fewer than 4 letters/digits cannot hold a name, date or ID number (a deliberate trade-off)
    for text in ["B1", "60", "ab", "---"]:
        assert not has_unknown_text(text), text


def test_identifying_rows_blocks_unknown_text_when_strict():
    try:
        identifying_rows([row("Jane Testcase")])
    except PrivacyError as error:
        assert error.code == "uncertain_text"
    else:
        raise AssertionError("expected a PrivacyError")


def test_identifying_rows_never_blocks_in_hint_mode():
    rows = identifying_rows([row("Jane Testcase"), row("MRN: 1234567")], strict=False)
    assert any(r["identifying"] for r in rows)          # the identifying row is still reported


def test_lead_label_row_passes_strict_check():
    rows = identifying_rows([row("I II III aVR aVL aVF")])
    assert not any(r["identifying"] for r in rows)

def test_unsure_word_that_cannot_be_read_on_a_closer_look_is_skipped():
    image = Image.new("RGB", (200, 100), "white")
    unsure = {"text": "AAAA", "box": [10, 10, 60, 30], "conf": 0.47}
    sizes = []

    def run(img):
        sizes.append(img.size)
        return [unsure] if len(sizes) == 1 else []     # first look: unsure; closer look: nothing readable

    assert read_words(run, image) == []
    assert len(sizes) == 2 and sizes[1][0] > 60        # the second look was an enlarged crop


def test_unsure_word_that_reads_clearly_on_a_closer_look_blocks():
    image = Image.new("RGB", (200, 100), "white")
    unsure = {"text": "AAAA", "box": [10, 10, 60, 30], "conf": 0.47}
    calls = []

    def run(img):
        calls.append(1)
        if len(calls) == 1:
            return [unsure]
        return [{"text": "Smith", "box": [0, 0, 40, 10], "conf": 0.9}]   # clearly readable text

    try:
        read_words(run, image)
    except PrivacyError as error:
        assert error.code == "uncertain_text"
    else:
        raise AssertionError("expected a PrivacyError")

if __name__ == "__main__":
    failures = 0
    for name, function in sorted(globals().items()):
        if name.startswith("test_") and callable(function):
            try:
                function()
                print("PASS", name)
            except Exception:
                failures += 1
                print("FAIL", name)
    print("ALL CHECKS PASSED" if not failures else f"{failures} CHECK(S) FAILED")
    sys.exit(1 if failures else 0)