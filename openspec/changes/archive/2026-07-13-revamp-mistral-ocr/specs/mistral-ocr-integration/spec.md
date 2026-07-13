## ADDED Requirements

### Requirement: Mistral OCR Provider Configuration
The system SHALL support configuring Mistral OCR in settings by allowing the user to select the "Mistral OCR" provider and input their Mistral API Key.

#### Scenario: Save Mistral OCR configurations
- **WHEN** the user selects "Mistral OCR" in Document OCR settings, enters a valid API key, and saves the settings
- **THEN** the system saves these settings to the local configuration storage and propagates them to the OCR processor.

### Requirement: Mistral OCR Backend Processing and File Cleanup
The system SHALL process image/PDF OCR requests through the Mistral AI files and OCR endpoints using the `mistral-ocr-latest` model, and MUST delete the temporary file from Mistral's servers immediately after processing is complete.

#### Scenario: OCR file upload, execution, and cleanup
- **WHEN** the user requests OCR for a document using the Mistral OCR provider
- **THEN** the system uploads the document to the Mistral files API with purpose `ocr`, initiates the OCR process with the returned `file_id` using the `mistral-ocr-latest` model, converts the extracted markdown into structured HTML, deletes the uploaded file from Mistral's files storage, and returns the HTML result.

### Requirement: Displaying Mistral OCR Results as HTML
The system SHALL render the returned OCR HTML content in an iframe in the Document Viewer interface.

#### Scenario: View OCR-derived HTML document
- **WHEN** the Mistral OCR process finishes successfully and returns the HTML formatted content
- **THEN** the Document Viewer automatically sets the view mode to `ocr-html`, passes the HTML string to the iframe `srcDoc`, and displays the formatted document to the user.
