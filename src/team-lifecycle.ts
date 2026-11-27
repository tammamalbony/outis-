import type { Agent, Order, Team } from './core';
import {normalizeCopiedJson} from './json-cleanup.ts';
export type Assignment = { agent: number; scope: string; requires: number[] };
export type TeamPlan = Assignment[];
export type SupervisorPlanPacket = { type:'AGENTSYNC_PLAN'; teamId:string; preflight:'CLEAR'|'BLOCKED'; blockers:string[]; plan:TeamPlan };
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('A0 plan entry must be one JSON object.');return value as Record<string,unknown>;}
export function parseSupervisorPlan(raw:string):SupervisorPlanPacket {
  if(raw.length>40000)throw new Error('A0 plan exceeds size limit.');
  let parsed:unknown;try{parsed=JSON.parse(normalizeCopiedJson(raw));}catch{throw new Error('The A0 response is not valid JSON after cleaning copy spacing artifacts. In JSON strings, escape quotes as \\" and literal backslashes as \\\\; apostrophes and forward slashes do not need escaping.');}
  if(!Array.isArray(parsed)||parsed.length!==1)throw new Error('A0 planning response must be a JSON array containing exactly one plan entry.');
  const value=object(parsed[0]);
  if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify(['blockers','plan','preflight','teamId','type']))throw new Error('A0 plan has missing or unexpected fields.');
  if(value.type!=='AGENTSYNC_PLAN'||typeof value.teamId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.teamId))throw new Error('Invalid A0 plan identity.');
  if(value.preflight!=='CLEAR'&&value.preflight!=='BLOCKED')throw new Error('A0 must report a clear or blocked preflight.');
  if(!Array.isArray(value.blockers)||value.blockers.length>20||value.blockers.some(x=>typeof x!=='string'||!x.trim()||x.length>1000))throw new Error('Invalid A0 blocker list.');
  const blockers=value.blockers as string[];
  if(value.preflight==='BLOCKED'||blockers.length)throw new Error('A0 reported unresolved blockers. Discuss and resolve them in A0’s chat; paste a plan only after A0 confirms the preflight is clear. '+(blockers.length?blockers.join('; '):''));
  const plan=parsePlan(JSON.stringify(value.plan));
  return {type:'AGENTSYNC_PLAN',teamId:value.teamId,preflight:'CLEAR',blockers:[],plan};
}
export function parsePlan(raw:string):TeamPlan {
  if(raw.length>30000)throw new Error('Plan exceeds size limit.');
  const value:unknown=JSON.parse(raw);
  if(!Array.isArray(value)||value.length!==5)throw new Error('Plan requires exactly five assignments.');
  const plan:TeamPlan=value.map(v=>{
    if(!v||typeof v!=='object'||!Number.isInteger(v.agent)||v.agent<1||v.agent>5||typeof v.scope!=='string'||!v.scope.trim()||v.scope.length>4000||!Array.isArray(v.requires)||v.requires.length>4||v.requires.some((n:unknown)=>typeof n!=='number'||!Number.isInteger(n)||n<1||n>5||n===v.agent)||new Set(v.requires).size!==v.requires.length)throw new Error('Invalid assignment.');
    return {agent:v.agent,scope:v.scope.trim(),requires:[...v.requires].sort((a,b)=>a-b)};
  }).sort((a,b)=>a.agent-b.agent);
  if(new Set(plan.map(a=>a.agent)).size!==5)throw new Error('Duplicate agent assignment.');
  const done=new Set<number>(),visiting=new Set<number>();
  function visit(n:number){if(visiting.has(n))throw new Error('Plan contains a dependency cycle.');if(done.has(n))return;visiting.add(n);for(const p of plan[n-1].requires)visit(p);visiting.delete(n);done.add(n);}
  for(const a of plan)visit(a.agent);
  return plan;
}
export function assertPlanApproval(team:Team,agents:Agent[],orders:Order[],userConfirmedA0Finished=false):void {
  if(team.plan||team.finalizedAt)throw new Error('Team plan is already approved or finalized.');
  const supervisor=agents.find(a=>a.teamId===team.id&&a.number===0);
  const latest=supervisor?.lastOrderId?orders.find(order=>order.id===supervisor.lastOrderId):undefined;
  const stopped=supervisor?.state==='STOPPED';
  const userConfirmed=Boolean(userConfirmedA0Finished&&supervisor?.state==='WORKING'&&latest?.state==='CONFIRMED'&&latest.agentId===supervisor.id&&!latest.stoppedAt);
  if(!supervisor?.chatUrl||(!stopped&&!userConfirmed)||!supervisor.lastOrderId||orders.some(o=>o.teamId===team.id&&o.agentId===supervisor.id&&o.state==='PENDING'))throw new Error('A0 must finish planning and have no pending prompt.');
}
export function assertTeamDispatch(team:Team,agent:Agent,agents:Agent[]):void {
  if(team.id!==agent.teamId||team.finalizedAt)throw new Error('Team mismatch or finalized.');
  if(agent.number===0)return;
  const a=team.plan?.find(p=>p.agent===agent.number);
  if(!a)throw new Error('Approve the supervisor plan before dispatching developers.');
  const missing=a.requires.filter(n=>!agents.some(p=>p.teamId===team.id&&p.number===n&&p.state==='COMPLETED'));
  if(missing.length)throw new Error('Await supervisor acceptance of prerequisites: '+missing.map(n=>'A'+n).join(', '));
}
export function readyAssignments(team:Team,agents:Agent[],orders:Order[]):Assignment[]{
  if(!team.plan||team.finalizedAt)return [];
  return team.plan.filter(assignment=>{
    const agent=agents.find(item=>item.teamId===team.id&&item.number===assignment.agent);
    if(!agent?.chatUrl||agent.state!=='READY')return false;
    if(orders.some(order=>order.teamId===team.id&&order.agentId===agent.id&&order.state==='PENDING'))return false;
    return assignment.requires.every(number=>agents.some(item=>item.teamId===team.id&&item.number===number&&item.state==='COMPLETED'));
  });
}
export function awaitingSetupReply(agent:Agent):boolean{return Boolean(agent.chatUrl&&agent.state==='READY'&&!agent.lastOrderId);}
export function completionBlockers(team:Team,agents:Agent[],orders:Order[],pendingNotifications:number):string[]{
  const own=agents.filter(a=>a.teamId===team.id);
  const blockers:string[]=[];
  if(!team.plan)blockers.push('Supervisor plan not approved');
  if(own.length!==6||new Set(own.map(a=>a.number)).size!==6||[0,1,2,3,4,5].some(n=>!own.some(a=>a.number===n&&a.chatUrl)))blockers.push('Six registered agents required');
  if([1,2,3,4,5].some(n=>!own.some(a=>a.number===n&&a.state==='COMPLETED')))blockers.push('All five developers must be accepted');
  if(!own.some(a=>a.number===0&&a.state==='STOPPED'&&a.lastOrderId))blockers.push('Supervisor must finish review execution');
  if(orders.some(o=>o.teamId===team.id&&o.state==='PENDING'))blockers.push('Reconcile pending orders');
  if(pendingNotifications!==0)blockers.push('Acknowledge supervisor notifications');
  return blockers;
}
export function batchCompletion(teams:Team[],batchId:string){const own=teams.filter(t=>t.batchId===batchId);const completed=own.filter(t=>Boolean(t.finalizedAt)).length;return {completed,total:own.length,done:own.length>0&&completed===own.length};}
