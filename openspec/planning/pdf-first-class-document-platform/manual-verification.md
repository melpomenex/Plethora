# Manual PDF verification

Use a test library with synthetic documents. Run the reader checks on desktop and on a touch device. Run Study Plans in a native build. Record the app commit, OS and version, runtime, device, fixture path and hash, page and quote expected, actual outcome, and evidence location. Include the OCR or Assistant provider type, without credentials, when it affects the result. Classify each case as pass, fail, blocked, or unrun.

The walkthrough names controls present in the reader source. Use the [implementation status](status.json) to identify which acceptance criteria the current build is ready to exercise.

## Fixtures

| Fixture | Use |
| --- | --- |
| `src-tauri/tests/fixtures/pdf-baseline/simple-text.pdf` | Native open, selection, and baseline search |
| `src-tauri/tests/fixtures/pdf-baseline/blank-middle-page.pdf` | Page order, blank page 2, physical page 3 search, and copy/export |
| `src-tauri/tests/fixtures/pdf-baseline/native-annotations.pdf` | Internal link to page 3, external-link attributes and embedded note |
| `src-tauri/tests/fixtures/pdf-baseline/form-widgets.pdf` | Editable text and checkbox remount within one open PDF |
| `src-tauri/tests/fixtures/pdf-reflow/02-two-column.pdf` | Two-column reading order and source return |
| `src-tauri/tests/fixtures/pdf-reflow/09-multi-page-paragraph.pdf` | Selection across a page break and reflow continuity |
| `src-tauri/tests/fixtures/pdf-reflow/12-rotated.pdf` | Navigation and selection on rotated pages |
| `src-tauri/tests/fixtures/documents/pdf/truncated.pdf` | Import failure and reader recovery |

For a scanned fixture, render a page with a large unique phrase such as “Orchid sample seven” to a raster image, then print the image to a new local PDF. Confirm that `pdftotext scanned.pdf -` contains no phrase before importing. Use fixture PDFs with known labels, destinations, widgets, and markup for the corresponding reader checks. Confirm their contents in an independent viewer first.

Some historical reflow fixtures emit recoverable parser warnings. Use them to check rendering tolerance and geometry. Use the clean baseline files where a structural validation pass is required.

## Reader workflow

1. In **Documents**, choose **Import Document** and open the imported test PDF. Confirm that the first Original page becomes readable while analysis is still pending. Open the truncated fixture separately and verify that the failure leaves the working document readable.
2. On the three-page fixture, use **Next Page**, **Previous Page**, and **Go to page**. Jump to physical page 3 and confirm the text “Third physical page”. Search for that text through **Search in document** and follow the match. Scroll back through blank page 2 and verify that neither the page indicator nor the next result skips its physical position.
3. With a populated outline, open **Toggle Table of Contents** and select a nested entry. With a fixture that has embedded links, activate its internal link by pointer and keyboard and check the destination page and region. Activate an external web link with an approved test URL and confirm that opening happens only after interaction. Where printed labels are available, compare the displayed label with the physical page input and the destination.
4. Use **Fit to Page**, **Fit to Width**, and custom zoom. Reopen the tab and record the restored page, position, and zoom. Repeat with the mobile toolbar, touch scrolling, and pinch zoom. On a large file, record time to first readable page, the number of retained page canvases while scrolling, and behavior after multiple tab switches.
5. In Original view, select a distinct phrase. Use **Highlight** in the selection menu, choose a color if offered, and reopen the PDF. Verify that the same text is marked after reopening and zooming. Try a selection across the page break in continuous reading and compare the saved highlight against both original page regions. Repeat on a rotated page.
6. Open **Reflow** for the column fixture and compare the text sequence with the original columns. Select an identifiable passage and check that **View original**, where offered, leads to its source region. Switch back using **Original** and confirm that the annotation still points to the intended passage. On a fixture with embedded comments or markup, check which annotations and popup contents are available and where they land.

## OCR, Extract, and cloze

