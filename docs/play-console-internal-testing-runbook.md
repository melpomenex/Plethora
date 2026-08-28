# Google Play Console — Internal Testing Runbook

Last updated: 2026-08-28. Terminology matches current Google Play Console.

## Prerequisites

- Google Play Developer account ($25 one-time)
- Plethora AAB built with `npm run tauri:android:build:store:aab`
- Production API live at `https://api.useplethora.com`
- Server env on VPS:
  - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (JSON inline)
  - `GOOGLE_PLAY_PACKAGE_NAME=com.plethora.app`
  - `GOOGLE_PLAY_RTDN_AUDIENCE=https://api.useplethora.com/v1/billing/webhooks/playstore`
  - `CORS_ORIGINS` includes `https://tauri.localhost,tauri://localhost,https://useplethora.com`

---

## 1. Create the app

1. Open [Google Play Console](https://play.google.com/console)
2. **All apps** → **Create app**
3. App name: **Plethora**
4. Default language, **App** type, **Free** (with in-app subscriptions)
5. Accept policies → **Create app**
6. Under **App content** and **Policy**, complete required declarations (privacy policy URL, data safety, etc.)

Package name must be **`com.plethora.app`** (set on first upload; cannot change later).

---

## 2. Play App Signing

1. **Release** → **Setup** → **App integrity**
2. Enroll in **Play App Signing** (recommended default)
3. Google manages the app signing key; you keep an **upload key**

Generate upload keystore locally (do not commit):

```bash
keytool -genkeypair -v -keystore plethora-upload.jks -alias plethora-upload \
  -keyalg RSA -keysize 2048 -validity 10000 -storetype PKCS12
```

Set env for CI/local store builds:

```bash
export PLETHORA_KEYSTORE_PATH=/path/to/plethora-upload.jks
export PLETHORA_KEYSTORE_PASSWORD=...
export PLETHORA_KEY_ALIAS=plethora-upload
export PLETHORA_KEY_PASSWORD=...
```

---

## 3. Subscriptions

1. **Monetize** → **Products** → **Subscriptions**
2. Create subscription **`plethora_pro_monthly`**:
   - Base plan: monthly billing
   - Set price in each country (Google localizes display)
   - Optional free trial / intro offer
3. (Optional) Create **`plethora_pro_annual`** with annual base plan

Product IDs must match `src/lib/billing/productIds.ts` exactly.

Activate subscriptions before testing.

---

## 4. Service account (Android Publisher API)

1. [Google Cloud Console](https://console.cloud.google.com/) → project linked to Play
2. **IAM & Admin** → **Service Accounts** → **Create**
3. Grant role: none at project level (Play Console grants access)
4. Create JSON key → store securely (this becomes `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`)

In Play Console:

1. **Users and permissions** → **Invite new users**
2. Add service account email
3. Permissions: **View financial data**, **Manage orders and subscriptions** (or Admin for testing)
4. **Apply** → **Send invite**

---

## 5. Real-Time Developer Notifications (RTDN)

### Pub/Sub topic

1. Google Cloud Console → **Pub/Sub** → **Topics** → **Create topic**
   - e.g. `play-rtdn-plethora`
2. Grant **Pub/Sub Publisher** to `google-play-developer-notifications@system.gserviceaccount.com`

### Push subscription

1. **Subscriptions** → **Create subscription**
2. Delivery: **Push**
3. Endpoint URL: `https://api.useplethora.com/v1/billing/webhooks/playstore`
4. Enable **Authentication** (OIDC):
   - Service account used by push
   - Audience: `https://api.useplethora.com/v1/billing/webhooks/playstore`
   - Set same value in VPS `GOOGLE_PLAY_RTDN_AUDIENCE`

### Link in Play Console

1. **Monetize** → **Monetization setup** → **Real-time developer notifications**
2. Topic name: `projects/YOUR_PROJECT/topics/play-rtdn-plethora`
3. Save

---

## 6. License testers

1. **Setup** → **License testing**
2. Add Gmail accounts for testers
3. License testers can make test purchases without being charged

---

## 7. Internal Testing track

1. **Release** → **Testing** → **Internal testing**
2. **Create new release**
3. Upload AAB from build output
4. Add release notes → **Save** → **Review release** → **Start rollout**

Copy the **opt-in URL** and share with testers.

---

## 8. Test subscription purchase (success path)

1. Tester opens opt-in URL on Android device
2. Install **Plethora** from Play (Internal testing)
3. Launch app → confirm API calls go to `api.useplethora.com` (network log / server logs)
4. Sign in to Plethora account
5. Open paywall → verify localized price from Play (not hardcoded)
6. Purchase **Plethora Pro Monthly**
7. Verify server logs: validate → acknowledge → tier `pro`
8. App shows Pro; `GET /v1/entitlements` returns `plan: pro`
9. Kill and relaunch → still Pro
10. **Restore purchases** → still Pro

---

## 9. Additional test scenarios

| Scenario | Expected |
|----------|----------|
| Cancel purchase sheet | No Pro; free tier |
| Pending payment (if available) | Pending UI; no Pro until purchased |
| Cancel subscription in Play | Pro until period end; then free |
| Reinstall + sign in + restore | Pro restored |
| Second device, same account | Pro after restore |
| RTDN renewal | Server upserts; tier stays pro |

---

## 10. Deploy server before testing

After pulling this change, on the VPS:

```bash
# Normal Plethora production deploy (adjust to your workflow)
cd /path/to/plethora-deploy
docker compose pull api worker
docker compose up -d api worker
# Migrations run on api startup via existing migrate() hook
curl -sf https://api.useplethora.com/health
curl -sf https://api.useplethora.com/ready
```

Ensure Google Play env vars are set before testing purchases.

---

## Local testing before Play Console

- Server unit tests: `cd server && npm test`
- Client tests: `npm run test:run -- src/lib/billing src/config/__tests__/apiUrl`
- Rust plugin: `cd src-tauri && cargo check -p plethora-playbilling`
- Android debug APK (no Play billing without Play-installed build): `npm run tauri:android:build`

**Requires Play-installed build:** real subscription purchase, localized Play prices, RTDN delivery.

---

## Blockers before first real test subscription

1. Play app created with matching package `com.plethora.app`
2. Subscription `plethora_pro_monthly` active in Play Console
3. Service account JSON on production server
4. Server deployed with this change (acknowledgement + schema migration)
5. Internal testing release with signed AAB
6. License tester account on device Google account

## Blockers before production Play Store submission

All of the above, plus: store listing, content rating, data safety, privacy policy, production rollout review, and removal of any sideload-only permissions from store AAB manifest audit.
