#!/usr/bin/env python3
"""Generate ligature-mismatch.pdf — a minimal PDF that reproduces the
pdf-extract 0.7.x stdout spam (openspec change fix-pdf-extract-log-spam).

The font's /Differences array declares glyph name f_f_i at code 0x01
(glyphnames maps f_f_i -> U+FB03 "ffi ligature"), while the /ToUnicode CMap
maps 0x01 -> "ffi" (three ASCII chars). pdf-extract 0.7.x hits the Occupied
branch where the two disagree and unconditionally prints
    Unicode mismatch true f_f_i "ffi" Ok("\\ufb03") [64257]
once per extracted glyph occurrence. Regenerate with:
    python3 make-ligature-mismatch.py
"""

import zlib

PAGES = 1
# \x01 renders via the Differences-declared f_f_i glyph.
CONTENT = rb"BT /F1 16 Tf 72 720 Td (O\x01ce sta\x01 shu\x01ed f\x01les e\x01ently) Tj ET"

TOUNICODE = b"""/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <ff>
endcodespacerange
1 beginbfrange
<01> <01> [<006600660069>]
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end
"""


def build() -> bytes:
    content = zlib.compress(CONTENT)
    to_unicode = zlib.compress(TOUNICODE)

    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count %d >>" % PAGES,
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
        # Type1 base font whose Differences name conflicts with its ToUnicode.
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        b"/Encoding << /Type /Encoding /Differences [1 /f_f_i] >> "
        b"/ToUnicode 5 0 R >>",
        b"<< /Length %d /Filter /FlateDecode >>\nstream\n%s\nendstream"
        % (len(to_unicode), to_unicode),
        b"<< /Length %d /Filter /FlateDecode >>\nstream\n%s\nendstream"
        % (len(content), content),
    ]

    out = bytearray(b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for num, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % num + body + b"\nendobj\n"
    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += b"%010d 00000 n \n" % off
    out += (
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, xref_at)
    )
    return bytes(out)


if __name__ == "__main__":
    with open(__file__.rsplit("/", 1)[0] + "/ligature-mismatch.pdf", "wb") as f:
        f.write(build())
    print("wrote ligature-mismatch.pdf")
