"""Pin the image-corruption failure class for MMS media.

Welcorp fetches the MMS media URL on their side and decodes it; if the bytes
are a truncated/corrupt image the send fails there. E2E runs against mock
storage and a mock SMS provider, so it cannot surface a corrupt-image upload.
This test pins the decode invariant directly: a structurally valid JPEG decodes
cleanly, while a truncated one raises when Pillow is forced to read all pixels
(Image.open() is lazy — the corruption only surfaces on .load()).

Skipped if Pillow is not installed (it is the decoder Welcorp uses server-side).
"""
import io

import pytest

# Pillow is the reference decoder; skip cleanly where it is not installed.
Image = pytest.importorskip('PIL.Image')
UnidentifiedImageError = pytest.importorskip('PIL').UnidentifiedImageError


def _make_valid_jpeg_bytes() -> bytes:
    """Return the bytes of a small, structurally valid JPEG."""
    buf = io.BytesIO()
    Image.new('RGB', (32, 32), color=(120, 200, 80)).save(buf, format='JPEG')
    return buf.getvalue()


def test_valid_jpeg_decodes_cleanly():
    data = _make_valid_jpeg_bytes()

    img = Image.open(io.BytesIO(data))
    # .load() forces a full decode of every pixel — the real validation.
    img.load()

    assert img.format == 'JPEG'
    assert img.size == (32, 32)


def test_truncated_jpeg_fails_to_decode():
    valid = _make_valid_jpeg_bytes()
    # Keep the JPEG SOI/header (so it is still recognised as a JPEG) but lop off
    # the scan data and EOI marker — a classic truncated/corrupt MMS upload.
    truncated = valid[: len(valid) // 2]

    img = Image.open(io.BytesIO(truncated))
    # open() is lazy and succeeds on the header; the corruption only surfaces
    # when the (missing) pixel data is actually read.
    with pytest.raises((OSError, SyntaxError)):
        img.load()


def test_non_image_bytes_are_rejected():
    """Garbage that is not an image at all is rejected at open() time."""
    not_an_image = io.BytesIO(b'this is plainly not an image payload')

    with pytest.raises(UnidentifiedImageError):
        Image.open(not_an_image).load()
