# Design: Android lightweight ML/NLP

## Native APIs

- Language ID: https://developers.google.com/ml-kit/language/identification/android — bundled 17.0.6, 100+ languages, `und` if below confidence.
- Translate: ML Kit on-device translation, RemoteModelManager, per-language-pair download, offline after download.
- Entity extraction: evaluate; dates/addresses may be useful; people/orgs often weak on textbooks.

## Integration

`identifyLanguage(text) → BCP-47 | "und"` used by import + speech locale hint.
Translation: implement `TranslationProvider` with `offlineAvailable: true`, `sendsTextOffDevice: false`, `kind: "local"`.

Do not persist every translation automatically; follow existing translation cache/provenance.

## Privacy / offline / background

Fully on-device. Translate model download needs network once. Not GenAI foreground-restricted.

## UX

Translate selection in palette. Model download size/progress in a shared download surface if A’s type exists; else settings language section. Do not five separate download UIs — G owns translate models; B owns AICore; H owns AI packs; they share **descriptor shape** only.

## Tests

Fake language id; translation service tests already exist — add ML Kit adapter tests with fakes on non-Android.

## i18n

Never assume English. If Translate lacks a pair, fall through registry priority.
