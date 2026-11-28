import { browser } from 'wxt/browser';
import { db,queuePrompt,getPendingPrompt,confirmOrder,observeRegisteredChat,getBridgeObservation,getPendingBridgeUpdates,acknowledgeNotification,recordBridgePrompt,registerChat,importProtocolMessage,importProtocolBatch,isChatSetupRetryAuthorized,approveTeamPlan } from '../src/database';
import { conversationUrl,event,standbyPrompt,initialPrompt } from '../src/core';
import { assertContinuation,formatCombinedWorkerCycleHandoff,hasContinuationCommand,parseChatSnapshot,parseContinueCommand,type ChatSnapshot } from '../src/agent-bridge';
import { chatAdapter } from '../src/chat-adapter';
import {parseMessageBatch,type AgentStatus,type DispatchOrder} from '../src/protocol';
import {assertTeamDispatch,readyAssignments,awaitingSetupReply} from '../src/team-lifecycle';
import {activeTeamIds} from '../src/scheduler';
import {loadTimingSettings} from '../src/extension-settings';
import {storeCompletedChatReply} from '../src/local-mcp-client';
import {normalizeCopiedJson} from '../src/json-cleanup';
import {repositoryWizardWatchForChat,saveRepositoryWizardChatSnapshot} from '../src/repository-wizard';
import {parseSupervisorPlan} from '../src/team-lifecycle';
import type {Agent} from '../src/core';

