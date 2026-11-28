import {useMemo} from 'react';
import type {Agent,AgentBridgeObservation,Event,Order,Team} from '../../src/core';
import ChatMonitor from './ChatMonitor';
import ChatGPTTestWizard from './ChatGPTTestWizard';

const nice=(value:string)=>value.toLowerCase().replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
function latestOrder(agent:Agent,orders:Order[]){return orders.filter(order=>order.agentId===agent.id&&order.teamId===agent.teamId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];}
function orderWasSubmitted(order:Order|undefined){return Boolean(order&&(order.state==='CONFIRMED'||order.confirmedAt));}

function agentStage(agent:Agent,order:Order|undefined,observation:AgentBridgeObservation|undefined,team:Team){
  if(agent.number===0){
    const reply=Boolean(orderWasSubmitted(order)&&observation?.latestRole==='assistant'&&observation.latestMessageId&&observation.latestMessageId!==order?.baselineMessageId&&observation.state==='IDLE');
    if(team.plan)return {label:'Plan approved · cycle work active',detail:'A0’s plan is saved and A1–A5 are tracked below.',tone:'complete'};
    if(agent.state==='WORKING')return {label:observation?.flow==='GENERATING'?'Planning · generating':'Planning · prompt submitted',detail:'A0’s planning prompt was submitted; waiting for its reply.',tone:'active'};
    if(reply)return {label:'Planning reply received · review needed',detail:'A0 has replied. Review its plan or discuss any blockers before continuing.',tone:'active'};
    if(agent.state==='STOPPED')return {label:'Planning stopped · review A0 reply',detail:'A0 is no longer generating. Inspect its latest response before approving a plan.',tone:'active'};
    if(agent.chatUrl)return {label:observation?.latestRole==='assistant'&&observation.state==='IDLE'?'Initialized · setup reply received':'Initializing · waiting for setup reply',detail:'A0 chat is saved. The planning prompt starts after chat setup is ready.',tone:'pending'};
    return {label:'Initializing · A0 chat not saved',detail:'Create A0 and submit its setup prompt to begin planning.',tone:'pending'};
  }
  if(!team.plan)return {label:agent.chatUrl?'Initialized · waiting for A0 plan':'Waiting for A0 plan',detail:agent.chatUrl?'A0 must approve the plan before worker prompts are sent.':'This worker chat is created after the plan is approved.',tone:'pending'};
  if(agent.state==='COMPLETED'&&agent.lastReportId&&agent.lastOrderId)return {label:'Finished · reply accepted',detail:'A0 accepted the worker report for its submitted task.',tone:'complete'};
  if(agent.state==='BLOCKED')return {label:'Blocked · needs attention',detail:'A0 marked this worker as blocked. Review the task details and next action.',tone:'blocked'};
  if(agent.lastReportId)return {label:'Reply received · waiting for A0',detail:'The worker report is saved and awaits A0 acceptance.',tone:'active'};
  if(agent.state==='STOPPED')return {label:observation?.latestRole==='assistant'?'Reply received · report not imported':'Stopped · waiting for structured reply',detail:'A0 has not accepted a final report for this execution yet.',tone:'active'};
  if(agent.state==='WORKING')return {label:observation?.flow==='GENERATING'?'Prompt submitted · generating':'Prompt submitted · waiting for reply',detail:'The task prompt was submitted. AgentSync is waiting for the worker reply.',tone:'active'};
  if(order&&order.state==='PENDING')return {label:order.handoffAt?'Prompt handoff uncertain':'Prompt queued · not submitted',detail:order.handoffAt?'Inspect the saved chat and reconcile the handoff before retrying.':'The worker prompt is queued for submission.',tone:'pending'};
  if(agent.chatUrl)return {label:observation?.latestRole==='assistant'&&observation.state==='IDLE'?'Initialized · setup reply received':'Initialized · setup reply unverified',detail:'The saved worker chat is ready for its approved assignment.',tone:'pending'};
  return {label:'Not initialized · worker chat not saved',detail:'AgentSync creates this chat after A0’s plan is approved.',tone:'pending'};
}

