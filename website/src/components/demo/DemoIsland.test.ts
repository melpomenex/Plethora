import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WebsiteAnalyticsEvent } from '../../config/analytics.ts';
import { defaultShellFromUserAgent, toggleShell } from './shell.ts';
import {
  applyDemoEvent,
  applyRestart,
  applyShellToggle,
  createDemoSession,
} from './session.ts';

describe('demo chrome toggle and restart', () => {
  it('defaults the shell from the user agent', () => {
    assert.equal(defaultShellFromUserAgent('Mozilla/5.0 (Linux; Android 14)'), 'android');
    assert.equal(defaultShellFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'ios');
    assert.equal(defaultShellFromUserAgent('Mozilla/5.0 (Macintosh)'), 'ios');
    assert.equal(toggleShell('ios'), 'android');
  });

  it('keeps stage and kind when the phone chrome toggles', () => {
    let session = createDemoSession({ userAgent: 'iPhone' });
    session = applyDemoEvent(session, { type: 'select-kind', kind: 'book' });
    const toggled = applyShellToggle(session);
    assert.equal(toggled.shell, 'android');
    assert.equal(toggled.state.stage, 'item');
    assert.equal(toggled.state.contentKind, 'book');
  });

  it('restart returns to library and emits demo_restart', () => {
    const events: WebsiteAnalyticsEvent[] = [];
    let session = createDemoSession();
    session = applyDemoEvent(session, { type: 'advance' }, (event) => events.push(event));
    events.length = 0;
    session = applyRestart(session, (event) => events.push(event));
    assert.equal(session.state.stage, 'library');
    assert.deepEqual(events, [{ name: 'demo_restart' }]);
  });
});
