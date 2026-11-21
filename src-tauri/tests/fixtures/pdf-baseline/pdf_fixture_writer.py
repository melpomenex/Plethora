"""Write deterministic PDF fixtures with a classic cross-reference table."""


def stream(content: bytes) -> bytes:
    return b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content)


def build_pdf(objects: list[bytes]) -> bytes:
    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += b"%d 0 obj\n%s\nendobj\n" % (number, body)

    xref_offset = len(pdf)
    object_count = len(objects) + 1
    pdf += b"xref\n0 %d\n0000000000 65535 f \n" % object_count
    for offset in offsets:
        pdf += b"%010d 00000 n \n" % offset
    pdf += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        object_count,
        xref_offset,
    )
    return bytes(pdf)
