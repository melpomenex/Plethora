## Why

When editing numeric setting values (such as font size or other configuration values) in the settings pages, the inputs immediately fall back to default values when they are cleared or set to an invalid state. This prevents users from deleting the existing value and typing in what they want, leading to a frustrating user experience.

## What Changes

- Modify numeric inputs in the settings pages to allow temporary empty states.
- Avoid immediate fallback to default values on change when the input is empty or invalid.
- Introduce validation and fallback logic on blur (when the user leaves the input field) rather than on keypress.
- Clamp values to min/max boundaries on blur rather than immediately on change.

## Capabilities

### New Capabilities

- `settings-numeric-inputs`: Specifies the input behavior for numeric values in settings, ensuring they support deletion, clearing, typing, and lazy validation on blur.

### Modified Capabilities

<!-- None -->
