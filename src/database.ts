import Dexie, {type Table} from 'dexie';
import type {Agent,Batch,Team,Event,Order,AgentBridgeObservation,HistoryEntry,HistoryKind} from './core';
import {conversationUrl,event,makeBatch,makeOrder,initialPrompt,id,now} from './core';
import {parseRequirements} from './parser';
import {makeBinding,type GitHubBinding} from './github';
import {assertTeamCapacity,assertOrderIdentity} from './scheduler';
import {assertHandoffAvailable,stoppedExecution} from './execution';
import {parseSupervisorPlan,assertPlanApproval,assertTeamDispatch,completionBlockers} from './team-lifecycle';
import type {AgentStatus,StoredMessage,Notification} from './protocol';
import {parseMessage,parseMessageBatch,messageKey,checkReplay,assertSource,assertReport,dependencyCycle,assertAcceptance} from './protocol';
import {formatSupervisorUpdate,shouldNotifySupervisor,type ChatSnapshot} from './agent-bridge';
class AgentSyncDB extends Dexie {
  batches!:Table<Batch,string>;teams!:Table<Team,string>;agents!:Table<Agent,string>;events!:Table<Event,string>;orders!:Table<Order,string>;
  messages!:Table<StoredMessage,string>;notifications!:Table<Notification,string>;
  bridgeObservations!:Table<AgentBridgeObservation,string>;
  history!:Table<HistoryEntry,string>;
  constructor(){super('AgentSync');this.version(1).stores({batches:'id,createdAt',teams:'id,batchId',agents:'id,teamId,&chatUrl',events:'id,teamId,createdAt',orders:'id,teamId,agentId,state,createdAt'});this.version(2).stores({messages:'id,teamId,createdAt',notifications:'id,teamId,state,createdAt'});this.version(3).stores({bridgeObservations:'agentId,teamId,observedAt'});this.version(4).stores({history:'id,batchId,teamId,createdAt,kind,agentId'});this.version(5).stores({events:'id,teamId,createdAt,agentId'});this.version(6).stores({events:'id,teamId,createdAt,agentId'});}
}
export const db=new AgentSyncDB();
function historyEntry(team:Team,kind:HistoryKind,content:string,extra:Partial<HistoryEntry>={}):HistoryEntry{return {id:id(),batchId:team.batchId,teamId:team.id,kind,createdAt:now(),content,...extra};}
export async function importBatch(filename:string,raw:string){const {config,features}=parseRequirements(raw);const b=makeBatch(filename,config,features);return db.transaction('rw',[db.batches,db.teams,db.agents,db.events,db.history],async()=>{const existing=await db.history.where('kind').equals('TASK_FILE_IMPORTED').filter(entry=>entry.content===raw).first();if(existing)return existing.batchId;await db.batches.add(b.batch);await db.teams.bulkAdd(b.teams);await db.agents.bulkAdd(b.agents);await db.events.bulkAdd(b.events);await db.history.bulkAdd(b.teams.map(t=>historyEntry(t,'TASK_FILE_IMPORTED',raw,{detail:filename})));return b.batch.id;});}
export async function registerChat(agentId:string,raw:string){const url=conversationUrl(raw);await db.transaction('rw',db.agents,db.events,async()=>{const a=await db.agents.get(agentId);if(!a)throw new Error('Unknown agent.');if(a.chatUrl===url)return;if(a.chatUrl||a.state!=='UNREGISTERED')throw new Error('Conversation registration is immutable for this agent.');await db.agents.update(agentId,{chatUrl:url,state:'READY'});await db.events.add(event(a.teamId,'CHAT_REGISTERED',a.id));});}
export async function authorizeChatSetupRetry(agentId:string){const agent=await db.agents.get(agentId);if(!agent)throw new Error('Unknown worker chat.');if(agent.chatUrl)throw new Error('This worker already has a registered chat.');const started=await db.events.where('agentId').equals(agentId).filter(item=>item.type==='AGENT_CHAT_SETUP_STARTED').toArray();const latest=started.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);if(!latest)throw new Error('There is no previous setup attempt to retry.');const already=await db.events.where('agentId').equals(agentId).filter(item=>item.type==='AGENT_CHAT_SETUP_RETRY_AUTHORIZED'&&item.detail===latest.id).first();if(already)throw new Error('A retry is already authorized for the latest setup attempt.');await db.events.add(event(agent.teamId,'AGENT_CHAT_SETUP_RETRY_AUTHORIZED',agent.id,latest.id));}
export async function isChatSetupRetryAuthorized(agentId:string,attemptId:string){return Boolean(await db.events.where('agentId').equals(agentId).filter(item=>item.type==='AGENT_CHAT_SETUP_RETRY_AUTHORIZED'&&item.detail===attemptId).first());}
export async function replaceChat(agentId:string,raw:string){const url=conversationUrl(raw);await db.transaction('rw',[db.agents,db.teams,db.orders,db.events,db.history,db.bridgeObservations],async()=>{const a=await db.agents.get(agentId);if(!a)throw new Error('Unknown agent.');if(!a.chatUrl)throw new Error('This agent has no saved chat to replace.');if(a.chatUrl===url)throw new Error('Enter a different conversation link.');if(['WORKING','COMPLETED','UNREGISTERED'].includes(a.state))throw new Error('Stop active work before replacing its chat link.');if(await db.orders.where('agentId').equals(a.id).filter(o=>o.state==='PENDING').count())throw new Error('Resolve the pending prompt before replacing this chat.');const team=await db.teams.get(a.teamId);if(!team)throw new Error('Unknown team.');await db.history.add(historyEntry(team,'CHAT_LINK_REPLACED','Replacement chat registered. Existing task and execution history stays attached to this agent.',{agentId:a.id,agentNumber:a.number,previousChatUrl:a.chatUrl,chatUrl:url,executionId:a.lastOrderId}));await db.agents.update(a.id,{chatUrl:url,state:'READY'});await db.bridgeObservations.delete(a.id);await db.events.add(event(a.teamId,'CHAT_LINK_REPLACED',a.id,JSON.stringify({previous:a.chatUrl,replacement:url})));});}
export async function recordBridgePrompt(agentId:string,executionId:string,prompt:string){const agent=await db.agents.get(agentId);if(!agent)throw new Error('Unknown agent.');const team=await db.teams.get(agent.teamId);if(!team)throw new Error('Unknown team.');await db.history.add(historyEntry(team,'PROMPT_CONFIRMED_SENT',prompt,{agentId:agent.id,agentNumber:agent.number,executionId,chatUrl:agent.chatUrl,detail:'Submitted by the enabled A0 bridge.'}));}
export async function queuePrompt(agentId:string,custom?:string){return db.transaction('rw',db.agents,db.teams,db.batches,db.orders,db.events,async()=>{const a=await db.agents.get(agentId);if(!a)throw new Error('Unknown agent');const t=await db.teams.get(a.teamId);if(!t)throw new Error('Unknown team');const batch=await db.batches.get(t.batchId);if(!batch||batch.paused)throw new Error('Batch is paused');const pending=await db.orders.where('agentId').equals(a.id).filter(o=>o.state==='PENDING').first();if(pending)throw new Error('An order is already pending for this agent.');assertTeamDispatch(t,a,await db.agents.where('teamId').equals(t.id).toArray());assertTeamCapacity(batch,t,await db.teams.where('batchId').equals(batch.id).toArray(),await db.agents.toArray(),await db.orders.where('state').equals('PENDING').toArray());const cycleNumber=t.cycleNumber??(a.number===0?0:1);const o=makeOrder(t,a,custom??initialPrompt(t,a),cycleNumber);await db.orders.add(o);await db.events.add(event(t.id,'ORDER_QUEUED',a.id,JSON.stringify({orderId:o.id,cycleNumber})));return o;});}
export async function confirmOrder(orderId:string,exactSubmittedPrompt?:string,baselineMessageId?:string){await db.transaction('rw',[db.orders,db.agents,db.teams,db.batches,db.events,db.history],async()=>{const o=await db.orders.get(orderId);if(!o||o.state!=='PENDING')throw new Error('Order is not pending.');const a=await db.agents.get(o.agentId);const t=await db.teams.get(o.teamId);const b=t&&await db.batches.get(t.batchId);if(!a||!t||!b)throw new Error('Agent or batch unavailable.');assertOrderIdentity(o,a,t);const confirmedAt=now();await db.orders.update(o.id,{state:'CONFIRMED',confirmedAt,baselineMessageId});await db.agents.update(a.id,{state:'WORKING',lastOrderId:o.id,lastReportId:undefined});const prepared=exactSubmittedPrompt??(await db.history.where('teamId').equals(t.id).filter(item=>item.kind==='PROMPT_PREPARED'&&item.executionId===o.id).first())?.content??o.prompt;await db.history.add(historyEntry(t,'PROMPT_CONFIRMED_SENT',prepared,{agentId:a.id,agentNumber:a.number,executionId:o.id,chatUrl:a.chatUrl,detail:`Cycle ${o.cycleNumber??0}; prompt submission confirmed.`}));await db.events.add(event(a.teamId,'ORDER_USER_CONFIRMED',a.id,JSON.stringify({orderId:o.id,cycleNumber:o.cycleNumber??0})));});}
export async function markStopped(agentId:string){await db.transaction('rw',db.agents,db.events,db.notifications,db.orders,async()=>{const a=await db.agents.get(agentId);if(!a||a.state!=='WORKING')throw new Error('Agent is not working.');const o=a.lastOrderId?await db.orders.get(a.lastOrderId):undefined;if(o&&stoppedExecution(o,a))await db.orders.update(o.id,{stoppedAt:now()});await db.agents.update(a.id,{state:'STOPPED'});await db.events.add(event(a.teamId,'AGENT_STOPPED_USER_REPORTED',a.id,a.lastOrderId));if(a.number!==0)await notify(a,'AGENT_STOPPED','User reported generation stopped. Await the structured execution report.');});}
export async function observeRegisteredChat(snapshot:ChatSnapshot){
  return db.transaction('rw',[db.agents,db.teams,db.batches,db.orders,db.events,db.notifications,db.bridgeObservations,db.history],async()=>{
    const agent=await db.agents.where('chatUrl').equals(snapshot.conversationUrl).first();
    if(!agent||agent.chatUrl!==snapshot.conversationUrl)throw new Error('Page is not a registered AgentSync chat.');
    const team=await db.teams.get(agent.teamId),batch=team&&await db.batches.get(team.batchId);
    if(!team||!batch)throw new Error('Registered chat team is unavailable.');
    const previous=await db.bridgeObservations.get(agent.id);
    if(previous&&Date.parse(snapshot.observedAt)<=Date.parse(previous.observedAt))return {agent,team,batch,newAssistantMessage:false,stoppedExecutionId:undefined as string|undefined};
    const newMessage=Boolean(snapshot.state==='IDLE'&&snapshot.latestMessageId&&snapshot.latestMessage.trim()&&(snapshot.latestMessageId!==previous?.latestMessageId||previous?.state==='GENERATING'||previous?.state==='UNKNOWN'));
    if(newMessage)await db.history.add(historyEntry(team,'CHAT_MESSAGE_OBSERVED',snapshot.latestMessage,{agentId:agent.id,agentNumber:agent.number,executionId:agent.lastOrderId,chatUrl:agent.chatUrl,detail:JSON.stringify({role:snapshot.latestRole,messageId:snapshot.latestMessageId,state:snapshot.state,observedAt:snapshot.observedAt})}));
    const observation:AgentBridgeObservation={agentId:agent.id,teamId:agent.teamId,state:snapshot.state,flow:snapshot.flow,flowTrail:snapshot.flowTrail,composerState:snapshot.composerState,buttonState:snapshot.buttonState,voiceVisible:snapshot.voiceVisible,voiceEnabled:snapshot.voiceEnabled,arrowVisible:snapshot.arrowVisible,arrowEnabled:snapshot.arrowEnabled,stopVisible:snapshot.stopVisible,stopEnabled:snapshot.stopEnabled,composerMode:snapshot.composerMode,effort:snapshot.effort,latestRole:snapshot.latestRole,latestMessageId:snapshot.latestMessageId,latestMessage:snapshot.latestMessage,observedAt:snapshot.observedAt};
    await db.bridgeObservations.put(observation);
    const newAssistantMessage=snapshot.latestRole==='assistant'&&Boolean(snapshot.latestMessageId)&&(snapshot.latestMessageId!==previous?.latestMessageId||(previous?.state==='GENERATING'&&snapshot.state==='IDLE'));
    const order=agent.lastOrderId?await db.orders.get(agent.lastOrderId):undefined;
    const newReplyAfterOrder=Boolean(order&&order.state==='CONFIRMED'&&!order.stoppedAt&&order.confirmedAt&&snapshot.state==='IDLE'&&snapshot.latestRole==='assistant'&&snapshot.latestMessageId&&snapshot.latestMessageId!==order.baselineMessageId&&Date.parse(snapshot.observedAt)>=Date.parse(order.confirmedAt));
    if(agent.number===0){
      const planningFinished=Boolean((previous?.state==='GENERATING'||newReplyAfterOrder)&&snapshot.state==='IDLE'&&snapshot.latestRole==='assistant'&&agent.state==='WORKING'&&order&&order.state==='CONFIRMED'&&order.agentId===agent.id&&order.teamId===team.id&&!order.stoppedAt);
      if(planningFinished){await db.orders.update(order!.id,{stoppedAt:snapshot.observedAt});await db.agents.update(agent.id,{state:'STOPPED'});await db.events.add(event(team.id,'A0_PLANNING_FINISHED_OBSERVED',agent.id,order!.id));}
      return {agent:planningFinished?{...agent,state:'STOPPED' as const}:agent,team,batch,newAssistantMessage,stoppedExecutionId:undefined as string|undefined};
    }
    const justStopped=(shouldNotifySupervisor(previous,snapshot)||newReplyAfterOrder)&&agent.state==='WORKING'&&Boolean(agent.lastOrderId);
    if(!justStopped)return {agent,team,batch,newAssistantMessage,stoppedExecutionId:undefined as string|undefined};
    if(!order||!stoppedExecution(order,agent))return {agent,team,batch,newAssistantMessage,stoppedExecutionId:undefined as string|undefined};
    await db.orders.update(order.id,{stoppedAt:snapshot.observedAt});
    await db.agents.update(agent.id,{state:'STOPPED'});
    await db.events.add(event(team.id,'AGENT_STOPPED_BRIDGE_OBSERVED',agent.id,order.id));
    const notificationId=id();
    const notification:Notification={id:notificationId,teamId:team.id,agentId:agent.number,type:'AGENT_STOPPED',detail:JSON.stringify({kind:'AGENTSYNC_WORKER_STOP',deliveryId:notificationId,executionId:order.id,cycleNumber:order.cycleNumber??0,update:formatSupervisorUpdate(agent,order.id,snapshot,notificationId,order.cycleNumber??0)}),createdAt:snapshot.observedAt,state:'PENDING'};
    await db.notifications.add(notification);
    return {agent:{...agent,state:'STOPPED' as const},team,batch,newAssistantMessage,stoppedExecutionId:order.id};
  });
}
export async function getBridgeObservation(agentId:string){return db.bridgeObservations.get(agentId);}
export async function getPendingBridgeUpdates(teamId:string){
  return (await db.notifications.where('teamId').equals(teamId).filter(item=>item.type==='AGENT_STOPPED'&&item.state==='PENDING').toArray()).flatMap(item=>{
    try{const value=JSON.parse(item.detail);if(value?.kind==='AGENTSYNC_WORKER_STOP'&&value.deliveryId===item.id&&typeof value.update==='string'&&typeof value.executionId==='string')return [{notificationId:item.id,agentNumber:item.agentId,executionId:value.executionId,cycleNumber:Number.isSafeInteger(value.cycleNumber)?value.cycleNumber:0,deliveryId:value.deliveryId,update:value.update}];}catch{/* Legacy/manual stop notifications do not include bridge payloads. */}
    return [];
  });
}
export async function getResumeBrief(agentId:string){
  const agent=await db.agents.get(agentId);if(!agent)throw new Error('Unknown agent.');
  const team=await db.teams.get(agent.teamId);if(!team)throw new Error('Unknown team.');
  const history=(await db.history.where('teamId').equals(team.id).sortBy('createdAt'));
  const task=history.find(entry=>entry.kind==='TASK_FILE_IMPORTED');
  const a0Id=`${team.id}:A0`;
  const confirmed=new Set(history.filter(entry=>entry.kind==='PROMPT_CONFIRMED_SENT').map(entry=>entry.executionId));
  const relevant=history.filter(entry=>entry.kind!=='TASK_FILE_IMPORTED'&&(entry.agentId===agent.id||entry.agentId===a0Id||entry.kind==='PROTOCOL_MESSAGE_IMPORTED'||entry.kind==='PROMPT_PREPARED'||entry.kind==='PROMPT_CONFIRMED_SENT')&&!(entry.kind==='PROMPT_PREPARED'&&confirmed.has(entry.executionId)));
  const transcript=relevant.map(entry=>[
    `### ${entry.createdAt} · ${entry.kind}${entry.agentNumber!==undefined?` · A${entry.agentNumber}`:''}`,
    entry.executionId?`Execution: ${entry.executionId}`:'',entry.chatUrl?`Chat link: ${entry.chatUrl}`:'',entry.previousChatUrl?`Previous chat link: ${entry.previousChatUrl}`:'',entry.detail?`Details: ${entry.detail}`:'',entry.content
  ].filter(Boolean).join('\n')).join('\n\n');
  return [
    `AgentSync replacement-chat resume context`,
    `Team: ${team.title} (${team.id})`,
    `Repository: ${team.repository} | base ${team.baseBranch} | branch ${team.branch}`,
    `Approved A0 plan: ${team.plan?JSON.stringify(team.plan):'none recorded'}`,
    `Agent to resume: A${agent.number} — ${agent.role} (${agent.id})`,
    `Current registered chat: ${agent.chatUrl??'none'}; prior links are recorded below.`,
    `Current work state: ${agent.state}; latest execution: ${agent.lastOrderId??'none'}.`,
    `Use this record to continue the existing task, not restart it. Identify genuine work blockers before assigning any new work. If user input is needed, ask one finite batch of questions with 2–4 plain-text options each and mark a written Recommended option. Do not treat ordinary file access as a blocker; do not ask repeated or open-ended questions. Report any gaps in saved history honestly.`,
    `\n## Original imported task file (${task?.detail??'not retained'})\n${task?.content??'Original task file was not retained.'}`,
    `\n## Saved prompts, A0 decisions, chat responses, reports, and link changes\n${transcript||'No chat messages or prompts have been captured yet.'}`,
    `\n## Resume request\nReview the task file and saved history. Summarize the last verified state and remaining work, identify only concrete blockers, then provide one bounded prompt for the replacement A${agent.number} chat. Preserve task scope, completed work, decisions, branch/resource references and test evidence. Do not invent missing transcript content. After the replacement chat is created, AgentSync will attach its URL to this same agent record.`
  ].join('\n\n');
}
export async function pauseBatch(batchId:string,paused:boolean){
  await db.transaction('rw',db.batches,db.teams,db.events,async()=>{
    const b=await db.batches.get(batchId);if(!b)throw new Error('Unknown batch.');
    await db.batches.update(batchId,{paused,pauseReason:paused?'MANUAL':undefined});
    for(const t of await db.teams.where('batchId').equals(batchId).toArray())await db.events.add(event(t.id,paused?'BATCH_PAUSED':'BATCH_RESUMED'));
  });
}
export async function pauseAllBatches(reason:'USAGE_LIMIT'|'EMERGENCY'){
  await db.transaction('rw',db.batches,db.teams,db.events,async()=>{
    await db.batches.toCollection().modify({paused:true,pauseReason:reason});
    for(const t of await db.teams.toArray())await db.events.add(event(t.id,reason==='USAGE_LIMIT'?'USAGE_LIMIT_USER_REPORTED':'EMERGENCY_PAUSE_USER_REQUESTED'));
  });
}
export async function assertNotificationHandoff(teamId:string,notificationId:string){
  await db.transaction('r',db.teams,db.batches,db.notifications,async()=>{
    const t=await db.teams.get(teamId),n=await db.notifications.get(notificationId);
    const b=t&&await db.batches.get(t.batchId);
    if(!b||b.paused||!n||n.teamId!==teamId||n.state!=='PENDING')throw new Error('Notification unavailable or batch paused.');
  });
}

