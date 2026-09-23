## Purpose

Provides a completely accountless, free, and local-first application experience for public open-source releases of Plethora while preserving underlying Plethora Cloud infrastructure for future activation.

## ADDED Requirements

### Requirement: Public Accountless Operation Mode
The application SHALL operate with no account requirement, no sign-in prompt, and no degraded state when Plethora Cloud public availability is disabled.

#### Scenario: First-time application launch
- **WHEN** a new user installs and opens Plethora
- **THEN** the application opens directly to the local workspace with no login wall, no onboarding account modal, and no account requirement banner

#### Scenario: Anonymous startup network silence
- **WHEN** the application boots in anonymous mode
- **THEN** no network requests are made to Plethora Cloud authentication or entitlement endpoints

### Requirement: Settings and Account Navigation Filtering
The application SHALL NOT expose any Account navigation tab, profile management, sign-in/sign-up controls, or device revocation interfaces in public settings when Plethora Cloud is disabled.

#### Scenario: Opening Settings page
- **WHEN** a user opens Settings
- **THEN** the Account tab is absent from the navigation list, settings search excludes account keywords, and the default view is General settings

#### Scenario: Stale account deep-link route recovery
- **WHEN** a user opens Settings with a persisted or deep-linked initial tab set to "account"
- **THEN** Settings safely redirects to the General tab without rendering an empty or broken section

#### Scenario: Integration settings hosted API tab suppression
- **WHEN** a user opens Integration Settings
- **THEN** the account-bound hosted API & Webhooks tab is hidden, while local MCP and local tool integrations remain accessible

### Requirement: Monetization and Paywall Suppression
The application SHALL NOT expose Pro badges, upgrade prompts, subscription pricing, trial indicators, or paywall modals when Plethora Cloud is disabled.

#### Scenario: Triggering paywall context
- **WHEN** code invokes `openPaywall()`
- **THEN** the action is a silent no-op, the paywall state remains closed, and no modal is displayed

#### Scenario: Paywall modal rendering
- **WHEN** the `PaywallModal` component mounts
- **THEN** it renders `null` when cloud availability is disabled

### Requirement: Cloud Sync Informational Notice
The cloud sync settings surface SHALL present an informational notice explaining that encrypted synchronization is planned for a future release and that Plethora works fully offline without an account.

#### Scenario: Viewing cloud storage settings
- **WHEN** a user navigates to Cloud Storage settings
- **THEN** the Plethora Cloud sync section displays a "Coming Soon" status badge with offline-first explanatory text, without exposing dead sign-in buttons or recovery key generation controls

#### Scenario: Independent third-party cloud providers
- **WHEN** a user accesses Cloud Storage settings
- **THEN** user-configured providers (Google Drive, OneDrive, Dropbox) remain available and functional

### Requirement: Local Feature Availability Under Free Plan Defaults
All local reading, learning, review, AI, speech, transcription, and knowledge capabilities SHALL remain completely accessible without an account or subscription.

#### Scenario: Anonymous reading and review
- **WHEN** an anonymous user imports documents, generates flashcards, and reviews them with FSRS-7
- **THEN** all reading, extraction, and spaced repetition operations execute locally without gating

#### Scenario: Local AI and speech features
- **WHEN** an anonymous user configures local/on-device AI models, BYO API keys, system TTS, or local Whisper transcription
- **THEN** the features execute without checking or requiring an active Plethora account or subscription

### Requirement: Preservation of Existing Account and Sync Infrastructure
Underlying authentication stores, tokens, billing providers, sync engines, and recovery key cryptography SHALL remain in the source tree and deserialize safely without breaking backward compatibility.

#### Scenario: Upgrade with existing session
- **WHEN** a user with an existing authenticated session upgrades to the accountless release
- **THEN** existing persisted credentials and sync keys are preserved untouched in storage for future re-activation
