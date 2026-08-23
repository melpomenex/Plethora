---
title: "Native Markdown Reader"
description: "GitHub Flavored Markdown reader with KaTeX math rendering, syntax-highlighted code blocks, and Obsidian-style wikilinks."
category: "read-and-listen"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["markdown viewer","gfm reader","math katex","note viewer"]
aliases: ["markdown viewer","gfm reader","math katex","note viewer"]
relatedDocs: ["reader.selection.actions","reader.vim.navigation","library.collection"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/reading/markdown-reader.md"
---
# Native Markdown Reader

## Purpose
Provides a native, high-performance rendering environment for Markdown documents, research notes, and lecture materials.

## User-Facing Behavior
- Renders standard GitHub Flavored Markdown (headings, lists, blockquotes, tables, strikethrough).
- Renders KaTeX LaTeX mathematical formulas inline (`$...$`) and display blocks (`$$...$$`).
- Code blocks are highlighted with language syntax themes.
- Interactive checkboxes in task lists.

## Exact Behavioral Rules
1. Automatically parses Markdown AST using `react-markdown` and remark/rehype plugins.
2. Supports text selection for extracts and one-click flashcard generation.
3. Restores exact scroll percentage upon reopening.

## Rationale
Ensures zero-friction integration with existing Markdown note repositories while supporting technical and mathematical notations.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.markdown.katex` | `true` | Enable KaTeX formula rendering |
| `viewer.markdown.lineNumbers` | `false` | Show code line numbers |

## Platform Behavior
- **All Platforms**: Fast client-side rendering with instant live update support.
- **E-ink**: Crisp monospaced code blocks and high-contrast formula rendering.