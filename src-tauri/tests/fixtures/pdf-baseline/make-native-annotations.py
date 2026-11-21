#!/usr/bin/env python3
"""Generate a PDF for native link navigation and sticky note display tests."""

from pathlib import Path

from pdf_fixture_writer import build_pdf, stream


def build() -> bytes:
    return build_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 "
        b"/MediaBox [0 0 420 260] /Resources << /Font << /F1 6 0 R >> >> >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 7 0 R /Annots [10 0 R 11 0 R 12 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 8 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 9 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        stream(
            b"BT /F1 24 Tf 42 218 Td (Native PDF annotations) Tj ET\n"
            b"BT /F1 16 Tf 42 170 Td (Go to page 3) Tj ET\n"
            b"BT /F1 16 Tf 42 126 Td (Open example.com) Tj ET\n"
            b"BT /F1 16 Tf 76 82 Td (Embedded note) Tj ET"
        ),
        stream(b"BT /F1 24 Tf 42 218 Td (Second physical page) Tj ET"),
        stream(b"BT /F1 24 Tf 42 218 Td (Third physical page) Tj ET"),
        b"<< /Type /Annot /Subtype /Link /Rect [40 165 145 189] "
        b"/Border [0 0 1] /Dest [5 0 R /Fit] >>",
        b"<< /Type /Annot /Subtype /Link /Rect [40 121 182 145] "
        b"/Border [0 0 1] /A << /S /URI /URI (https://example.com/) >> >>",
        b"<< /Type /Annot /Subtype /Text /Rect [42 77 66 101] "
        b"/T (Fixture author) /Contents (This note is embedded in the PDF.) "
        b"/Name /Note /C [1 1 0] /Open false /F 4 >>",
    ])


if __name__ == "__main__":
    Path(__file__).with_name("native-annotations.pdf").write_bytes(build())
