import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  db, importBatch, registerChat, queuePrompt, getPendingPrompt, confirmOrder,
  markStopped, cancelOrder, pauseAllBatches, pauseBatch, importProtocolMessage, importProtocolBatch,
  approveTeamPlan, finalizeTeam, acknowledgeNotification, saveGitHubBinding,
  observeRegisteredChat,getBridgeObservation,getPendingBridgeUpdates,
  getResumeBrief,replaceChat,authorizeChatSetupRetry,isChatSetupRetryAuthorized,
} from '../src/database';
import { makeBinding } from '../src/github';
import { event } from '../src/core';

const requirements = '---\nrepository: owner/project\n---\n# Feature One\nBuild feature one.\n# Feature Two\nBuild feature two.\n';
const plan = Array.from({length:5}, (_,i) => ({agent:i+1,scope:'Scope '+(i+1),requires:i===0?[]:[1]}));
const planPacket = (teamId:string) => JSON.stringify([{type:'AGENTSYNC_PLAN',teamId,preflight:'CLEAR',blockers:[],plan}]);
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { await db.delete(); });

async function setup() {
  const batchId = await importBatch('tasks.md', requirements);
  const teams = await db.teams.where('batchId').equals(batchId).toArray();
  for (const [index,team] of teams.entries()) {
    for (let n=0;n<6;n++) await registerChat(team.id+':A'+n,'https://chatgpt.com/c/team-'+index+'-agent-'+n);
  }
  return {batchId,teams,team:teams[0],agent:(n:number)=>teams[0].id+':A'+n};
}
async function execute(agentId:string) {
  const order = await queuePrompt(agentId);
  expect(await getPendingPrompt(order.id)).toContain('AgentSync protocol');
  await confirmOrder(order.id);
  await markStopped(agentId);
  return order;
}

