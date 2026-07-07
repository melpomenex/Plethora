### Fixed & Improved

- **Fixed barcode scanner failing to initialize on mobile (APK)** — Updated Content Security Policy configurations to allow `blob:` sources for Web Workers, permitting the scanner's background engine to load successfully.
- **Fixed scanner camera stopping on scan errors** — Modified camera video rendering logic to remain mounted during scan validation errors, allowing users to re-scan codes continuously.