1. Open the image-only fixture in Original view. Activate **OCR Select** and drag over the known phrase. Compare the **OCR text preview** against the image and verify that **Retry** and **Close** return control to the reader. Choose **Create Extract** to save a successful result.
2. In Reflow, use **Recognize this page** when the page displays the text-recognition prompt. Verify the same phrase and page. Record separately whether the recognized text can be searched and selected and whether a saved result returns to the exact original region. Repeat with a configured local provider and network disconnected after any required assets are ready.
3. On a native-text PDF, select a passage and choose **Create Extract**. Close the PDF, open the extract from **Extracts**, then use **Back to book** or the source button shown by that surface. Compare the page and selected phrase with the original. Record a page-only jump separately from a correct region jump.
4. On a keyboard build, select text in the document reader and press **Alt+Z**. This shortcut currently uses the extract-to-learning-item path. Confirm that a cloze exists with the expected omitted phrase. When its review surface offers **View source**, confirm that it opens the source PDF at the stored passage. Record direct creation independent of extract processing as a distinct acceptance case.

## Assistant and Study Plans

1. In the PDF reader, open **Assistant** with **This document only** when available. Navigate to a page with a unique phrase and ask what the current section says. Check the answer against that page and follow each citation the build provides. Ask from a text selection via **Ask** and compare the shown excerpt with the selection.
2. Repeat immediately after switching to a different page, then a different PDF. On an image-only page before OCR, ask about the current page. A reader-relative request should wait for applicable text or explain what is needed. Identify the page actually supplied by the prompt or request evidence where this can be inspected locally. Record any answer sourced from a previous page, nearby page, or unrelated fallback.
3. In a native build, open **Study Plans**, choose **Create Study Plan**, and select the test PDF as source material. Use **Source Outline (No AI)** for a local check or **Generate with AI** with an authorized provider for generation coverage. Use a document with enough text for at least two topics and note the expected physical pages and passages.
4. In **Guided Reading**, use **Prepare passages** and **Start Guided Reading** when available. Verify the first passage and a prerequisite passage before choosing **Mark passage complete**. Reopen the plan and check **Continue Reading**. Use **Quick check** or **Assessments** and compare the evidence in feedback with the same page and quote. If a topic has insufficient evidence, record the feedback shown instead of crediting the topic as grounded.

## Copy editing and embedded import/export acceptance

Run each case when the matching operation is available in the build. Record missing operations as unrun. Choose a separate output file and preserve the original test fixture.

On native desktop with the default PDF range source, open `blank-middle-page.pdf`, go to page 3 and choose **Rotate current page in a new PDF**. Save to a new filename. Reopen the copy and inspect page 3 rotation. Confirm pages 1 and 2 retain their rotation, the original hash matches and choosing an existing destination leaves that file intact.

1. Capture the source hash. Reorder the three physical pages as 3, 2, 1, rotate the first output page clockwise, and export a copy. Confirm output pages 1 and 3 contain the mapped source text, page 2 is still blank, and only the selected page has changed rotation. Run the split or range-export case separately and confirm the requested count and order.
2. Author a highlight and a note, then export an annotated copy when supported. Check that an independent reader displays and selects the two annotation objects and shows the note content. Inspect their subtype, page, and rectangles or quads with an independent parser. Reimport the copy into Plethora and repeat the import to check for duplicate annotations where supported.
3. In a form fixture, change one text field and checkbox. Save a filled copy when supported and inspect field values in an independent reader. Reopen the original and compare its fields and bytes with the pre-test state.
4. Test an invalid range and a destination the app cannot write. Confirm an actionable error, no partial output, and unchanged source bytes. If the destination existed before the test, verify that it remains intact.

From a shell with QPDF and Poppler, use these checks alongside the independent reader. Compare the two source hashes before and after each operation. `pdfinfo` reports page rotation and boxes, while the QPDF export JSON allows inspection of page and annotation objects.

```bash
qpdf --check edited.pdf
pdfinfo -f 1 -l 3 -box edited.pdf
pdftotext -f 1 -l 1 edited.pdf -
pdftotext -f 2 -l 2 edited.pdf -
pdftotext -f 3 -l 3 edited.pdf -
qpdf --json edited.pdf > edited-objects.json
shasum -a 256 original.pdf
```
