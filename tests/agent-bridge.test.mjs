import test from 'node:test';
import assert from 'node:assert/strict';
import {assertContinuation,formatCombinedWorkerCycleHandoff,formatSupervisorUpdate,hasContinuationCommand,parseChatSnapshot,parseContinueCommand,shouldNotifySupervisor} from '../src/agent-bridge.ts';

const team={id:'team_1',batchId:'batch_1'};
const batch={id:'batch_1',paused:false};
const source={id:'team_1:A0',teamId:'team_1',number:0,role:'Supervisor',state:'WORKING',chatUrl:'https://chatgpt.com/c/supervisor'};
const target={id:'team_1:A1',teamId:'team_1',number:1,role:'Software Architect',state:'STOPPED',chatName:'feature-002-a1-architect',chatUrl:'https://chatgpt.com/c/worker',lastOrderId:'exec_1'};
const report={type:'AGENT_STATUS',messageId:'msg_2',teamId:team.id,agentId:1,executionId:'exec_1',status:'IN_PROGRESS',completed:[],remaining:['Fix the failing check'],dependencies:[]};
const snapshot={conversationUrl:target.chatUrl,state:'IDLE',latestRole:'assistant',latestMessageId:'msg_2',latestMessage:JSON.stringify([report]),observedAt:'2026-11-24T20:00:00Z'};
const commandText=JSON.stringify({type:'AGENTSYNC_CONTINUE',teamId:team.id,targetAgentId:1,targetExecutionId:'exec_1',targetMessageId:'msg_2',prompt:'Fix the reported failure and rerun the focused check.'});
const command=JSON.stringify([JSON.parse(commandText)]);

test('parses exactly one bounded, allowlisted continuation command',()=>{
  assert.deepEqual(parseContinueCommand(command),{type:'AGENTSYNC_CONTINUE',teamId:team.id,targetAgentId:1,targetExecutionId:'exec_1',targetMessageId:'msg_2',prompt:'Fix the reported failure and rerun the focused check.'});
  for(const invalid of ['',command+'\n'+command,command.replace('AGENTSYNC_CONTINUE','DELETE'),command.replace('"targetAgentId":1','"targetAgentId":8'),command.replace('"prompt":"Fix the reported failure and rerun the focused check."','"prompt":""'),command.replace('"prompt":','"unexpected":true,"prompt":'),JSON.stringify([JSON.parse(command)[0],JSON.parse(command)[0]])])assert.throws(()=>parseContinueCommand(invalid));
  assert.equal(hasContinuationCommand(command),true);
  assert.equal(hasContinuationCommand('not JSON'),false);
});

test('accepts only bounded snapshots for the exact registered conversation',()=>{
  const value={...snapshot};
  assert.deepEqual(parseChatSnapshot(value,target.chatUrl),value);
  assert.throws(()=>parseChatSnapshot({...value,conversationUrl:'https://chatgpt.com/c/other'},target.chatUrl),/does not match/);
  assert.throws(()=>parseChatSnapshot({...value,extra:'field'},target.chatUrl),/Unexpected/);
  assert.throws(()=>parseChatSnapshot({...value,latestMessage:'x'.repeat(40_001)},target.chatUrl),/Invalid latest visible message/);
});

test('notifies A0 when generation ends, even when the response ID stays stable',()=>{
  const previous={...snapshot,state:'GENERATING',latestMessageId:'msg_1'};
  assert.equal(shouldNotifySupervisor(previous,snapshot),true);
  assert.equal(shouldNotifySupervisor(undefined,snapshot),false);
  assert.equal(shouldNotifySupervisor({...previous,state:'IDLE'},snapshot),false);
  assert.equal(shouldNotifySupervisor(previous,{...snapshot,latestRole:'user'}),false);
  assert.equal(shouldNotifySupervisor({...previous,latestRole:'assistant'},snapshot),true);
  assert.equal(shouldNotifySupervisor(previous,{...snapshot,latestMessageId:''}),false);
  assert.equal(shouldNotifySupervisor(previous,{...snapshot,latestMessage:''}),false);
});

test('validates same-team registered A0, target, stopped execution, and unpaused state',()=>{
  const parsed=parseContinueCommand(command);
  assert.doesNotThrow(()=>assertContinuation(parsed,{source,target,team,batch,snapshot,hasPendingOrder:false}));
  const rejected=[
    {source:{...source,number:2}},
    {target:{...target,teamId:'another_team'}},
    {batch:{...batch,paused:true}},
    {target:{...target,lastOrderId:'stale'}},
    {target:{...target,state:'WORKING'}},
    {snapshot:undefined},
    {snapshot:{...snapshot,state:'GENERATING'}},
    {snapshot:{...snapshot,latestMessageId:'newer'}},
    {hasPendingOrder:true},
    {team:{...team,finalizedAt:'2026-11-24T00:00:00Z'}},
  ];
  for(const override of rejected)assert.throws(()=>assertContinuation(parsed,{source,target,team,batch,snapshot,hasPendingOrder:false,...override}));
});

test('formats A0 feedback as bounded, clearly untrusted page content',()=>{
  const update=formatSupervisorUpdate(target,'exec_1',snapshot,'delivery_1');
  assert.match(update,/feature-002-a1-architect/);
  assert.match(update,/AgentSync delivery ID: delivery_1/);
  assert.match(update,/Complete worker response/);
  assert.match(update,/AGENTSYNC_CONTINUE/);
  assert.throws(()=>formatSupervisorUpdate(target,'exec_1',{...snapshot,conversationUrl:'https://chatgpt.com/c/other'},'delivery_1'));
});

test('formats one combined cycle handoff with complete raw worker responses and per-agent cycle IDs',()=>{
  const a2='[{\n  "type": "AGENT_STATUS",\n  "agentId": 2\n}]';
  const a1='[{"type":"AGENT_STATUS","agentId":1}]';
  const packet=formatCombinedWorkerCycleHandoff('team_1',3,[
    {agentNumber:2,agentId:'team_1:A2',executionId:'exec_2',cycleNumber:3,messageId:'msg_2',response:a2},
    {agentNumber:1,agentId:'team_1:A1',executionId:'exec_1',cycleNumber:3,messageId:'msg_1',response:a1},
  ]);
  assert.ok(packet.startsWith('AgentSync cycle 3 combined worker handoff.'));
  assert.ok(packet.indexOf('A1 | team_1:A1')<packet.indexOf('A2 | team_1:A2'));
  assert.ok(packet.includes(`Complete worker response (verbatim):\n${a1}`));
  assert.ok(packet.includes(`Complete worker response (verbatim):\n${a2}`));
  assert.ok(packet.includes('cycle 3 | execution exec_1 | message msg_1'));
  assert.ok(packet.length<250_000);
});