// Confirmation records a real, already-submitted manual prompt, even if the
// batch was paused meanwhile. It does not itself submit anything.
export async function getPendingPrompt(orderId:string){
  return db.transaction('rw',[db.orders,db.agents,db.teams,db.batches,db.events,db.history],async()=>{
    const o=await db.orders.get(orderId);
    if(!o)throw new Error('Unknown order.');
    const a=await db.agents.get(o.agentId),t=await db.teams.get(o.teamId);
    const b=t&&await db.batches.get(t.batchId);
    if(!a||!t||!b)throw new Error('Agent or batch unavailable.');
    assertTeamDispatch(t,a,await db.agents.where('teamId').equals(t.id).toArray());
    assertHandoffAvailable(o,a,t,b);
    const prepared= o.prompt + '\n\nAgentSync cycle number: '+(o.cycleNumber??0)+'\n\n' + (a.number===0?(t.plan?'Approved plan: '+JSON.stringify(t.plan):'Before developer dispatch, propose a JSON array of five assignments with agent (1–5), scope (string), and requires (array of prerequisite agent numbers). Avoid dependency cycles. The user will press Continue after resolving any blockers; AgentSync will validate this reply and start the first work cycle.'):'Approved assignment: '+JSON.stringify(t.plan?.find(p=>p.agent===a.number))) + '\n\n' + protocolInstructions(t,a,o.id);
    await db.orders.update(o.id,{handoffAt:now()});
    await db.history.add(historyEntry(t,'PROMPT_PREPARED',prepared,{agentId:a.id,agentNumber:a.number,executionId:o.id,chatUrl:a.chatUrl}));
    await db.events.add(event(o.teamId,'ORDER_HANDOFF_PREPARED',a.id,o.id));
    return prepared;
  });
}
export async function cancelOrder(orderId:string){
  await db.transaction('rw',db.orders,db.events,async()=>{
    const o=await db.orders.get(orderId);
    if(!o||o.state!=='PENDING')throw new Error('Order is not pending.');
    await db.orders.update(o.id,{state:'CANCELLED',cancelledAt:now()});
    await db.events.add(event(o.teamId,'ORDER_CANCELLED',o.agentId,o.id));
  });
}

