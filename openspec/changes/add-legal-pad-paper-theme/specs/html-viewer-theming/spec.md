## ADDED Requirements

### Requirement: Material-aware iframe presentation
The HTML viewer SHALL apply the active compatible theme material within same-origin reader documents through its authorized reader styling path. Initial display and subsequent theme/preview/accessibility updates SHALL use coherent colors without replacing reader content solely for appearance changes. Unavailable texture SHALL leave an immediately readable opaque background. Existing sanitization and packaged content-security policy SHALL remain enforced.

#### Scenario: Legal Pad canonical article
- **WHEN** a canonical article opens under Legal Pad
- **THEN** its reading surface displays paper and its semantic insets remain legible without an opaque unrelated body background hiding the material

#### Scenario: Preview preserves content and styles authorization
- **WHEN** the user previews and cancels a theme while reading a selected HTML passage under packaged application policy
- **THEN** the authorized reader stylesheet updates in place, the selection and anchored nodes remain valid, and untrusted styles remain blocked

#### Scenario: Compatibility and OCR surfaces
- **WHEN** browser-capture, raw HTML, arXiv or OCR-HTML uses the compatibility reader
- **THEN** material appears on its intended reading/page surfaces with valid typography, selection and original-media presentation

#### Scenario: Missing texture at first display
- **WHEN** a paper texture is missing or rejected by content-security policy
- **THEN** the reader shows correct opaque paper colors without waiting indefinitely or weakening that policy
