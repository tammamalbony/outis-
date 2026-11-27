import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBatch,conversationUrl,initialPrompt,makeOrder} from '../src/core.ts';
const config={repository:'owner/project',baseBranch:'develop',reasoningEffort:'high',agentsPerTeam:5,maxConcurrentTeams:1,executionMode:'event-driven',autoMerge:false};
const make=()=>makeBatch('tasks.md',config,[{title:'Feature 001 — A',markdown:'# Feature 001 — A'},{title:'Feature 002 — A',markdown:'# Feature 002 — A'}]);
test('exactly six agents per feature, with unique identifiers',()=>{const b=make();assert.equal(b.agents.length,12);assert.equal(b.events.length,2);assert.equal(new Set(b.agents.map(a=>a.id)).size,12);for(const t of b.teams)assert.deepEqual(b.agents.filter(a=>a.teamId===t.id).map(a=>a.number),[0,1,2,3,4,5]);});
test('reject empty imports',()=>assert.throws(()=>makeBatch('empty.md',config,[])));
test('normalize chat URL and reject external URLs',()=>{assert.equal(conversationUrl('https://chatgpt.com/c/abc/?x=1'),'https://chatgpt.com/c/abc');for(const u of ['https://evil.com/c/abc','https://chatgpt.com.evil.com/c/abc','https://chatgpt.com/','http://chatgpt.com/c/abc'])assert.throws(()=>conversationUrl(u));});
test('reject cross-team prompts and orders',()=>{const b=make();assert.throws(()=>initialPrompt(b.teams[1],b.agents[0]));assert.throws(()=>makeOrder(b.teams[1],b.agents[0],'x'));});
test('queue only registered non-running agents and nonempty prompts',()=>{const b=make(),t=b.teams[0],a=b.agents[0];assert.throws(()=>makeOrder(t,a,'x'));const ready={...a,state:'READY',chatUrl:'https://chatgpt.com/c/abc'};assert.equal(makeOrder(t,ready,' x ').prompt,'x');assert.throws(()=>makeOrder(t,ready,' '));assert.throws(()=>makeOrder(t,{...ready,state:'WORKING'},'x'));});
test('supervisor prompt includes repository, task and no-merge rule',()=>{const b=make();const p=initialPrompt(b.teams[0],b.agents[0]);assert.match(p,/owner\/project/);assert.match(p,/Do not merge/);assert.match(p,/Feature 001/);});
test('supervisor checks real blockers before assigning work and uses finite recommended question batches',()=>{const b=make();const p=initialPrompt(b.teams[0],b.agents[0]);assert.match(p,/Before assigning or restarting any worker/);assert.match(p,/ordinary file\/repository access/);assert.match(p,/one finite batch/);assert.match(p,/Recommended/);assert.match(p,/continue independent work/);assert.match(p,/do not use clickable options, open-ended question chains, or ask again/);});

import { activeTeamIds, assertTeamCapacity, assertOrderIdentity } from '../src/scheduler.ts';
const readyAgent = (a) => ({...a, state:'READY', chatUrl:'https://chatgpt.com/c/abc'});
test('pending orders reserve team capacity before submission',()=>{
  const b=make(), [t1,t2]=b.teams, a=readyAgent(b.agents[0]);
  const pending=makeOrder(t1,a,'first');
  assert.deepEqual([...activeTeamIds(b.teams,b.agents,[pending])],[t1.id]);
  assert.doesNotThrow(()=>assertTeamCapacity(b.batch,t1,b.teams,b.agents,[pending]));
  assert.throws(()=>assertTeamCapacity(b.batch,t2,b.teams,b.agents,[pending]),/limit reached/);
  assert.doesNotThrow(()=>assertTeamCapacity(b.batch,t2,b.teams,b.agents,[{...pending,state:'CANCELLED'}]));
});
test('confirmed orders do not release capacity while an agent is working',()=>{
  const b=make(),[t1,t2]=b.teams,a={...readyAgent(b.agents[0]),state:'WORKING'};
  const confirmed={...makeOrder(t1,readyAgent(a),'first'),state:'CONFIRMED'};
  assert.throws(()=>assertTeamCapacity(b.batch,t2,b.teams,[a],[confirmed]),/limit reached/);
  assert.doesNotThrow(()=>assertTeamCapacity(b.batch,t2,b.teams,[{...a,state:'STOPPED'}],[confirmed]));
});
test('batch capacity is isolated and paused batches reject reservations',()=>{
  const b=make(), other=make(),a=readyAgent(other.agents[0]), pending=makeOrder(other.teams[0],a,'other');
  const teams=[...b.teams,...other.teams];
  assert.doesNotThrow(()=>assertTeamCapacity(b.batch,b.teams[0],teams,[a],[pending]));
  assert.throws(()=>assertTeamCapacity({...b.batch,paused:true},b.teams[0],teams,[],[]),/paused/);
  assert.throws(()=>assertTeamCapacity(b.batch,other.teams[0],teams,[],[]),/mismatch/);
});
test('a pending order must match the exact registered agent and team',()=>{
  const b=make(), t=b.teams[0], a=readyAgent(b.agents[0]), o=makeOrder(t,a,'first');
  assert.doesNotThrow(()=>assertOrderIdentity(o,a,t));
  assert.throws(()=>assertOrderIdentity(o,readyAgent(b.agents[1]),t),/identity/);
  assert.throws(()=>assertOrderIdentity(o,a,b.teams[1]),/identity/);
  assert.throws(()=>assertOrderIdentity({...o,state:'CANCELLED'},a,t),/pending/);
  assert.throws(()=>assertOrderIdentity(o,{...a,state:'WORKING'},t),/available/);
});