function errorText(error:unknown):string{return error instanceof Error?error.message:String(error);}
async function recordBridgeEvent(teamId:string,agentId:string,type:string,detail:string){
  await db.events.add(event(teamId,type,agentId,detail.slice(0,1000)));
}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const orderSends=new Map<string,Promise<void>>();
const a0PlanningRuns=new Map<string,Promise<void>>();
const mcpReplyUploadErrors=new Set<string>();
function scheduleLocalMcpReplyStore(agent:Agent|undefined,snapshot:ChatSnapshot){
  if(!agent||snapshot.state!=='IDLE'||snapshot.latestRole!=='assistant'||!snapshot.latestMessageId||!snapshot.latestMessage.trim()||!agent.lastOrderId)return;
  const replyKey=`${agent.id}:${snapshot.latestMessageId}`;
  void storeCompletedChatReply(agent,snapshot).then(async stored=>{
    if(stored){mcpReplyUploadErrors.delete(replyKey);await recordBridgeEvent(agent.teamId,agent.id,'CHAT_FINAL_REPLY_STORED_LOCAL_MCP',JSON.stringify({messageId:snapshot.latestMessageId,itemId:stored.itemId,duplicate:stored.duplicate}));}
  }).catch(async error=>{
    if(!mcpReplyUploadErrors.has(replyKey)){mcpReplyUploadErrors.add(replyKey);await recordBridgeEvent(agent.teamId,agent.id,'CHAT_FINAL_REPLY_LOCAL_MCP_FAILED',errorText(error));}
  }).catch(()=>{});
}
async function waitForIdle(agentId:string,timeoutMs?:number,purpose:'setup reply'|'pending prompt'='setup reply'){
  const agent=await db.agents.get(agentId);
  if(!agent)throw new Error('Unknown registered chat.');
  const timings=await loadTimingSettings();
  const deadline=Date.now()+(timeoutMs??timings.setupReplyTimeoutMs);
  await recordBridgeEvent(agent.teamId,agent.id,'CHAT_IDLE_WAIT_STARTED',JSON.stringify({purpose,chatUrl:agent.chatUrl??null,timeoutMs:timeoutMs??timings.setupReplyTimeoutMs}));
  while(Date.now()<deadline){
    const observation=await getBridgeObservation(agentId);
    if(observation?.state==='IDLE'&&observation.latestRole==='assistant'){
      await recordBridgeEvent(agent.teamId,agent.id,'CHAT_IDLE_CONFIRMED',JSON.stringify({purpose,latestMessageId:observation.latestMessageId,observedAt:observation.observedAt}));
      return;
    }
    await delay(timings.pollIntervalMs);
  }
  const [latestAgent,observation]=await Promise.all([db.agents.get(agentId),getBridgeObservation(agentId)]);
  const detail=JSON.stringify({purpose,chatUrl:latestAgent?.chatUrl??null,agentState:latestAgent?.state??'MISSING',bridgeState:observation?.state??'NO_OBSERVATION',latestRole:observation?.latestRole??'none',latestMessageId:observation?.latestMessageId??'',observedAt:observation?.observedAt??null});
  await recordBridgeEvent(agent.teamId,agent.id,'CHAT_IDLE_WAIT_TIMED_OUT',detail);
  const label=agent.number===0?'A0':'A'+agent.number;
  if(purpose==='setup reply'&&agent.number===0)throw new Error(`A0 setup was sent and its chat link was saved, but AgentSync has not detected a finished reply yet (${observation?.state??'no bridge observation'}; latest message: ${observation?.latestRole??'none'}). Open the saved A0 chat and wait until generation stops and the voice icon is visible, then choose “Retry A0 setup check”. The retry reuses this chat and does not resend setup.`);
  throw new Error(`${label} did not become idle before the ${purpose} wait expired (${observation?.state??'no bridge observation'}; latest message: ${observation?.latestRole??'none'}). Open its saved chat, confirm generation has stopped and the voice icon is visible, then retry. No prompt was resent.`);
}
async function waitForSupervisorStop(agentId:string,timeoutMs?:number){
  const timings=await loadTimingSettings();
  const deadline=Date.now()+(timeoutMs??timings.a0ResponseTimeoutMs);
  while(Date.now()<deadline){
    const [agent,observation]=await Promise.all([db.agents.get(agentId),getBridgeObservation(agentId)]);
    if(agent?.state==='STOPPED'&&observation?.state==='IDLE'&&observation.latestRole==='assistant')return;
    await delay(timings.pollIntervalMs);
  }
  throw new Error('A0 is still working or its final reply is not confirmed. Inspect the registered chat before continuing.');
}
async function beginChatSetup(agentId:string){
  const agent=await db.agents.get(agentId);
  if(!agent)throw new Error('Unknown worker chat.');
  if(agent.chatUrl)return;
  const started=await db.events.where('agentId').equals(agentId).filter(item=>item.type==='AGENT_CHAT_SETUP_STARTED').toArray();
  const prior=started.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
  if(prior){
    if(!await isChatSetupRetryAuthorized(agentId,prior.id))throw new Error('A previous new-chat submission may have succeeded without a saved link. Inspect ChatGPT tabs, then authorize one retry only if the setup prompt was not sent.');
  }
  await db.events.add(event(agent.teamId,'AGENT_CHAT_SETUP_STARTED',agent.id));
}
async function sendQueuedOrderOnce(orderId:string){
  const order=await db.orders.get(orderId);
  if(!order||order.state!=='PENDING')throw new Error('Queued AgentSync order is no longer pending.');
  const agent=await db.agents.get(order.agentId);
  if(!agent?.chatUrl)throw new Error('Queued AgentSync target has no registered chat.');
  const prepared=await getPendingPrompt(order.id);
  const baseline=await getBridgeObservation(agent.id);
  const prompt=`${prepared}\n\nAgentSync delivery ID: ${order.id}`;
  const result=await chatAdapter.sendBridgeMessage(agent.chatUrl,{type:'AGENTSYNC_SEND_ORDER',conversationUrl:agent.chatUrl,text:prompt,dedupeKey:order.id},{activate:true}) as {submitted?:boolean;error?:string}|undefined;
  if(result?.error)throw new Error(result.error);
  if(result?.submitted!==true)throw new Error('Chat submission is uncertain; AgentSync will not retry automatically.');
  await confirmOrder(order.id,prompt,baseline?.latestMessageId);
  await recordBridgeEvent(order.teamId,agent.id,'ORDER_AUTOMATICALLY_SUBMITTED',JSON.stringify({orderId:order.id,cycleNumber:order.cycleNumber??0}));
}
async function sendQueuedOrder(orderId:string){
  const existing=orderSends.get(orderId);
  if(existing)return existing;
  const operation=sendQueuedOrderOnce(orderId);
  orderSends.set(orderId,operation);
  try{await operation;}finally{orderSends.delete(orderId);}
}
async function startApprovedTeam(teamId:string){
  let team=await db.teams.get(teamId);
  if(team?.plan&&(!team.cycleNumber||team.cycleNumber<1)){await db.teams.update(teamId,{cycleNumber:1});team={...team,cycleNumber:1};}
  const batch=team&&await db.batches.get(team.batchId);
  if(!team?.plan||!batch)throw new Error('Use Continue to apply A0’s clear plan first.');
  if(batch.paused)throw new Error('Resume this paused batch before starting chats.');
  let refreshed=await db.agents.where('teamId').equals(teamId).toArray();
  const supervisor=refreshed.find(agent=>agent.number===0);
  const developers=refreshed.filter(agent=>agent.number>0).sort((a,b)=>a.number-b.number);
  if(!supervisor?.chatUrl||supervisor.state!=='STOPPED'||!supervisor.lastOrderId)throw new Error('A0 must finish planning before autowork can start.');
  if(developers.length!==5||developers.some((agent,index)=>agent.number!==index+1))throw new Error('Autowork requires all five developer records.');
  for(const priorOrder of await db.orders.where('teamId').equals(teamId).filter(order=>order.state==='PENDING'&&Boolean(order.handoffAt)).toArray()){
    throw new Error(`Order ${priorOrder.id} has an uncertain handoff. Inspect its ChatGPT tab and reconcile it before continuing autowork.`);
  }
  for(const target of developers){
    if(target.chatUrl)continue;
    await beginChatSetup(target.id);
    const key=`setup-${teamId}-A${target.number}`;
    const setup=standbyPrompt(team,target);
    const url=await chatAdapter.createNewChat(setup,key);
    await registerChat(target.id,url);
    await recordBridgePrompt(target.id,key,`${setup}\n\nAgentSync delivery ID: ${key}`);
    await recordBridgeEvent(teamId,target.id,'AGENT_CHAT_CREATED',url);
  }
  refreshed=await db.agents.where('teamId').equals(teamId).toArray();
  const registered=refreshed.filter(agent=>agent.chatUrl);
  if(!registered.some(agent=>agent.number===0)||developers.some(agent=>!refreshed.some(item=>item.id===agent.id&&item.chatUrl)))throw new Error('A0 and all five developer chats must be registered.');
  await chatAdapter.ensureRegisteredChatTabs(registered.map(agent=>agent.chatUrl!));
  await chatAdapter.enableA0Bridge(registered.map(agent=>agent.chatUrl!));
  for(const target of refreshed.filter(agent=>agent.number>0&&awaitingSetupReply(agent)))await waitForIdle(target.id,undefined,'setup reply');
  for(const order of await db.orders.where('teamId').equals(teamId).filter(item=>item.state==='PENDING').toArray())await sendQueuedOrder(order.id);
  refreshed=await db.agents.where('teamId').equals(teamId).toArray();
  const currentOrders=await db.orders.where('teamId').equals(teamId).toArray();
  const eligible=readyAssignments(team,refreshed,currentOrders);
  for(const assignment of eligible){
    const target=refreshed.find(agent=>agent.teamId===teamId&&agent.number===assignment.agent);
    if(!target?.chatUrl)throw new Error(`A${assignment.agent} has no registered chat.`);
    assertTeamDispatch(team,target,refreshed);
    const order=await queuePrompt(target.id,initialPrompt(team,target));
    await sendQueuedOrder(order.id);
  }
  if(!eligible.length)await recordBridgeEvent(teamId,supervisor.id,'PLAN_READY_NO_DISPATCH','No assignment is currently eligible under the approved prerequisites. Autowork can be continued after A0 accepts a prerequisite report.');
  else await recordBridgeEvent(teamId,supervisor.id,'AUTOWORK_CONTINUED',`Submitted ${eligible.length} eligible assignment(s).`);
}
async function startA0PlanningForTeamOnce(teamId:string){
  let team=await db.teams.get(teamId);
  const batch=team&&await db.batches.get(team.batchId);
  if(!team||!batch)throw new Error('Unknown feature team.');
  if(batch.paused)throw new Error('Resume this paused batch before starting A0 planning.');
  if(team.plan)throw new Error('This feature already has an approved plan.');
  let supervisor=await db.agents.get(`${teamId}:A0`);
  if(!supervisor)throw new Error('Feature has no A0 supervisor record.');
  if(supervisor.lastOrderId){if(supervisor.state==='WORKING')await waitForSupervisorStop(supervisor.id);return;}
  if(['STOPPED','BLOCKED'].includes(supervisor.state))return;
  if(!supervisor.chatUrl){
    await beginChatSetup(supervisor.id);
    const key=`setup-${teamId}-A0`;
    const url=await chatAdapter.createNewChat(standbyPrompt(team,supervisor),key);
    await registerChat(supervisor.id,url);
    await recordBridgePrompt(supervisor.id,key,`${standbyPrompt(team,supervisor)}\n\nAgentSync delivery ID: ${key}`);
    await recordBridgeEvent(teamId,supervisor.id,'AGENT_CHAT_CREATED',url);
  }
  await chatAdapter.enableA0Bridge([supervisor.chatUrl??(await db.agents.get(supervisor.id))!.chatUrl!]);
  await waitForIdle(supervisor.id,undefined,'setup reply');
  team=await db.teams.get(teamId);
  supervisor=await db.agents.get(supervisor.id);
  if(!team||!supervisor?.chatUrl)throw new Error('A0 registration changed during planning startup.');
  if(supervisor.lastOrderId||supervisor.state==='WORKING'||supervisor.state==='STOPPED')return;
  const order=await queuePrompt(supervisor.id,initialPrompt(team,supervisor));
  await sendQueuedOrder(order.id);
  await recordBridgeEvent(teamId,supervisor.id,'A0_PLANNING_AUTOMATICALLY_STARTED',order.id);
  await waitForSupervisorStop(supervisor.id);
}
async function startA0PlanningForTeam(teamId:string){
  const existing=a0PlanningRuns.get(teamId);
  if(existing)return existing;
  const operation=startA0PlanningForTeamOnce(teamId);
  a0PlanningRuns.set(teamId,operation);
  try{await operation;}finally{if(a0PlanningRuns.get(teamId)===operation)a0PlanningRuns.delete(teamId);}
}
async function startA0PlanningBatch(batchId:string){
  const batch=await db.batches.get(batchId);
  if(!batch)throw new Error('Unknown imported task file.');
  if(batch.paused)throw new Error('Resume this paused batch before starting A0 planning.');
  const teams=await db.teams.where('batchId').equals(batchId).toArray();
  if(!teams.length)throw new Error('Imported task file contains no feature teams.');
  const agents=await db.agents.toArray();
  const orders=await db.orders.toArray();
  const active=activeTeamIds(teams,agents,orders);
  let available=Math.max(0,batch.config.maxConcurrentTeams-active.size);
  for(const team of teams){
    const supervisor=agents.find(agent=>agent.id===`${team.id}:A0`);
    if(active.has(team.id)||supervisor?.lastOrderId||['WORKING','STOPPED','BLOCKED'].includes(supervisor?.state??''))continue;
    if(available<=0)break;
    await startA0PlanningForTeam(team.id);
    available--;
  }
}
async function retryPendingOrder(orderId:string){
  const order=await db.orders.get(orderId);
  if(!order||order.state!=='PENDING')throw new Error('This order is no longer pending.');
  const team=await db.teams.get(order.teamId),agent=await db.agents.get(order.agentId);
  const batch=team&&await db.batches.get(team.batchId);
  if(!team?.plan||!batch||batch.paused)throw new Error('Approve the plan and resume its batch before sending.');
  if(!agent?.chatUrl)throw new Error('Register this agent’s ChatGPT conversation before sending.');
  const agents=await db.agents.where('teamId').equals(team.id).toArray();
  const chatUrls=agents.flatMap(item=>item.chatUrl?[item.chatUrl]:[]);
  if(!agents.some(item=>item.number===0&&item.chatUrl)||!agents.some(item=>item.number>0&&item.chatUrl))throw new Error('Register A0 and a worker chat before enabling the bridge.');
  await chatAdapter.enableA0Bridge(chatUrls);
  await waitForIdle(agent.id,undefined,'pending prompt');
  await sendQueuedOrder(order.id);
}
function parseStatusBlock(message:string):AgentStatus{
  const parsed=parseMessageBatch(message);
  if(parsed.length!==1||parsed[0].type!=='AGENT_STATUS')throw new Error('Worker reply must be one JSON array containing one AGENT_STATUS report.');
  const report=parsed[0];
  if(report.type!=='AGENT_STATUS')throw new Error('Worker report is not AGENT_STATUS.');
  return report;
}
function parseSupervisorOrders(message:string){
  return parseMessageBatch(message);
}
async function a0AutomationPaused(teamId:string){
  const actions=await db.events.where('agentId').equals(`${teamId}:A0`).filter(item=>item.type==='A0_AUTOMATION_PAUSED_BLOCKER'||item.type==='A0_AUTOMATION_RESUMED').toArray();
  return actions.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1)?.type==='A0_AUTOMATION_PAUSED_BLOCKER';
}
async function continueA0Workflow(teamId:string){
  const team=await db.teams.get(teamId),supervisor=await db.agents.get(`${teamId}:A0`);
  if(!team||!supervisor?.chatUrl)throw new Error('A0 has no registered chat for this feature.');
  const observation=await getBridgeObservation(supervisor.id);
  if(!observation||observation.state!=='IDLE'||observation.latestRole!=='assistant'||!observation.latestMessage?.trim())throw new Error('A0 has not returned a confirmed idle reply yet. Open A0’s chat, resolve any blocker, wait for its final response, then click Continue.');
  const freshAge=Date.now()-Date.parse(observation.observedAt);
  if(!Number.isFinite(freshAge)||freshAge<0||freshAge>15_000)throw new Error('A0’s status scan is stale. Refresh its ChatGPT tab, wait for the five-second scan, then click Continue.');
  const snapshot:ChatSnapshot={conversationUrl:supervisor.chatUrl,state:observation.state,latestRole:observation.latestRole,latestMessageId:observation.latestMessageId,latestMessage:observation.latestMessage??'',observedAt:observation.observedAt};
  if(!team.plan){
    try{parseSupervisorPlan(snapshot.latestMessage);}catch(error){throw new Error(`A0 is not ready to start work. Continue the discussion in A0’s chat, then click Continue when it returns a clear plan. ${errorText(error)}`);}
    await approveTeamPlan(teamId,snapshot.latestMessage);
    await recordBridgeEvent(teamId,supervisor.id,'A0_AUTOMATION_RESUMED',snapshot.latestMessageId);
    await startApprovedTeam(teamId);
    return;
  }
  let parsed:unknown;
  try{parsed=JSON.parse(normalizeCopiedJson(snapshot.latestMessage));}catch{throw new Error('A0 is still discussing a blocker or has not returned a valid JSON action array. Continue chatting with A0, then click Continue after its final JSON response.');}
  if(!Array.isArray(parsed))throw new Error('A0’s reply is not a JSON array. Continue the discussion in A0’s chat, then click Continue after it returns an action array.');
  if(hasContinuationCommand(snapshot.latestMessage))await runContinuation(supervisor.id,supervisor.chatUrl,snapshot);
  else await processSupervisorOrders(supervisor.id,supervisor.chatUrl,snapshot);
  await recordBridgeEvent(teamId,supervisor.id,'A0_AUTOMATION_RESUMED',snapshot.latestMessageId);
}
async function deliverPendingUpdates(teamId:string,supervisorChatUrl:string){
  const supervisor=await db.agents.get(`${teamId}:A0`);
  if(!supervisor||supervisor.chatUrl!==supervisorChatUrl)throw new Error('Supervisor chat registration changed.');
  const team=await db.teams.get(teamId);
  if(!team)return;
  const cycleNumber=team.cycleNumber??1;
  const currentOrders=(await db.orders.where('teamId').equals(teamId).toArray()).filter(order=>(order.cycleNumber??cycleNumber)===cycleNumber&&order.state==='CONFIRMED'&&order.agentId!==supervisor.id);
  const currentExecutionIds=new Set(currentOrders.map(order=>order.id));
  // Match pending replies through their confirmed orders so legacy notifications
  // created before cycle numbers were added still belong to their current order.
  const pending=(await getPendingBridgeUpdates(teamId)).filter(item=>currentExecutionIds.has(item.executionId));
  if(!pending.length)return;
  if(!currentOrders.length||currentOrders.some(order=>!order.stoppedAt))return;
  const responses=[];
  for(const order of currentOrders){
    const agent=await db.agents.get(order.agentId),observation=await getBridgeObservation(order.agentId);
    if(!agent?.chatUrl||!observation||observation.state!=='IDLE'||observation.latestRole!=='assistant'||!observation.latestMessageId||!observation.latestMessage?.trim())return;
    responses.push({agentNumber:agent.number,agentId:agent.id,executionId:order.id,cycleNumber:order.cycleNumber??0,messageId:observation.latestMessageId,response:observation.latestMessage});
  }
  const supervisorObservation=await getBridgeObservation(supervisor.id);
  if(supervisorObservation?.state==='GENERATING')return;
  const dedupeKey=`agentsync-${teamId}-cycle-${cycleNumber}-combined-handoff`;
  const text=formatCombinedWorkerCycleHandoff(teamId,cycleNumber,responses);
  const result=await chatAdapter.sendBridgeMessage(supervisorChatUrl,{type:'AGENTSYNC_DELIVER_A0_UPDATE',conversationUrl:supervisorChatUrl,text,dedupeKey},{activate:true}) as {submitted?:boolean;duplicate?:boolean;error?:string}|undefined;
  if(result?.error)throw new Error(result.error);
  if(result?.submitted!==true)throw new Error('Combined A0 handoff is uncertain.');
  await recordBridgePrompt(supervisor.id,dedupeKey,text);
  for(const update of pending)await acknowledgeNotification(teamId,update.notificationId);
  const executionIds=new Set(currentOrders.map(order=>order.id));
  const statusNotifications=await db.notifications.where('teamId').equals(teamId).filter(item=>item.type==='AGENT_STATUS'&&item.state==='PENDING').toArray();
  for(const notification of statusNotifications){
    try{const report=JSON.parse(notification.detail)?.[0];if(typeof report?.executionId==='string'&&executionIds.has(report.executionId))await acknowledgeNotification(teamId,notification.id);}catch{/* Keep malformed notifications for manual review. */}
  }
  await recordBridgeEvent(teamId,supervisor.id,'WORKER_CYCLE_SENT_TO_A0',JSON.stringify({cycleNumber,agentNumbers:responses.map(response=>response.agentNumber),duplicate:Boolean(result.duplicate)}));
}
async function runContinuation(sourceId:string,sourceChatUrl:string,snapshot:ChatSnapshot){
  const command=parseContinueCommand(snapshot.latestMessage);
  const source=await db.agents.get(sourceId);
  if(!source||source.number!==0||source.chatUrl!==sourceChatUrl)throw new Error('Only the registered A0 chat may issue continuation commands.');
  const team=await db.teams.get(source.teamId),batch=team&&await db.batches.get(team.batchId);
  const target=await db.agents.get(`${source.teamId}:A${command.targetAgentId}`);
  if(!team||!batch||!target)throw new Error('A0 command points to an unavailable feature or developer.');
  const observation=await getBridgeObservation(target.id);
  const targetSnapshot:ChatSnapshot|undefined=observation&&target.chatUrl?{conversationUrl:target.chatUrl,state:observation.state,latestRole:observation.latestRole,latestMessageId:observation.latestMessageId,latestMessage:'',observedAt:observation.observedAt}:undefined;
  const pending=await db.orders.where('agentId').equals(target.id).filter(order=>order.state==='PENDING').first();
  assertContinuation(command,{source,target,team,batch,snapshot:targetSnapshot,hasPendingOrder:Boolean(pending)});
  const order=await queuePrompt(target.id,command.prompt);
  await sendQueuedOrder(order.id);
  await recordBridgeEvent(team.id,target.id,'A0_CONTINUATION_SUBMITTED',order.id);
}

