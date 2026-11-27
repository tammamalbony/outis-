import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCopiedJson,prettyPrintCopiedJson} from '../src/json-cleanup.ts';

test('cleans ChatGPT entity spacing and stray slash-newline artifacts from JSON',()=>{
  const slashes='\\'.repeat(3);
  const dirty=[
    `[${slashes}`,
    '&#x20; {',
    `${slashes}`,
    '&#x20; "type": "AGENTSYNC_PLAN",',
    `${slashes}`,
    '&#x20; "scope": "read-only review",',
    `${slashes}`,
    '&#x20; "requires": []',
    `${slashes}`,
    '&#x20; }',
    `${slashes}`,
    ']',
  ].join('\n');
  const cleaned=normalizeCopiedJson(dirty);
  assert.deepEqual(JSON.parse(cleaned),[{type:'AGENTSYNC_PLAN',scope:'read-only review',requires:[]}]);
  assert.equal(prettyPrintCopiedJson(dirty),JSON.stringify(JSON.parse(cleaned),null,2));
});

test('preserves backslashes, quotes, apostrophes, slashes and entities inside JSON strings',()=>{
  const original=[{scope:"C:\\repo\\it's / path &#x20; with \"quotes\""}];
  const fenced='```json\n'+JSON.stringify(original,null,2)+'\n```';
  assert.deepEqual(JSON.parse(normalizeCopiedJson(fenced)),original);
});
