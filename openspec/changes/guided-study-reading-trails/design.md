## Context

The active Study Plan changes for universal grounding, interactive graphs, adaptive lessons, and examinations already own evidence references, prerequisite order, topic activity, and frozen question revisions. `openStudySource` resolves a citation and launches the document, but a supplied search jump does not acknowledge the rendered passage. EPUB uses an epub.js rendition, PDF exposes page text-layer roots, HTML uses a same-origin sandboxed iframe, and Markdown renders to the reader DOM. The language lexicon SourceAnchor and the selection anchor remain independent.

## Goals

Provide local bounded ranges, honest reader acknowledgments, resumable multi-document reading, objective coverage, and review from a finalized question.

## Decisions

### Version and source authority

A reading manifest belongs to one saved published version. It includes stable assignments, coverage by topic and objective index, and a separate revision token. Store the session and passage completion alongside the manifest, with atomic compare-and-set updates. Preserve historical versions and link assignment evidence by canonical source reference ID. Source deletion leaves historical reading data readable. Plan or version deletion cascades to trail data. The review path uses the plan version recorded by the attempt's blueprint. Review is transient and uses the question's current, frozen evidence.

The assignment schema carries a document revision, topic, objectives, reference IDs, and an ordered list of bounded quote segments. First and last segment boundaries define the start and end. Segments have optional quote context and use existing format-specific location hints. This permits cross-page and cross-section ranges without relying on a single cross-frame DOM range. Format adapters can cache native ranges scoped by document revision and reverify them before reuse.

### Local generation and manual authoring

Use current, scope-eligible references and their canonical document text or indexed chunks. Expand around verified excerpts within source and size boundaries, merge overlap, and order with the saved prerequisite topology and stable document order. Manual ranges pass the same source checks. Scope limited to an extract stays restricted to its excerpt or eligible extract content. Compute objective support conservatively and surface gaps. The operation is explicit for existing plans and available at first start for newly published plans. It runs without inference and commits once all inputs have been processed. Cancellation or a rejected CAS leaves the saved trail intact.

### Navigation ownership

Extend the existing tab-opening path with a cancellation guard and request identity. Resolve the live document before dispatch and confirm exactness in the reader after the range exists and the boundary is presented. Resolve normalized quotes across text nodes with structural scope, context, and uniqueness checks. Handle stale, missing, ambiguous, unsupported, coarse, and failed outcomes explicitly. Native locators are hints until checked against the current text. Use temporary range decorations that do not rewrite document text or persist to the user highlight database. Reapply after renderer remounts while leaving scroll ownership with the reader after the first jump.

### Learning workflow

Keep reading completion in the trail. Practice uses independent formative question infrastructure and question review uses finalized attempt data. Associate questions and assignments by verified source references and objective targets. If a current assignment cannot support a question, the existing source evidence action remains available. Use origin-tab identity for the return path.

## Risks and trade-offs

Rendered text can differ from extracted text. The UI exposes uncertainty and a separate chapter or page jump where available. OCR text without reliable geometry provides page-level navigation only. EPUB quote-only resolution and PDF page loading have bounded work and cancellation. The source and reader integration fixture covers repeated text, asynchronous remounts, navigation order, and reopening a stored session.
