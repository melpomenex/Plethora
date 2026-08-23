/**
 * Purpose-string contract test (Change C §5.2 / design Testing Strategy).
 *
 * The Info.plist purpose strings are DATA consumed by Proposal A's overrides
 * script (`scripts/apply-ios-project-overrides.js`). This test pins the
 * contract: every permission with a shipped iOS feature has a key, every
 * string is user-oriented (explains trigger + scope), and the manifest source
 * path points at the checked-in xcprivacy file. gen/apple itself is never
 * touched by Change C.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const contractPath = join(repoRoot, 'scripts', 'ios-overrides', 'privacy-manifest.json');
const manifestSourcePath = join(repoRoot, 'src-tauri', 'ios-assets', 'PrivacyInfo.xcprivacy');

interface PrivacyManifestContract {
  privacyManifestSourcePath: string;
  purposeStrings: Record<string, string>;
}

describe('iOS purpose-string overrides contract (Change C §5.2)', () => {
  it('contract file exists with the agreed shape', () => {
    expect(existsSync(contractPath)).toBe(true);
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as PrivacyManifestContract;
    expect(typeof contract.privacyManifestSourcePath).toBe('string');
    expect(typeof contract.purposeStrings).toBe('object');
  });

  it('points at the checked-in PrivacyInfo.xcprivacy source', () => {
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as PrivacyManifestContract;
    expect(contract.privacyManifestSourcePath).toBe('src-tauri/ios-assets/PrivacyInfo.xcprivacy');
    expect(existsSync(manifestSourcePath)).toBe(true);
    const plist = readFileSync(manifestSourcePath, 'utf8');
    expect(plist).toContain('NSPrivacyAccessedAPITypes');
    expect(plist).toContain('NSPrivacyTracking');
  });

  it('declares a user-oriented string for every permission with a shipped feature', () => {
    const { purposeStrings } = JSON.parse(readFileSync(contractPath, 'utf8')) as PrivacyManifestContract;

    // Camera: QR sync scanning. Microphone: dictation / pronunciation practice.
    expect(Object.keys(purposeStrings).sort()).toEqual([
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSSpeechRecognitionUsageDescription',
    ]);

    for (const [key, value] of Object.entries(purposeStrings)) {
      expect(value.length, `${key} should be substantive`).toBeGreaterThan(40);
      // User-oriented: names the triggering context ("only when/only ... you").
      expect(value, `${key} should state when the permission is used`).toMatch(/only when/i);
    }
  });

  it('does not declare strings for capabilities without shipped features', () => {
    const { purposeStrings } = JSON.parse(readFileSync(contractPath, 'utf8')) as PrivacyManifestContract;
    // Background audio / local network / location must stay undeclared until a
    // shipped feature requires them (audit doc §5.4).
    for (const forbidden of [
      'NSLocationWhenInUseUsageDescription',
      'NSLocalNetworkUsageDescription',
      'NSBluetoothAlwaysUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
    ]) {
      expect(purposeStrings[forbidden]).toBeUndefined();
    }
  });
});
