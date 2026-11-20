# iOS privacy label mapping

Review the disclosures for the native version being submitted. The snapshot for the privacy label draft draws from the [disclosure registry](../../src/lib/privacy/disclosureRegistry.ts). Use the [privacy architecture](../PRIVACY_ARCHITECTURE.md) for storage, retention, and transfer details. [Manage app privacy in App Store Connect](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)

| Disclosure ID | Scope for the iOS submission |
| --- | --- |
| `local_health_vault` | The app processes health measurements and sleep-related learning analysis on-device. The local flow contributes no collected data types. User-selected file exports are controlled by the user. |
| `health_oauth_broker` | Optional wearable sign-in uses transient credential exchanges over TLS. Health records transfer directly from the provider to the device. Review the production broker’s logging and retention before submission. |
| `cloud_sync` | Optional synchronized user content associated with a Plethora account. |
| `cloud_backup` | Optional backup of library content. The Health Vault is stored separately. |
| `cloud_ai_intelligence` | Content sent to an enabled model or hosted retrieval provider. |
| `cloud_document_processing` | Content submitted for hosted OCR or document reconstruction. |
| `cloud_tts` | Text sent for hosted speech synthesis. |
| `cloud_transcription` | Audio submitted to hosted transcription. |
| `cloud_web_capture` | Content submitted using the remote capture inbox. |
| `store_transactions` | Apple purchase or restoration records used for billing and entitlements. |
| `web_analytics` | Vercel analytics in the website and PWA builds. Exclude this flow from the native iOS submission. |
| `telemetry_crash_reporting` | The native app includes no crash reporting SDK. |

The local Health Vault stays in the in-app privacy inventory. Apple's App Privacy questionnaire excludes data processed only on-device. Review the deployed data flows again if cloud wearable sign-in or any off-device processing is enabled for the submitted build. [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
