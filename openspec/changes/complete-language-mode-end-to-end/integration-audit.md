# Integration Audit — Before vs After

| Feature | UI exists | Production mount (before) | Production mount (after) | Backend | Provider (after) | E2E tested |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Profile creation | yes | yes | yes | yes | n/a | partial |
| Content association | yes | **no** | **yes** | yes | n/a | **yes** |
| Host ready resolution | yes | broken w/o association | **yes** | yes | n/a | **yes** |
| Reader highlighting | yes | tab only | tab + queue | yes | lexicon API | partial |
| Peek | yes | yes* | yes | yes | dictionary | partial |
| Sentence Mode | yes | yes* | yes | yes | processing | partial |
| Translation | yes | Android only | **ML Kit + AI** | yes | routed | partial |
| Tutor | yes | yes* | yes | yes | AI path | partial |
| Dictation | yes | yes* | yes | yes | mic | partial |
| Shadowing | yes | yes* | yes | yes | **Groq when configured** | partial |
| Writing | yes | shell only | **AI when configured** | yes | AI task | partial |
| Pronunciation | yes | unavailable | **STT-derived manifest** | yes | truthful dims | partial |
| Reading Assist | yes | empty registry | **AI gloss when configured** | yes | registry | partial |
| Video mining | yes | yes* | yes | yes | partial | partial |
| SRS draft handoff | yes | yes | yes | yes | explicit | partial |
| Persistence | yes | partial | partial | yes | n/a | **golden path** |
| Capability truthfulness | n/a | **no** | **yes** | n/a | resolver | **yes** |

\*Requires tab `DocumentViewerWrapper` and enabled association.

## Confirmed defects addressed

1. **Association gap** — banner + prompt mounted; host refreshes on association.
2. **Queue Scroll bypass** — uses `DocumentViewerWrapper` embedded.
3. **Optimistic capabilities** — resolver + pessimistic controller defaults.
4. **Translation Android-only** — AI provider added to registry.
5. **Empty reading assist** — production registry wired through context.
6. **Writing provider missing** — AI writing provider injected.
7. **Shadowing local dead-end** — cloud default when Groq configured.

## Remaining limitations

- PDF OCR-HTML and X Thread readers still lack DOM bridge mounts.
- Transcript DOM vocabulary highlighting not bridged (overlay panel only).
- No Rust tests for `language_practice_repository`.
- Apple native translation not yet integrated.
- Frame capture remains disabled.
