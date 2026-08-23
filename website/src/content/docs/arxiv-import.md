---
title: "ArXiv Paper Ingestion"
description: "Direct ArXiv ID or URL resolution, downloading full PDF, abstract, authors, publication date, and primary category."
category: "capture-and-import"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["arxiv paper","academic paper import","scientific paper","download arxiv"]
aliases: ["arxiv paper","academic paper import","scientific paper","download arxiv"]
relatedDocs: ["import.url_scraping","reader.pdf.page_mode","reader.pdf.reflow"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/imports/arxiv-import.md"
---
# ArXiv Paper Ingestion

## Purpose
Streamlines academic literature reviews by automating the discovery, download, and metadata indexing of pre-print papers from ArXiv.org.

## User-Facing Behavior
- Accepts ArXiv URLs (both `/abs/` abstract pages and `/pdf/` links) or bare identifiers (e.g., `2305.18290`).
- Fetches official metadata: title, authors, publication timestamp, categories (e.g., `cs.AI`, `stat.ML`), and abstract.
- Downloads PDF directly into library and attaches abstract as document description.

## Exact Behavioral Rules
1. Queries the ArXiv OpenSearch API to fetch XML Atom entry.
2. Formats author list and primary subjects as document tags.
3. Automatically sets up the PDF for reflow and incremental reading queue scheduling.

## Rationale
Manual downloading and renaming of scientific papers creates organizational debt. Automated metadata tagging keeps research archives searchable.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `import.arxiv.autoTagCategories` | `true` | Convert arXiv subject classifications into document tags |

## Platform Behavior
- **All Platforms**: Async background download with progress bar and retry on network drop.