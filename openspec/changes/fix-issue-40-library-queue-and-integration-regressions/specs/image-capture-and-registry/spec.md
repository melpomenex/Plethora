## ADDED Requirements

### Requirement: Image acquisition works for every image source

Saving an image to the Image Registry and creating an image-occlusion card SHALL succeed for every image the user can see in the application, regardless of how the image is addressed — remote URL, local file, application asset, blob, or data URI. The acquisition strategies available today only to public remote URLs — native ingestion that is not subject to WebView cross-origin restrictions, and rendered-pixel capture — SHALL be available to every source type as fallbacks.

Both entry points, Save to Registry and Create Image Occlusion, SHALL use the same acquisition path so that one cannot succeed where the other fails.

#### Scenario: Occlusion works for an image in an imported document

- **WHEN** the user creates an image-occlusion card from an image inside an imported article
- **THEN** the image is acquired and the occlusion editor opens

#### Scenario: Occlusion works for an image in the in-app image viewer

- **WHEN** the user opens an image in the in-app viewer and creates an image-occlusion card
- **THEN** the image is acquired and the occlusion editor opens

#### Scenario: Pixel capture is used when direct acquisition fails

- **WHEN** an image cannot be acquired by direct retrieval or native ingestion
- **THEN** the application falls back to capturing the rendered image
- **AND** the resulting card contains the visible image

#### Scenario: Save and occlusion behave consistently

- **WHEN** an image can be saved to the Image Registry
- **THEN** an image-occlusion card can be created from that same image

### Requirement: Image acquisition failures are actionable

When an image cannot be acquired by any strategy, the message shown to the user SHALL describe what failed and what to try. It SHALL NOT surface a raw platform error string such as "Load failed".

#### Scenario: A failure names the problem rather than the platform error

- **WHEN** every acquisition strategy fails for an image
- **THEN** the message describes that the image could not be retrieved and suggests a next step
- **AND** the message is not the bare text "Load failed"

### Requirement: Image Registry assets can be renamed

Assets in the Image Registry SHALL be renamable by the user. Renaming SHALL persist, SHALL be reflected everywhere the asset name is displayed, and SHALL NOT break existing references from extracts or cards that use the asset.

#### Scenario: Renaming an asset persists

- **WHEN** the user renames an Image Registry asset
- **THEN** the new name is shown in the registry
- **AND** the new name persists across an application restart

#### Scenario: Renaming does not break existing references

- **WHEN** an asset used by an existing extract is renamed
- **THEN** the extract still displays the image

#### Scenario: Renaming is reachable from the registry

- **WHEN** the user views an asset in the Image Registry
- **THEN** a rename action is available for that asset
