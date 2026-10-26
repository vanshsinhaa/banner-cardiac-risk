"""Shared synthetic metadata fixtures; no patient data."""

import io
import struct

from PIL import Image, PngImagePlugin

from tests.synthetic import synthetic_ekg_like_image

MARKER = "SYNTHETIC-PRIVACY-TEST-ONLY"


def png_chunks(data):
    offset = 8
    names = []
    while offset < len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        names.append(data[offset + 4:offset + 8])
        offset += 12 + size
    assert offset == len(data), "Trailing data survived"
    return names


def tagged_image(fmt="PNG", orientation=1):
    with Image.open(io.BytesIO(synthetic_ekg_like_image("PNG", 60, 30))) as image:
        exif = Image.Exif()
        exif[0x010E] = MARKER  # description / synthetic patient name
        exif[0x010F] = MARKER  # device make
        exif[0x0132] = "2000:01:01 00:00:00"
        exif[0x0112] = orientation
        exif[0x8825] = {1: "N", 2: (1.0, 2.0, 3.0), 3: "E", 4: (4.0, 5.0, 6.0)}
        text = PngImagePlugin.PngInfo()
        text.add_text("PatientName", MARKER)
        text.add_text("Comment", MARKER, zip=True)
        text.add_itxt("XML:com.adobe.xmp", f"<xmp>{MARKER}</xmp>")
        result = io.BytesIO()
        image.save(result, format=fmt, exif=exif, icc_profile=MARKER.encode(),
                   pnginfo=text, xmp=f"<xmp>{MARKER}</xmp>".encode())
        data = result.getvalue()
    if fmt == "JPEG":
        # IIM object-name dataset in a Photoshop APP13 resource block.
        iim = b"\x1c\x02\x05" + struct.pack(">H", len(MARKER)) + MARKER.encode()
        iptc = b"Photoshop 3.0\0" + b"8BIM\x04\x04\0\0" + struct.pack(">I", len(iim)) + iim
        if len(iim) % 2:
            iptc += b"\0"
        for tag, payload in [(b"\xfe", MARKER.encode()), (b"\xed", iptc),
                             (b"\xe1", b"http://ns.adobe.com/xap/1.0/\0" + MARKER.encode())]:
            data = data[:2] + b"\xff" + tag + struct.pack(">H", len(payload) + 2) + payload + data[2:]
    return data + MARKER.encode()  # trailing bytes must not be copied
