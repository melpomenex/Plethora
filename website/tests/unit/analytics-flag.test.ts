import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trackWebsiteEvent } from '../../src/config/analytics.ts';
import { launchFlagsFromEnv } from '../../src/config/launch.ts';

describe('analytics enablement', () => {
  it('stays disabled unless PUBLIC_ANALYTICS_ENABLED is true', () => {
    assert.equal(launchFlagsFromEnv({}).analyticsEnabled, false);
    assert.equal(launchFlagsFromEnv({ PUBLIC_ANALYTICS_ENABLED: 'false' }).analyticsEnabled, false);
    assert.equal(launchFlagsFromEnv({ PUBLIC_ANALYTICS_ENABLED: 'true' }).analyticsEnabled, true);
  });

  it('trackWebsiteEvent is a no-op when the flag is off', () => {
    assert.doesNotThrow(() => trackWebsiteEvent({ name: 'cta_all_downloads' }));
  });
});
