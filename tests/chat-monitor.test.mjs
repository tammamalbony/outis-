import test from 'node:test';
import assert from 'node:assert/strict';
import {chatPresence,buildChatMonitorEntries,CHAT_STATUS_POLL_MS,CHAT_OBSERVATION_MAX_AGE_MS} from '../src/chat-monitor.ts';

const url='https://chatgpt.com/c/chat-1';
const team={id:'team-1',batchId:'batch-1',title:'UI refresh',branch:'feature/ui',repository:'owner/repo',baseBranch:'develop',reasoningEffort:'high'};
const agent={id:'team-1:A1',teamId:team.id,number:1,role:'Software Architect',state:'WORKING',chatUrl:url,lastOrderId:'order-1'};
const order={id:'order-1',teamId:team.id,agentId:agent.id,prompt:'work',state:'CONFIRMED',createdAt:'2026-11-24T10:00:00.000Z',confirmedAt:'2026-11-24T10:01:00.000Z'};

test('ongoing chat monitor scans every five seconds and only trusts fresh bridge observations',()=>{
  assert.equal(CHAT_STATUS_POLL_MS,5_000);
  assert.equal(CHAT_OBSERVATION_MAX_AGE_MS,15_000);
  const now=Date.parse('2026-11-24T10:02:00.000Z');
  const fresh={agentId:agent.id,teamId:team.id,state:'IDLE',latestRole:'assistant',latestMessageId:'reply-1',observedAt:'2026-11-24T10:01:58.000Z'};
  const stale={...fresh,state:'GENERATING',observedAt:'2026-11-24T10:01:40.000Z'};
  const idle=buildChatMonitorEntries([agent],[team],[order],[{id:1,url,active:true}],[fresh],now)[0];
  assert.equal(idle.agent.state,'WORKING');
  assert.equal(idle.chatStatus,'IDLE');
  assert.equal(idle.chatObservedAt,fresh.observedAt);
  assert.equal(buildChatMonitorEntries([agent],[team],[order],[],[stale],now)[0].chatStatus,'UNKNOWN');
  assert.equal(buildChatMonitorEntries([agent],[team],[order],[],[],now)[0].chatStatus,'UNKNOWN');
});

test('chat presence matches canonical ChatGPT conversations and reports active versus open',()=>{
  assert.equal(chatPresence(url,[{id:1,url,active:true}]),'ACTIVE');
  assert.equal(chatPresence(url,[{id:1,url:url+'/?utm=1',active:false}]),'OPEN');
  assert.equal(chatPresence(url,[{id:1,url:'https://chatgpt.com/c/another',active:true}]),'CLOSED');
});

test('chat presence fails closed for navigating and incognito tabs and reports unknown without permission',()=>{
  assert.equal(chatPresence(url,[{id:1,url,active:true,incognito:true}]),'CLOSED');
  assert.equal(chatPresence(url,[{id:1,pendingUrl:url,active:true}]),'CLOSED');
  assert.equal(chatPresence(url,null),'UNKNOWN');
  assert.equal(chatPresence(undefined,[]),'UNKNOWN');
});

test('monitor entries include registered chats, latest execution phase and local status',()=>{
  const older={...order,id:'older',createdAt:'2026-11-24T09:00:00.000Z',state:'CANCELLED'};
  const unregistered={...agent,id:'team-1:A2',number:2,chatUrl:undefined,state:'UNREGISTERED'};
  const entries=buildChatMonitorEntries([agent,unregistered],[team],[older,order],[{id:1,url,active:true}]);
  assert.equal(entries.length,1);
  assert.equal(entries[0].team.title,'UI refresh');
  assert.equal(entries[0].agent.state,'WORKING');
  assert.equal(entries[0].chatStatus,'UNKNOWN');
  assert.equal(entries[0].phase,'RUNNING_REPORTED');
  assert.equal(entries[0].presence,'ACTIVE');
});