function protocolInstructions(team:Team,agent:Agent,executionId:string):string {
  if(agent.number===0)return 'AgentSync protocol:\n\n'+[
    'A0 planning blocker flow: while any preflight blocker or user decision remains unresolved, reply in ordinary conversational text, explain what is blocked, ask only the needed questions, and do not return JSON or a partial plan. Continue the discussion until resolved; never call a blocked plan CLEAR. Once preflight is genuinely clear, return exactly one AGENTSYNC_PLAN entry in a JSON array with this teamId, preflight CLEAR, blockers:[], and exactly five assignments {agent,scope,requires}. The user will click Continue to apply this plan and start cycle 1. Afterward, process each combined worker-cycle handoff and return the latest known AGENT_STATUS reports plus zero or more DISPATCH_ORDER entries as one JSON array. If blocked during a cycle, explain it in normal text and wait for the user to discuss and click Continue after a clear response.',
    'Before sending, validate the response as strict JSON. Use double quotes for keys and strings; inside strings escape double quotes as \\" and literal backslashes as \\\\. Apostrophes and forward slashes are ordinary characters; do not put backslashes before apostrophes or spaces. Use only valid JSON escapes, and never output HTML entities such as &#x20;. Keep the JSON as a raw array with normal spaces and line breaks.',
    'During review return a JSON array containing the latest known AGENT_STATUS reports (copy each report exactly) and zero or more DISPATCH_ORDER entries. For each developer, include its current known status or its next action; do not invent or rewrite reports. Omit status when no report exists. Orders need unique orderId, exact teamId, sourceAgentId 0, targetAgentId 1-5, action RESUME or ACCEPT, prompt, expectedResult; ACCEPT also requires exact targetExecutionId and targetReportId and only applies to a verified READY_FOR_REVIEW report. Put ACCEPT before dependent RESUME. Return [] when there is no new report or action. AgentSync validates the full array atomically. Do not claim GitHub writes or merges.',
    'Example planning array: [{"type":"AGENTSYNC_PLAN","teamId":"'+team.id+'","preflight":"CLEAR","blockers":[],"plan":[{"agent":1,"scope":"bounded assignment","requires":[]},{"agent":2,"scope":"bounded assignment","requires":[1]},{"agent":3,"scope":"bounded assignment","requires":[1]},{"agent":4,"scope":"bounded assignment","requires":[1,2,3]},{"agent":5,"scope":"bounded assignment","requires":[1,2,3,4]}]}].'
  ].join('\n\n');
  return 'AgentSync protocol:\n\n'+[
    'Worker protocol: your final response is only one complete JSON array containing exactly one AGENT_STATUS object. No prose or Markdown fences. Use a new messageId, exact teamId, agentId and executionId; status BLOCKED, IN_PROGRESS or READY_FOR_REVIEW; completed, remaining and dependencies arrays. A dependency is {"agentId":1,"artifact":"specific required artifact","status":"MISSING" or "AVAILABLE"}. READY_FOR_REVIEW requires remaining:[] and no MISSING dependencies. Put the exact blocker and needed user/environment action in remaining.',
    'Example: [{"type":"AGENT_STATUS","messageId":"new-unique-id","teamId":"'+team.id+'","agentId":'+agent.number+',"executionId":"'+executionId+'","status":"IN_PROGRESS","completed":[],"remaining":["remaining step"],"dependencies":[]}].'
  ].join('\n\n');
}
async function notify(a:Agent,type:Notification['type'],detail:string){
  await db.notifications.add({id:id(),teamId:a.teamId,agentId:a.number,type,detail,createdAt:now(),state:'PENDING'});
}
async function latestReport(agent:Agent):Promise<AgentStatus|undefined>{
  if(!agent.lastReportId)return undefined;
  const item=await db.messages.get(JSON.stringify([agent.teamId,'AGENT_STATUS',agent.lastReportId]));
  const report=item?.message;
  if(report?.type==='AGENT_STATUS'&&report.agentId===agent.number&&report.executionId===agent.lastOrderId)return report;
  return undefined;
}
async function applyProtocolMessage(team:Team,source:Agent,m:AgentStatus|Extract<ReturnType<typeof parseMessage>,{type:'DISPATCH_ORDER'}>,raw:string,cycleNumber=team.cycleNumber??1):Promise<boolean>{
  assertSource(m,team,source);
  const key=messageKey(m);
  if(checkReplay(await db.messages.get(key),m))return false;
  if(team.finalizedAt)throw new Error('Team has been finalized locally.');
  if(m.type==='AGENT_STATUS'){
    assertReport(m,source);
    await db.agents.update(source.id,{lastReportId:m.messageId,state:m.status==='BLOCKED'?'BLOCKED':'STOPPED'});
    await db.messages.add({id:key,teamId:team.id,createdAt:now(),message:m});
    await db.history.add(historyEntry(team,'PROTOCOL_MESSAGE_IMPORTED',raw,{agentId:source.id,agentNumber:source.number,executionId:m.executionId,chatUrl:source.chatUrl,detail:m.type}));
    const current=await db.agents.where('teamId').equals(team.id).toArray();
    const reports=(await Promise.all(current.filter(a=>a.state!=='COMPLETED').map(latestReport))).filter((a):a is AgentStatus=>a!==undefined);
    const cycle=dependencyCycle(reports);
    const detail=JSON.stringify([m])+(cycle?'\nCircular dependency: '+cycle.map(n=>'A'+n).join(' → '):'');
    await notify(source,'AGENT_STATUS',detail);
    await db.events.add(event(team.id,'AGENT_STATUS_IMPORTED',source.id,m.messageId));
    if(cycle)await db.events.add(event(team.id,'DEPENDENCY_CYCLE_DETECTED',source.id,cycle.map(n=>'A'+n).join(' → ')));
  }else{
    if(source.state!=='STOPPED'||!source.lastOrderId)throw new Error('Record the supervisor execution as stopped before importing an order.');
    const target=await db.agents.get(team.id+':A'+m.targetAgentId);
    if(!target||target.teamId!==team.id||target.number!==m.targetAgentId)throw new Error('Unknown target agent.');
    const pending=await db.orders.where('agentId').equals(target.id).filter(o=>o.state==='PENDING').first();
    if(m.action==='ACCEPT'){
      if(m.targetExecutionId!==target.lastOrderId||m.targetReportId!==target.lastReportId)throw new Error('Acceptance references a stale or unknown execution report.');
      assertAcceptance(target,await latestReport(target),Boolean(pending));
      await db.agents.update(target.id,{state:'COMPLETED'});
      await db.events.add(event(team.id,'AGENT_ACCEPTED_LOCALLY',target.id,m.orderId));
    }else{
      const batch=await db.batches.get(team.batchId);
      if(!batch||pending)throw new Error('Target has pending work or batch is unavailable.');
      assertTeamDispatch(team,target,await db.agents.where('teamId').equals(team.id).toArray());
      assertTeamCapacity(batch,team,await db.teams.where('batchId').equals(batch.id).toArray(),await db.agents.toArray(),await db.orders.where('state').equals('PENDING').toArray());
      if(!['READY','STOPPED','BLOCKED'].includes(target.state))throw new Error('Target is not available.');
      const order=makeOrder(team,target,m.prompt+'\n\nExpected result: '+m.expectedResult,cycleNumber);
      await db.orders.add(order);
      await db.events.add(event(team.id,'SUPERVISOR_ORDER_QUEUED',target.id,m.orderId));
    }
    await db.messages.add({id:key,teamId:team.id,createdAt:now(),message:m});
    await db.history.add(historyEntry(team,'PROTOCOL_MESSAGE_IMPORTED',raw,{agentId:source.id,agentNumber:source.number,executionId:source.lastOrderId,chatUrl:source.chatUrl,detail:m.type}));
  }
  return true;
}
async function importProtocolMessages(teamId:string,sourceId:string,messages:ReturnType<typeof parseMessage>[],raw:string):Promise<'IMPORTED'|'DUPLICATE'|'STATUS_ONLY'>{
  return db.transaction('rw',[db.teams,db.batches,db.agents,db.orders,db.events,db.messages,db.notifications,db.history],async()=>{
    const team=await db.teams.get(teamId),source=await db.agents.get(sourceId);
    if(!team||!source)throw new Error('Unknown team or source agent.');
    let imported=false,statusSnapshots=false,newResume=false;
    const nextCycle=(team.cycleNumber??1)+1;
    for(const m of messages){
      if(source.number===0&&m.type==='AGENT_STATUS'){
        const target=await db.agents.get(teamId+':A'+m.agentId);
        const report=target&&await latestReport(target);
        if(!report||JSON.stringify(report)!==JSON.stringify(m))throw new Error('A0 status snapshots must exactly match an already imported developer report.');
        statusSnapshots=true;
        continue;
      }
      const applied=await applyProtocolMessage(team,source,m,raw,m.type==='DISPATCH_ORDER'&&m.action==='RESUME'?nextCycle:(team.cycleNumber??1));
      if(applied){imported=true;if(m.type==='DISPATCH_ORDER'&&m.action==='RESUME')newResume=true;}
    }
    if(newResume)await db.teams.update(team.id,{cycleNumber:nextCycle});
    return imported?'IMPORTED':statusSnapshots?'STATUS_ONLY':'DUPLICATE';
  });
}
export async function importProtocolMessage(teamId:string,sourceId:string,raw:string):Promise<'IMPORTED'|'DUPLICATE'>{
  const result=await importProtocolMessages(teamId,sourceId,[parseMessage(raw)],raw);
  return result==='STATUS_ONLY'?'DUPLICATE':result;
}
export async function importProtocolBatch(teamId:string,sourceId:string,raw:string):Promise<'IMPORTED'|'DUPLICATE'|'STATUS_ONLY'>{
  return importProtocolMessages(teamId,sourceId,parseMessageBatch(raw),raw);
}
export async function acknowledgeNotification(teamId:string,notificationId:string){
  await db.transaction('rw',db.notifications,db.events,async()=>{
    const n=await db.notifications.get(notificationId);
    if(!n||n.teamId!==teamId||n.state!=='PENDING')throw new Error('Unknown or acknowledged notification.');
    await db.notifications.update(n.id,{state:'ACKNOWLEDGED'});
    await db.events.add(event(teamId,'SUPERVISOR_NOTIFICATION_ACKNOWLEDGED',undefined,n.id));
  });
}

