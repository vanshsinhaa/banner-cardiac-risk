"""Draws fake EKG-style test images. No real patient data."""

import io
import math

from PIL import Image, ImageDraw


def synthetic_ekg_like_image(fmt: str, width: int = 600, height: int = 300) -> bytes:
    """Draw a fake EKG-style picture: pink grid plus a made-up wave.

    The wave is a sine curve with spikes. It is not a real heart signal.
    """
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 10):
        draw.line([(x, 0), (x, height)], fill=(255, 200, 200) if x % 50 else (240, 120, 120))
    for y in range(0, height, 10):
        draw.line([(0, y), (width, y)], fill=(255, 200, 200) if y % 50 else (240, 120, 120))
    points = []
    for x in range(width):
        y = height / 2 - 20 * math.sin(x / 15)
        if x % 120 == 60:
            y -= 80  # a sharp spike, loosely like a QRS peak
        points.append((x, y))
    draw.line(points, fill="black", width=2)

    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()