export default function StatusTab({teams,agents,orders,events,observations,onOpenChat}:{teams:Team[];agents:Agent[];orders:Order[];events:Event[];observations:AgentBridgeObservation[];onOpenChat:(url:string)=>void}){
  const observationsByAgent=useMemo(()=>new Map(observations.map(item=>[item.agentId,item])),[observations]);
  return <section className="status-page" role="tabpanel" id="panel-status" aria-labelledby="tab-status">
    <header className="status-page-heading"><p className="eyebrow">LIVE WORK STATUS</p><h2>Team and chat status</h2><p>See saved chat names, composer detections, prompt flow, A0 planning and A1–A5 completion.</p></header>
    {teams.length===0?<section className="panel"><strong>No team status yet</strong><p>Import a task file in Workspace to create A0 and five worker records.</p></section>:teams.map(team=>{
      const own=agents.filter(agent=>agent.teamId===team.id).sort((a,b)=>a.number-b.number);
      const supervisor=own.find(agent=>agent.number===0);
      const workers=own.filter(agent=>agent.number>0);
      const a0Order=supervisor?latestOrder(supervisor,orders):undefined;
      const a0Stage=supervisor?agentStage(supervisor,a0Order,observationsByAgent.get(supervisor.id),team):undefined;
      const reported=workers.filter(agent=>['STOPPED','COMPLETED'].includes(agent.state)&&Boolean(agent.lastReportId)&&Boolean(agent.lastOrderId)).length;
      const accepted=workers.filter(agent=>agent.state==='COMPLETED'&&Boolean(agent.lastReportId)&&Boolean(agent.lastOrderId)).length;
      const allReportsReturned=workers.length===5&&reported===5;
      const allFinished=allReportsReturned&&accepted===5;
      const planReady=events.some(item=>item.teamId===team.id&&item.agentId===supervisor?.id&&item.type==='A0_PLAN_READY_FOR_CONTINUE');
      return <article className="status-team panel" key={team.id}>
        <div className="status-team-heading"><div><p className="eyebrow">{team.repository}</p><h3>{team.title}</h3><small>{team.branch}</small></div><span className={`status-overall ${allReportsReturned?'is-complete':''}`}>{allReportsReturned?`${accepted}/5 accepted`:`${reported}/5 replies`}</span></div>
        <section className="status-agent-card status-a0"><div className="status-agent-title"><span className="agent-avatar">A0</span><div><strong>{supervisor?.chatName??'A0 · Supervisor'}</strong><small>Supervisor · {supervisor?.chatUrl?'saved chat':'chat not saved'}</small></div></div><span className={`status-stage status-${a0Stage?.tone??'pending'}`}>{a0Stage?.label??'A0 record missing'}</span><p>{a0Stage?.detail??'A0 has not been initialized for this team.'}</p>{team.plan?<p className="status-substep">Plan: approved · {team.plan.length} assignments</p>:planReady?<p className="status-substep">Plan: returned by A0 · waiting for your approval</p>:<p className="status-substep">Plan: {supervisor?.lastOrderId?'waiting for A0 reply':'not received'}</p>}{supervisor?.chatUrl&&<button type="button" className="secondary-button" onClick={()=>onOpenChat(supervisor.chatUrl!)}>Open A0 chat</button>}</section>
        <div className="status-workers-heading"><h4>A1–A5</h4><span>Initialized → prompt submitted → reply → accepted</span></div>
        <div className="status-workers">{workers.map(agent=>{
          const order=latestOrder(agent,orders),observation=observationsByAgent.get(agent.id),stage=agentStage(agent,order,observation,team);
          return <section className="status-agent-card" key={agent.id}><div className="status-agent-title"><span className="agent-avatar">A{agent.number}</span><div><strong>{agent.chatName??`A${agent.number} · ${agent.role}`}</strong><small>{agent.role} · {agent.chatUrl?'saved chat':'not initialized'}</small></div></div><span className={`status-stage status-${stage.tone}`}>{stage.label}</span><p>{stage.detail}</p>{order&&<p className="status-substep">Cycle {order.cycleNumber??team.cycleNumber??0} · {orderWasSubmitted(order)?'prompt submitted':'prompt not confirmed submitted'}{agent.lastReportId?' · reply imported':''}</p>}{agent.chatUrl&&<button type="button" className="secondary-button" onClick={()=>onOpenChat(agent.chatUrl!)}>Open A{agent.number} chat</button>}</section>;
        })}</div>
        {allReportsReturned&&<p className="notice status-complete-notice">{allFinished?'All five workers finished their work and returned replies accepted by A0. Team work is complete for this cycle.':'All five workers finished their work and returned replies. A0 review and acceptance are still pending.'}</p>}
      </article>;
    })}
    <ChatGPTTestWizard savedAgents={agents} embedded/>
    <ChatMonitor agents={agents} teams={teams} orders={orders} observations={observations} onOpenChat={onOpenChat}/>
  </section>;
}
