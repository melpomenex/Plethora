# Mobile PDF verification corpus

Keep copyrighted PDFs out of the repository. Before mobile PDF device QA, place
local files with these stable names in this directory (they remain ignored):

| File | Required characteristics |
| --- | --- |
| `single-column.pdf` | Tagged or selectable prose with headings and links |
| `multi-column.pdf` | Two-column academic paper with repeated header/footer |
| `tables-figures.pdf` | Tables, images, captions, footnotes, and equations |
| `rtl.pdf` | Selectable Arabic or Hebrew with right-to-left reading order |
| `scanned.pdf` | Image-only pages with no text layer |
| `mixed.pdf` | Alternating selectable and scanned pages |
| `encrypted.pdf` | User-password protected; record password in local QA notes only |
| `malformed.pdf` | Truncated/corrupt file that parsing must reject safely |
| `large.pdf` | More than 64 MiB, preferably more than 250 pages |

Automated tests use small synthetic byte fixtures and mocked PDF.js page data.
Device QA must record device model/OS, file size bucket, initial mode, time to
first page, time to first reflow content, and normalized failure category. Never
record filenames, paths, extracted text, passwords, or page images in telemetry.