async function processSupervisorOrders(sourceId:string,sourceChatUrl:string,snapshot:ChatSnapshot){
  const source=await db.agents.get(sourceId);
  if(!source||source.number!==0||source.chatUrl!==sourceChatUrl)throw new Error('Only the registered A0 chat may issue automatic orders.');
  const team=await db.teams.get(source.teamId);
  if(!team?.plan)throw new Error('Approve A0’s plan before automatic dispatch.');
  const messages=parseSupervisorOrders(snapshot.latestMessage);
  if(messages.some(message=>message.teamId!==team.id))throw new Error('A0 array contains a different team ID.');
  const statuses=messages.filter((message):message is AgentStatus=>message.type==='AGENT_STATUS');
  const orders=messages.filter((message):message is DispatchOrder=>message.type==='DISPATCH_ORDER');
  await importProtocolBatch(team.id,source.id,snapshot.latestMessage);
  if(!orders.length){await recordBridgeEvent(team.id,source.id,'A0_CYCLE_NO_MORE_WORK',statuses.length?`Recorded ${statuses.length} verified report snapshot(s).`:snapshot.latestMessage);return;}
  if(orders.some(order=>order.teamId!==team.id||order.sourceAgentId!==0))throw new Error('A0 order belongs to a different team or source.');
  for(const order of orders){
    if(order.action==='RESUME'){
      const target=await db.agents.get(`${team.id}:A${order.targetAgentId}`);
      if(!target)throw new Error(`A${order.targetAgentId} is missing from this team.`);
      if(!target.chatUrl){
        await beginChatSetup(target.id);
        const key=`setup-${team.id}-A${target.number}-${order.orderId}`;
        const setup=standbyPrompt(team,target);
        const url=await chatAdapter.createNewChat(setup,key);
        await registerChat(target.id,url);
        await recordBridgePrompt(target.id,key,`${setup}\n\nAgentSync delivery ID: ${key}`);
        await recordBridgeEvent(team.id,target.id,'AGENT_CHAT_CREATED',url);
        const current=(await db.agents.where('teamId').equals(team.id).toArray()).filter(agent=>agent.chatUrl);
        await chatAdapter.enableA0Bridge(current.map(agent=>agent.chatUrl!));
        await waitForIdle(target.id);
      }
      const targetId=`${team.id}:A${order.targetAgentId}`;
      const pending=await db.orders.where('agentId').equals(targetId).filter(item=>item.state==='PENDING').first();
      if(!pending)throw new Error(`A${order.targetAgentId} resume order was not queued.`);
      await sendQueuedOrder(pending.id);
    }
  }
  await recordBridgeEvent(team.id,source.id,'A0_ORDERS_AUTOMATICALLY_APPLIED',String(orders.length));
}

