import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_TIMING_SETTINGS,readTimingSettings,validateTimingSettings} from '../src/timing-settings.ts';

test('timing settings provide configurable workflow defaults and read partial saved values',()=>{
 assert.equal(DEFAULT_TIMING_SETTINGS.pageSettleMs,5_000);
 assert.equal(DEFAULT_TIMING_SETTINGS.conversationLinkGraceMs,5_000);
 assert.equal(DEFAULT_TIMING_SETTINGS.chatSnapshotPollMs,5_000);
 assert.deepEqual(readTimingSettings({pageSettleMs:7_000,chatRefreshSeconds:60}),{...DEFAULT_TIMING_SETTINGS,pageSettleMs:7_000});
 assert.deepEqual(readTimingSettings(null),DEFAULT_TIMING_SETTINGS);
});

test('timing settings reject missing fields, fractions and out-of-range values',()=>{
 assert.throws(()=>validateTimingSettings({}),/pageSettleMs/);
 assert.throws(()=>validateTimingSettings({...DEFAULT_TIMING_SETTINGS,pollIntervalMs:99}),/pollIntervalMs/);
 assert.throws(()=>validateTimingSettings({...DEFAULT_TIMING_SETTINGS,a0ResponseTimeoutMs:1.5}),/whole number/);
});