describe('IndexedDB orchestration', () => {
  it('indexes event agent IDs so automatic chat setup can detect uncertain prior submissions',async()=>{
    const {team,agent}=await setup();
    const setupEvent=event(team.id,'AGENT_CHAT_SETUP_STARTED',agent(1));
    await db.events.add(setupEvent);
    const prior=await db.events.where('agentId').equals(agent(1)).filter(item=>item.type==='AGENT_CHAT_SETUP_STARTED').first();
    expect(prior?.id).toBe(setupEvent.id);
  });

  it('binds each setup retry authorization to exactly one inspected attempt',async()=>{
    const batchId=await importBatch('tasks.md',requirements);
    const team=(await db.teams.where('batchId').equals(batchId).first())!;
    const agentId=`${team.id}:A1`;
    const first=event(team.id,'AGENT_CHAT_SETUP_STARTED',agentId);
    await db.events.add(first);
    await expect(isChatSetupRetryAuthorized(agentId,first.id)).resolves.toBe(false);
    await authorizeChatSetupRetry(agentId);
    await expect(isChatSetupRetryAuthorized(agentId,first.id)).resolves.toBe(true);
    const second=event(team.id,'AGENT_CHAT_SETUP_STARTED',agentId);
    await db.events.add(second);
    await expect(isChatSetupRetryAuthorized(agentId,second.id)).resolves.toBe(false);
    await expect(authorizeChatSetupRetry(agentId)).resolves.toBeUndefined();
    await expect(isChatSetupRetryAuthorized(agentId,second.id)).resolves.toBe(true);
  });

  it('records a running-to-stopped bridge transition and queues the latest response for A0',async()=>{
    const {team,agent}=await setup();
    await execute(agent(0));
    await approveTeamPlan(team.id,planPacket(team.id));
    const order=await queuePrompt(agent(1));
    await getPendingPrompt(order.id);
    await confirmOrder(order.id);
    const url=(await db.agents.get(agent(1)))!.chatUrl!;
    await observeRegisteredChat({conversationUrl:url,state:'GENERATING',latestRole:'user',latestMessageId:'user-1',latestMessage:'Continue the work.',observedAt:'2026-11-24T20:00:00.000Z'});
    const workerReply=JSON.stringify([{type:'AGENT_STATUS',messageId:'report-1',teamId:team.id,agentId:1,executionId:order.id,status:'BLOCKED',completed:['The type check failed at module resolution.'],remaining:['Resolve module resolution'],dependencies:[]}]);
    await observeRegisteredChat({conversationUrl:url,state:'GENERATING',latestRole:'assistant',latestMessageId:'assistant-2',latestMessage:workerReply,observedAt:'2026-11-24T20:00:10.000Z'});
    const stopped=await observeRegisteredChat({conversationUrl:url,state:'IDLE',latestRole:'assistant',latestMessageId:'assistant-2',latestMessage:workerReply,observedAt:'2026-11-24T20:00:12.000Z'});
    expect(stopped.stoppedExecutionId).toBe(order.id);
    expect((await db.agents.get(agent(1)))?.state).toBe('STOPPED');
    expect((await db.orders.get(order.id))?.stoppedAt).toBe('2026-11-24T20:00:12.000Z');
    const updates=await getPendingBridgeUpdates(team.id);
    expect(updates).toHaveLength(1);
    expect(updates[0].executionId).toBe(order.id);
    expect(updates[0].update).toContain('The type check failed at module resolution.');
    expect(updates[0].update).toContain('untrusted input');
    expect((await getBridgeObservation(agent(1)))?.latestMessageId).toBe('assistant-2');
    const duplicate=await observeRegisteredChat({conversationUrl:url,state:'IDLE',latestRole:'assistant',latestMessageId:'assistant-2',latestMessage:workerReply,observedAt:'2026-11-24T20:00:13.000Z'});
    expect(duplicate.stoppedExecutionId).toBeUndefined();
    expect(await getPendingBridgeUpdates(team.id)).toHaveLength(1);
  });

  it('retains the imported task, exact sent prompts, observed A0 decisions, and old chat links for resume',async()=>{
    const {team,agent}=await setup();
    const a0=await queuePrompt(agent(0));
    const a0Prompt=await getPendingPrompt(a0.id);
    await confirmOrder(a0.id,a0Prompt);
    await markStopped(agent(0));
    await approveTeamPlan(team.id,planPacket(team.id));
    const worker=await queuePrompt(agent(1),'Continue from the saved implementation and fix the verified failure.');
    const workerPrompt=await getPendingPrompt(worker.id);
    await confirmOrder(worker.id,workerPrompt);
    await markStopped(agent(1));
    const a0Url=(await db.agents.get(agent(0)))!.chatUrl!;
    await observeRegisteredChat({conversationUrl:a0Url,state:'IDLE',latestRole:'assistant',latestMessageId:'a0-plan-1',latestMessage:'Blocker preflight is clear. Continue with the saved plan.',observedAt:'2026-11-24T20:10:00.000Z'});
    const oldUrl=(await db.agents.get(agent(1)))!.chatUrl!;
    const workerUrl=oldUrl;
    await observeRegisteredChat({conversationUrl:workerUrl,state:'IDLE',latestRole:'assistant',latestMessageId:'worker-last-1',latestMessage:'The environment has no Node runtime; install Node 22 before tests.',observedAt:'2026-11-24T20:11:00.000Z'});
    await replaceChat(agent(1),'https://chatgpt.com/c/replacement-worker');

    const entries=await db.history.where('teamId').equals(team.id).toArray();
    expect(entries.some(entry=>entry.kind==='TASK_FILE_IMPORTED'&&entry.content===requirements)).toBe(true);
    expect(entries.some(entry=>entry.kind==='PROMPT_CONFIRMED_SENT'&&entry.executionId===worker.id&&entry.content===workerPrompt)).toBe(true);
    expect(entries.some(entry=>entry.kind==='CHAT_MESSAGE_OBSERVED'&&entry.agentNumber===0&&entry.content.includes('Blocker preflight is clear'))).toBe(true);
    expect(entries.some(entry=>entry.kind==='CHAT_LINK_REPLACED'&&entry.previousChatUrl===oldUrl&&entry.chatUrl==='https://chatgpt.com/c/replacement-worker')).toBe(true);
    const brief=await getResumeBrief(agent(1));
    expect(brief).toContain('Original imported task file');
    expect(brief).toContain(requirements);
    expect(brief).toContain(workerPrompt);
    expect(brief).toContain('Blocker preflight is clear');
    expect(brief).toContain(oldUrl);
    expect(brief).toContain('replacement-worker');
    expect((await db.agents.get(agent(1)))?.chatUrl).toBe('https://chatgpt.com/c/replacement-worker');
  });

  it('imports six agents per feature and rolls back duplicate registration', async () => {
    const {teams,batchId:existingBatchId}=await setup();
    expect(await db.agents.count()).toBe(12);
    expect(await importBatch('same-work.md',requirements)).toBe(existingBatchId);
    expect(await db.agents.count()).toBe(12);
    const batchId=await importBatch('other.md',requirements.replace('Build feature two.','Build a distinct second feature.'));
    const [other]=await db.teams.where('batchId').equals(batchId).toArray();
    const target=other.id+':A0';
    const existing=await db.agents.get(teams[0].id+':A0');
    const before=await db.events.count();
    await expect(registerChat(target,existing!.chatUrl!)).rejects.toThrow();
    expect((await db.agents.get(target))?.state).toBe('UNREGISTERED');
    expect(await db.events.count()).toBe(before);
  });

  it('serializes competing reservations and duplicate handoffs; recovers after reopening', async () => {
    const {teams,batchId}=await setup();
    const results=await Promise.allSettled(teams.map(t=>queuePrompt(t.id+':A0')));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const [order]=await db.orders.toArray();
    const handoffs=await Promise.allSettled([getPendingPrompt(order.id),getPendingPrompt(order.id)]);
    expect(handoffs.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    db.close(); await db.open();
    expect((await db.orders.get(order.id))?.handoffAt).toBeTruthy();
    await expect(getPendingPrompt(order.id)).rejects.toThrow(/already prepared/);
    await pauseAllBatches('USAGE_LIMIT');
    expect((await db.batches.get(batchId))?.pauseReason).toBe('USAGE_LIMIT');
    await expect(queuePrompt(teams.find(t=>t.id!==order.teamId)!.id+':A0')).rejects.toThrow(/paused/i);
    await confirmOrder(order.id);
    await markStopped(order.agentId);
    expect((await db.orders.get(order.id))?.stoppedAt).toBeTruthy();
    await pauseBatch(batchId,false);
    const next=await queuePrompt(teams.find(t=>t.id!==order.teamId)!.id+':A0');
    await cancelOrder(next.id);
    expect((await db.orders.get(next.id))?.state).toBe('CANCELLED');
  });

  it('runs a full reviewed six-agent workflow with dependency gates and replay protection', async () => {
    const {team,agent}=await setup();
    await expect(queuePrompt(agent(1))).rejects.toThrow(/plan/i);
    await execute(agent(0));
    await approveTeamPlan(team.id,planPacket(team.id));
    await expect(queuePrompt(agent(2))).rejects.toThrow(/prerequisites/);
    await expect(finalizeTeam(team.id)).rejects.toThrow();
    let priorReport:Record<string,unknown>|undefined;
    for(let n=1;n<=5;n++){
      const order=await execute(agent(n));
      const report={type:'AGENT_STATUS',messageId:'r'+n,teamId:team.id,agentId:n,executionId:order.id,status:'READY_FOR_REVIEW',completed:['Reviewed work'],remaining:[],dependencies:[]};
      const raw=JSON.stringify([report]);
      const count=await db.messages.count();
      expect(await importProtocolBatch(team.id,agent(n),raw)).toBe('IMPORTED');
      expect(await importProtocolBatch(team.id,agent(n),raw)).toBe('DUPLICATE');
      await expect(importProtocolBatch(team.id,agent(n),JSON.stringify([{...report,completed:['conflict']}]))).rejects.toThrow(/different content/);
      expect(await db.messages.count()).toBe(count+1);
      if(priorReport)expect(await importProtocolBatch(team.id,agent(0),JSON.stringify([priorReport]))).toBe('STATUS_ONLY');
      const accept={type:'DISPATCH_ORDER',orderId:'accept-'+n,teamId:team.id,sourceAgentId:0,targetAgentId:n,action:'ACCEPT',prompt:'Accept reviewed work',expectedResult:'Accepted',targetExecutionId:order.id,targetReportId:report.messageId};
      await expect(importProtocolBatch(team.id,agent(0),JSON.stringify([{...accept,targetExecutionId:'stale'}]))).rejects.toThrow(/stale/);
      expect(await importProtocolBatch(team.id,agent(0),JSON.stringify([...(priorReport?[priorReport]:[]),accept]))).toBe('IMPORTED');
      expect((await db.agents.get(agent(n)))?.state).toBe('COMPLETED');
      priorReport=report;
    }
    await expect(finalizeTeam(team.id)).rejects.toThrow(/notifications/i);
    for(const n of await db.notifications.where('teamId').equals(team.id).toArray()) await acknowledgeNotification(team.id,n.id);
    await finalizeTeam(team.id);
    expect((await db.teams.get(team.id))?.finalizedAt).toBeTruthy();
    await expect(queuePrompt(agent(0))).rejects.toThrow(/finalized/i);
    db.close(); await db.open();
    expect((await db.teams.get(team.id))?.finalizedAt).toBeTruthy();
  });

  it('stamps the first worker prompts as cycle 1 and advances once for a combined A0 resume batch', async () => {
    const {team,agent}=await setup();
    await execute(agent(0));
    await approveTeamPlan(team.id,planPacket(team.id));
    expect((await db.teams.get(team.id))?.cycleNumber).toBe(1);
    const first=await execute(agent(1));
    expect(first.cycleNumber).toBe(1);
    const report={type:'AGENT_STATUS',messageId:'cycle-1-report',teamId:team.id,agentId:1,executionId:first.id,status:'READY_FOR_REVIEW',completed:['Cycle one finished'],remaining:[],dependencies:[]};
    await importProtocolBatch(team.id,agent(1),JSON.stringify([report]));
    const actions=[
      {type:'DISPATCH_ORDER',orderId:'cycle-2-accept',teamId:team.id,sourceAgentId:0,targetAgentId:1,action:'ACCEPT',prompt:'Accept A1',expectedResult:'A1 accepted',targetExecutionId:first.id,targetReportId:report.messageId},
      {type:'DISPATCH_ORDER',orderId:'cycle-2-resume',teamId:team.id,sourceAgentId:0,targetAgentId:2,action:'RESUME',prompt:'Start A2 based on A1 result',expectedResult:'A2 result'},
    ];
    await importProtocolBatch(team.id,agent(0),JSON.stringify(actions));
    expect((await db.teams.get(team.id))?.cycleNumber).toBe(2);
    const second=await db.orders.where('agentId').equals(agent(2)).filter(order=>order.state==='PENDING').first();
    expect(second?.cycleNumber).toBe(2);
    expect(await getPendingPrompt(second!.id)).toContain('AgentSync cycle number: 2');
  });

  it('persists immutable GitHub bindings and rejects resource reuse between teams', async () => {
    const {teams}=await setup();
    const binding=makeBinding(teams[0],6,[1,2,3,4,5]);
    await saveGitHubBinding(teams[0].id,binding);
    await saveGitHubBinding(teams[0].id,binding);
    await expect(saveGitHubBinding(teams[0].id,makeBinding(teams[0],16,[11,12,13,14,15]))).rejects.toThrow(/cannot be replaced/);
    await expect(saveGitHubBinding(teams[1].id,makeBinding(teams[1],6,[7,8,9,10,11]))).rejects.toThrow(/another team/);
    expect((await db.teams.get(teams[1].id))?.pullRequestNumber).toBeUndefined();
    expect((await db.agents.get(teams[0].id+':A5'))?.issueNumber).toBe(5);
  });

  it('upgrades a v1 database without losing existing records', async () => {
    await db.delete();
    const legacy=new Dexie('AgentSync');
    legacy.version(1).stores({batches:'id,createdAt',teams:'id,batchId',agents:'id,teamId,&chatUrl',events:'id,teamId,createdAt',orders:'id,teamId,agentId,state,createdAt'});
    try {
      await legacy.open();
      await legacy.table('agents').add({id:'legacy:A0',teamId:'legacy',number:0,state:'READY',chatUrl:'https://chatgpt.com/c/legacy'});
    } finally { legacy.close(); }
    await db.open();
    expect((await db.agents.get('legacy:A0'))?.chatUrl).toBe('https://chatgpt.com/c/legacy');
    expect(await db.messages.count()).toBe(0);
    expect(await db.notifications.count()).toBe(0);
  });

  it('adds the event agentId index when upgrading an existing v5 database', async () => {
    await db.delete();
    const legacy=new Dexie('AgentSync');
    legacy.version(1).stores({batches:'id,createdAt',teams:'id,batchId',agents:'id,teamId,&chatUrl',events:'id,teamId,createdAt',orders:'id,teamId,agentId,state,createdAt'});
    legacy.version(2).stores({messages:'id,teamId,createdAt',notifications:'id,teamId,state,createdAt'});
    legacy.version(3).stores({bridgeObservations:'agentId,teamId,observedAt'});
    legacy.version(4).stores({history:'id,batchId,teamId,createdAt,kind,agentId'});
    legacy.version(5).stores({events:'id,teamId,createdAt'});
    try {
      await legacy.open();
      await legacy.table('events').add({id:'legacy:event',teamId:'legacy',agentId:'legacy:A0',createdAt:'2026-11-24T20:00:00.000Z',type:'AGENT_CHAT_SETUP_STARTED'});
    } finally { legacy.close(); }
    await db.open();
    expect(await db.events.where('agentId').equals('legacy:A0').count()).toBe(1);
    expect((await db.events.get('legacy:event'))?.type).toBe('AGENT_CHAT_SETUP_STARTED');
  });
});