async function importWorkerStatus(agentId:string,snapshot:ChatSnapshot){
  if(snapshot.latestRole!=='assistant'||snapshot.state!=='IDLE')return;
  const agent=await db.agents.get(agentId);
  if(!agent||agent.number===0||!agent.lastOrderId||!['STOPPED','BLOCKED'].includes(agent.state))return;
  try{await importProtocolMessage(agent.teamId,agent.id,JSON.stringify(parseStatusBlock(snapshot.latestMessage)));}
  catch(error){await recordBridgeEvent(agent.teamId,agent.id,'WORKER_STATUS_IMPORT_FAILED',errorText(error));}
}

type BridgeSender={id?:string;url?:string;tab?:{id?:number;incognito?:boolean}};
async function handleChatSnapshot(message:unknown,sender:BridgeSender){
  if(sender.id!==browser.runtime.id||sender.tab?.id===undefined||sender.tab.incognito)throw new Error('Untrusted or unsupported bridge sender.');
  let senderUrl:string;
  try{senderUrl=conversationUrl(sender.url??'');}catch{return {accepted:true,ignored:true};}
  const wizardWatch=await repositoryWizardWatchForChat(senderUrl);
  if(wizardWatch){
    const snapshot=parseChatSnapshot((message as {snapshot?:unknown})?.snapshot,senderUrl);
    await saveRepositoryWizardChatSnapshot(senderUrl,snapshot);
    return {accepted:true,wizard:true};
  }
  const agent=await db.agents.where('chatUrl').equals(senderUrl).first();
  if(!agent||agent.chatUrl!==senderUrl)throw new Error('Bridge is limited to registered AgentSync conversations.');
  const snapshot=parseChatSnapshot((message as {snapshot?:unknown})?.snapshot,senderUrl);
  const observed=await observeRegisteredChat(snapshot);
  if(observed.agent.id!==agent.id)throw new Error('Registered conversation identity changed.');
  scheduleLocalMcpReplyStore(agent,snapshot);
  if(agent.number===0&&snapshot.state==='IDLE'&&observed.newAssistantMessage&&observed.agent.chatUrl&&agent.lastOrderId){
    const team=await db.teams.get(agent.teamId);
    if(team){
      let parsed:unknown;
      try{parsed=JSON.parse(normalizeCopiedJson(snapshot.latestMessage));}
      catch{await recordBridgeEvent(agent.teamId,agent.id,'A0_AUTOMATION_PAUSED_BLOCKER',JSON.stringify({messageId:snapshot.latestMessageId,reason:'A0 replied in normal text or returned malformed JSON.',reply:snapshot.latestMessage.slice(0,700)}));}
      if(parsed===undefined){/* The blocker event above leaves A0 available for normal discussion. */}
      else if(!Array.isArray(parsed))await recordBridgeEvent(agent.teamId,agent.id,'A0_AUTOMATION_PAUSED_BLOCKER',JSON.stringify({messageId:snapshot.latestMessageId,reason:'A0 replied in normal text; no work was dispatched.',reply:snapshot.latestMessage.slice(0,700)}));
      else if(!team.plan){
        try{parseSupervisorPlan(snapshot.latestMessage);await recordBridgeEvent(agent.teamId,agent.id,'A0_PLAN_READY_FOR_CONTINUE',snapshot.latestMessageId);}
        catch(error){await recordBridgeEvent(agent.teamId,agent.id,'A0_AUTOMATION_PAUSED_BLOCKER',JSON.stringify({messageId:snapshot.latestMessageId,reason:errorText(error),reply:snapshot.latestMessage.slice(0,700)}));}
      }else if(await a0AutomationPaused(agent.teamId))await recordBridgeEvent(agent.teamId,agent.id,'A0_RESPONSE_WAITING_FOR_CONTINUE',snapshot.latestMessageId);
      else try{
        if(hasContinuationCommand(snapshot.latestMessage))await runContinuation(agent.id,senderUrl,snapshot);
        else await processSupervisorOrders(agent.id,senderUrl,snapshot);
      }catch(error){await recordBridgeEvent(agent.teamId,agent.id,'A0_AUTOMATION_PAUSED_BLOCKER',JSON.stringify({messageId:snapshot.latestMessageId,reason:errorText(error),reply:snapshot.latestMessage.slice(0,500)}));}
    }
  }
  if(observed.stoppedExecutionId){
    try{
      await importWorkerStatus(agent.id,snapshot);
      const supervisor=await db.agents.get(`${agent.teamId}:A0`);
      if(!supervisor?.chatUrl)throw new Error('Feature has no registered A0 chat.');
      await deliverPendingUpdates(agent.teamId,supervisor.chatUrl);
    }catch(error){await recordBridgeEvent(agent.teamId,agent.id,'WORKER_STOP_A0_DELIVERY_FAILED',errorText(error));}
  }
  if(agent.number===0&&snapshot.state==='IDLE'&&observed.newAssistantMessage&&observed.agent.chatUrl){
    try{await deliverPendingUpdates(agent.teamId,observed.agent.chatUrl);}
    catch(error){await recordBridgeEvent(agent.teamId,agent.id,'WORKER_STOP_A0_DELIVERY_FAILED',errorText(error));}
  }
  return {accepted:true};
}

