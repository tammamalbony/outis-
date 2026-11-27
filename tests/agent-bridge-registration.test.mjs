import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeMatchPatterns} from '../src/agent-bridge-registration.ts';

test('limits dynamic script matches to unique registered ChatGPT conversation URLs',()=>{
  assert.deepEqual(bridgeMatchPatterns(['https://chatgpt.com/c/one','https://chatgpt.com/c/two','https://chatgpt.com/c/one']),['https://chatgpt.com/c/one*','https://chatgpt.com/c/two*']);
  assert.throws(()=>bridgeMatchPatterns([]),/Register at least one/);
  assert.throws(()=>bridgeMatchPatterns(['https://chatgpt.com/']),/normal ChatGPT conversation URL/);
  assert.throws(()=>bridgeMatchPatterns(['https://evil.example/c/one']),/normal ChatGPT conversation URL/);
  assert.throws(()=>bridgeMatchPatterns(Array.from({length:101},(_,i)=>`https://chatgpt.com/c/chat-${i}`)),/limited to 100/);
});
