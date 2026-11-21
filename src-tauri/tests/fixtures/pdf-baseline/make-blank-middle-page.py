#!/usr/bin/env python3
"""Generate a three-page PDF with an empty physical page between text pages."""

from pathlib import Path

from pdf_fixture_writer import build_pdf, stream


def text_stream(text: bytes) -> bytes:
    return stream(b"BT /F1 24 Tf 42 110 Td (%s) Tj ET" % text)


def build() -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 "
        b"/MediaBox [0 0 360 200] /Resources << /Font << /F1 6 0 R >> >> >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>",
        b"<< /Type /Page /Parent 2 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 8 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        text_stream(b"First physical page"),
        text_stream(b"Third physical page"),
    ]

    return build_pdf(objects)


if __name__ == "__main__":
    Path(__file__).with_name("blank-middle-page.pdf").write_bytes(build())