export async function saveGitHubBinding(teamId:string,binding:GitHubBinding){
  await db.transaction('rw',[db.teams,db.agents,db.events],async()=>{
    const t=await db.teams.get(teamId);
    if(!t||t.repository!==binding.repository||t.branch!==binding.branch||t.baseBranch!==binding.baseBranch)throw new Error('Team configuration changed.');
    const validated=makeBinding(t,binding.pullRequestNumber,binding.issueNumbers);
    const agents=(await db.agents.where('teamId').equals(teamId).toArray()).filter(a=>a.number!==0).sort((a,b)=>a.number-b.number);
    if(agents.length!==5||agents.some((a,i)=>a.number!==i+1))throw new Error('Expected five developer agents.');
    if(t.pullRequestNumber!==undefined&&t.pullRequestNumber!==validated.pullRequestNumber||agents.some((a,i)=>a.issueNumber!==undefined&&a.issueNumber!==validated.issueNumbers[i]))throw new Error('Existing GitHub binding cannot be replaced.');
    const other=(await db.teams.toArray()).filter(x=>x.id!==teamId&&x.repository.toLowerCase()===t.repository.toLowerCase());
    const otherIds=new Set(other.map(x=>x.id));
    const used=new Set([...other.map(x=>x.pullRequestNumber),...(await db.agents.toArray()).filter(a=>otherIds.has(a.teamId)).map(a=>a.issueNumber)]);
    if([validated.pullRequestNumber,...validated.issueNumbers].some(n=>used.has(n)))throw new Error('A GitHub resource is already bound to another team.');
    if(t.pullRequestNumber===validated.pullRequestNumber&&agents.every((a,i)=>a.issueNumber===validated.issueNumbers[i]))return;
    await db.teams.update(t.id,{pullRequestNumber:validated.pullRequestNumber});
    for(const [i,a] of agents.entries())await db.agents.update(a.id,{issueNumber:validated.issueNumbers[i]});
    await db.events.add(event(teamId,'GITHUB_RESOURCES_BOUND',undefined,JSON.stringify(validated)));
  });
}

