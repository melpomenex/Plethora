---
id: platform.wearable_health_insights
title: Wearable Health and Learning Insights
domain: platform
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Review local sleep, nap, and biometric history alongside study activity in the native app.
how_to: Open Learning Insights. Log sleep by hand, import a health file, or check provider availability under Data Sources.
why: Sleep history and paired review data can show personal patterns when enough records are available.
aliases:
  - sleep chart
  - health vault
  - wearables
  - health connect
  - learning insights
settings:
  - integrations.health.local
  - integrations.health.providers
  - integrations.health.priority
  - integrations.health.transfer
  - integrations.health.privacy
actions: []
related:
  - platform.mobile_android
  - platform.mobile_ios
---

# Wearable Health and Learning Insights

## Purpose

View sleep history together with your own learning activity in the native app.

## User-Facing Behavior

Open **Learning Insights** on desktop or mobile. Start with **Log sleep**, or use **Data Sources** to import CSV, Plethora health JSON, Apple Health XML, or a passphrase-protected Plethora health bundle. **Sample data** lets you explore the charts using a temporary synthetic dataset.

**Sleep Chart** shows sleep by wake date, recorded stages, gaps in coverage, and optional study sessions. Select a date to see the source and any conflicts. Manage which source takes priority in **Settings → Integrations → Health & Wearables**.

**Learning Performance** compares sleep and study activity when enough data is available. Use the Study Plan filter to narrow the report. **Personal Patterns → Inspect evidence** shows sample counts, coverage, and limitations for each available association. Exploratory alertness estimates and personal associations are for reflection.

## Exact Behavioral Rules

Provider availability depends on device support, permissions, and the provider’s approval and configuration. After connecting a source, use **Sync now** to request new records. Disconnect stops future syncs and keeps imported records. Use Health privacy and deletion to remove the records or wipe the local vault. Exported files are managed separately.

## Rationale

Local analysis keeps health history separate from the learning library. The evidence view explains how much data supports each observed association.
