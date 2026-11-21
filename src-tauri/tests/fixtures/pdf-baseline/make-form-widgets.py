#!/usr/bin/env python3
"""Generate a fillable first page and enough blank pages for virtualization."""

from pathlib import Path

from pdf_fixture_writer import build_pdf, stream


def appearance(content: bytes) -> bytes:
    return (
        b"<< /Type /XObject /Subtype /Form /BBox [0 0 18 18] /Length %d >>\n"
        b"stream\n%s\nendstream" % (len(content), content)
    )


def build() -> bytes:
    # Thirteen pages exceed the reader's continuous-scroll virtualization threshold.
    leaf_pages = b" ".join(b"%d 0 R" % number for number in [3, *range(11, 23)])
    return build_pdf([
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm 4 0 R >>",
        b"<< /Type /Pages /Kids [%s] /Count 13 "
        b"/MediaBox [0 0 420 260] /Resources << /Font << /Helv 5 0 R >> >> >>" % leaf_pages,
        b"<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Annots [7 0 R 8 0 R] >>",
        b"<< /Fields [7 0 R 8 0 R] /DA (/Helv 14 Tf 0 g) "
        b"/DR << /Font << /Helv 5 0 R >> >> >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream(
            b"BT /Helv 24 Tf 42 218 Td (Fillable PDF) Tj ET\n"
            b"BT /Helv 16 Tf 42 166 Td (Name) Tj ET\n"
            b"BT /Helv 16 Tf 71 91 Td (Review complete) Tj ET"
        ),
        b"<< /Type /Annot /Subtype /Widget /P 3 0 R /Rect [42 123 285 155] "
        b"/FT /Tx /T (Name) /TU (Name) /V (Initial name) /DA (/Helv 14 Tf 0 g) /F 4 >>",
        b"<< /Type /Annot /Subtype /Widget /P 3 0 R /Rect [42 87 60 105] "
        b"/FT /Btn /T (Review complete) /TU (Review complete) "
        b"/V /Off /AS /Off /AP << /N << /Off 9 0 R /Yes 10 0 R >> >> /F 4 >>",
        appearance(b"0.75 w 0.5 0.5 17 17 re S"),
        appearance(b"0.75 w 0.5 0.5 17 17 re S 1.5 w 4 9 m 8 5 l 14 13 l S"),
        *[b"<< /Type /Page /Parent 2 0 R >>"] * 12,
    ])


if __name__ == "__main__":
    Path(__file__).with_name("form-widgets.pdf").write_bytes(build())