async function handleStartApprovedTeam(message:unknown,sender:BridgeSender){
  if(sender.id!==browser.runtime.id||sender.tab?.id!==undefined)throw new Error('Untrusted plan-start request.');
  const value=message as {teamId?:unknown};
  if(typeof value.teamId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.teamId))throw new Error('Invalid feature team ID.');
  await startApprovedTeam(value.teamId);
  return {started:true};
}
async function handleStartA0PlanningBatch(message:unknown,sender:BridgeSender){
  if(sender.id!==browser.runtime.id||sender.tab?.id!==undefined)throw new Error('Untrusted A0 planning-start request.');
  const value=message as {batchId?:unknown};
  if(typeof value.batchId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.batchId))throw new Error('Invalid imported task ID.');
  await startA0PlanningBatch(value.batchId);
  return {started:true};
}
async function handleRetryPendingOrder(message:unknown,sender:BridgeSender){
  if(sender.id!==browser.runtime.id||sender.tab?.id!==undefined)throw new Error('Untrusted pending-order retry request.');
  const value=message as {orderId?:unknown};
  if(typeof value.orderId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.orderId))throw new Error('Invalid pending order ID.');
  await retryPendingOrder(value.orderId);
  return {sent:true};
}
async function handleContinueA0Workflow(message:unknown,sender:BridgeSender){
  if(sender.id!==browser.runtime.id||sender.tab?.id!==undefined)throw new Error('Untrusted A0 continue request.');
  const value=message as {teamId?:unknown};
  if(typeof value.teamId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.teamId))throw new Error('Invalid feature team ID.');
  await continueA0Workflow(value.teamId);
  return {continued:true};
}

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  void chatAdapter.ensurePageStatusRail().catch(console.error);
  browser.permissions.onAdded.addListener(()=>{void chatAdapter.ensurePageStatusRail().catch(console.error);});
  browser.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(!message||typeof message!=='object')return false;
    const type=(message as {type?:string}).type;
    if(type!=='AGENTSYNC_CHAT_SNAPSHOT'&&type!=='AGENTSYNC_START_APPROVED_TEAM'&&type!=='AGENTSYNC_START_A0_PLANNING_BATCH'&&type!=='AGENTSYNC_RETRY_PENDING_ORDER'&&type!=='AGENTSYNC_CONTINUE_A0_WORKFLOW')return false;
    const operation=type==='AGENTSYNC_CHAT_SNAPSHOT'?handleChatSnapshot(message,sender):type==='AGENTSYNC_START_APPROVED_TEAM'?handleStartApprovedTeam(message,sender):type==='AGENTSYNC_START_A0_PLANNING_BATCH'?handleStartA0PlanningBatch(message,sender):type==='AGENTSYNC_RETRY_PENDING_ORDER'?handleRetryPendingOrder(message,sender):handleContinueA0Workflow(message,sender);
    void operation.then(sendResponse,error=>sendResponse({error:errorText(error)}));
    return true;
  });
});