export async function approveTeamPlan(teamId:string,raw:string){
  const packet=parseSupervisorPlan(raw);
  if(packet.teamId!==teamId)throw new Error('A0 plan is for a different feature team.');
  const plan=packet.plan;
  await db.transaction('rw',[db.teams,db.agents,db.orders,db.events],async()=>{
    const team=await db.teams.get(teamId);
    if(!team)throw new Error('Unknown team.');
    const agents=await db.agents.where('teamId').equals(teamId).toArray();
    const orders=await db.orders.where('teamId').equals(teamId).toArray();
    assertPlanApproval(team,agents,orders,true);
    const supervisor=agents.find(agent=>agent.number===0)!;
    if(supervisor.state==='WORKING'){
      const latest=orders.find(order=>order.id===supervisor.lastOrderId)!;
      const stoppedAt=now();
      await db.orders.update(latest.id,{stoppedAt});
      await db.agents.update(supervisor.id,{state:'STOPPED'});
      await db.events.add(event(teamId,'A0_PLANNING_FINISHED_USER_CONFIRMED',supervisor.id,latest.id));
    }
    await db.teams.update(teamId,{plan,cycleNumber:Math.max(1,team.cycleNumber??0)});
    await db.events.add(event(teamId,'TEAM_PLAN_APPROVED',undefined,JSON.stringify(plan)));
  });
}
export async function finalizeTeam(teamId:string){
  await db.transaction('rw',[db.teams,db.agents,db.orders,db.notifications,db.events],async()=>{
    const team=await db.teams.get(teamId);
    if(!team)throw new Error('Unknown team.');
    if(team.finalizedAt)return;
    const agents=await db.agents.where('teamId').equals(teamId).toArray();
    const orders=await db.orders.where('teamId').equals(teamId).toArray();
    const pending=await db.notifications.where('teamId').equals(teamId).filter(n=>n.state==='PENDING').count();
    const blockers=completionBlockers(team,agents,orders,pending);
    if(blockers.length)throw new Error(blockers.join('; '));
    await db.teams.update(teamId,{finalizedAt:now()});
    await db.events.add(event(teamId,'TEAM_FINALIZED_LOCALLY'));
  });
}
