# Showcase v2 baseline audit

Captured on 2026-08-23 from the local Astro site before the v2 implementation.
The audit covered the homepage `/#demo` anchor and `/demo` at 1440x1000,
1280x720, 768x1024, and 390x844.

## Responsive findings

| Viewport | Homepage | `/demo` |
| --- | --- | --- |
| Wide desktop, 1440x1000 | The demo is a 376px phone reconstruction inside a 1150px slot. It does not show a readable desktop product state. | The same 376px phone is centered in a 1152px content area. |
| Short laptop, 1280x720 | The demo is 1074px tall, so the device and script do not fit in the viewport. | The fixed phone remains 710px tall before the script and normal exit content. |
| Tablet, 768x1024 | The desktop screenshot above the demo is scaled down while the demo remains a phone-only reconstruction. | The same 376px phone is used; there is no tablet-specific composition. |
| Phone, 390x844 | The demo slot is 1314px tall and the phone is 333x734. The surrounding story cannot be scanned with the product state in view. | The phone is 335x734 and the full demo is 1314px tall. Desktop detail is unavailable. |

The current homepage full page is unusually tall (6902px at wide desktop and
9606px on phone), with large empty gaps and repeated content visible in the
captured render.

## Input failure

The demo installs a `window` keydown listener. With focus on the global Pricing
link, pressing ArrowRight changed the demo live text from `Stage: library` to
`Stage: item` while the URL and page focus stayed outside the demo. Enter has
the same global advancement behavior unless the target is a form field.

## Asset truthfulness failures

- `library`, `ios-frame`, and `android-frame` say `0 documents` and show
  skeleton cards.
- `desktop-collage` says `0 documents` and shows eight skeleton cards.
- `explain` contains no explanation content.
- `card` and `review` show the first-run spaced-repetition onboarding panel,
  not the promised fixture card or review state.
- `eink-reader` is an empty/skeleton document library rather than a reader.
- Only the PWA `reader` image shows the approved fictional essay in a settled
  real-app surface.
- The active manifest marks the broken PWA files above as non-placeholder.

## Asset inventory and disposition

Every source PNG present during the audit is classified below. Files are not
deleted by this change.

| Files | Classification | Production disposition |
| --- | --- | --- |
| `*_placeholder-unreleased.png` (10 files, including the OG image) | placeholder | Quarantined from required v2 scenes. The OG placeholder may remain for noindex previews only. |
| `reader_iphone_iphone-14-390x844_light_pwa.png` | approved fixture content | Reference-only until recaptured with fixture v2 provenance and freshness metadata. |
| `library_iphone_iphone-14-390x844_light_pwa.png` | empty/skeleton | Quarantined. |
| `desktop-collage_desktop_desktop-1440x900_light_pwa.png` | empty/skeleton | Quarantined. |
| `ios-frame_iphone_iphone-14-pro-430x932_light_pwa.png` | empty/skeleton | Quarantined. |
| `android-frame_android_android-412x915_light_pwa.png` | empty/skeleton | Quarantined. |
| `eink-reader_iphone_iphone-14-390x844_eink_pwa.png` | empty/skeleton | Quarantined. |
| `explain_iphone_iphone-14-390x844_light_pwa.png` | empty/skeleton | Quarantined. |
| `card_iphone_iphone-14-390x844_light_pwa.png` | stale/mislabeled | Quarantined. |
| `review_iphone_iphone-14-390x844_light_pwa.png` | stale/mislabeled | Quarantined. |
| `android-frame_android_pixel-9-pro-xl_light_2.7.0-device.png` | unsafe/personal and skeleton | Quarantined; contains counts from a developer library. |
| `library_android_pixel-9-pro-xl_light_2.7.0-device.png` | unsafe/personal | Quarantined; contains personal library titles, commercial covers, and external social content. |
| `dashboard_android_pixel-9-pro-xl_light_2.7.0-device.png` | unsafe/personal and loading | Quarantined. |
| `queue_android_pixel-9-pro-xl_light_2.7.0-device.png` | unsafe/personal | Quarantined; contains personal queue titles and counts. |
| `reader_android_pixel-9-pro-xl_light_2.7.0-device.png` | unsafe/personal | Quarantined; contains a real public figure image and external social content. |
| `reader2_android_pixel-9-pro-xl_light_2.7.0-device.png` | empty/stale | Quarantined. |
| `card_android_pixel-9-pro-xl_light_2.7.0-device.png` | loading | Quarantined. |
| `review_android_pixel-9-pro-xl_light_2.7.0-device.png` | loading | Quarantined. |

