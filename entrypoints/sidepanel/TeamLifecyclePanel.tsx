import {useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import type {Agent,AgentBridgeObservation,Event,Order,Team} from '../../src/core';
import {completionBlockers} from '../../src/team-lifecycle';
import {db,approveTeamPlan,finalizeTeam} from '../../src/database';
import {chatAdapter} from '../../src/chat-adapter';
import {prettyPrintCopiedJson} from '../../src/json-cleanup';

type Props={team:Team;agents:Agent[];orders:Order[];events:Event[];a0Observation?:AgentBridgeObservation;onContinueA0:()=>void;externalBusy?:boolean};

export default function TeamLifecyclePanel({team,agents,orders,events,a0Observation,onContinueA0,externalBusy=false}:Props){
  const [raw,setRaw]=useState(''),[pending,setPending]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const isBusy=busy||externalBusy;
  useEffect(()=>{const s=liveQuery(()=>db.notifications.where('teamId').equals(team.id).filter(n=>n.state==='PENDING').count()).subscribe({next:setPending,error:e=>setError(String(e))});return()=>s.unsubscribe();},[team.id]);
  async function run(fn:()=>Promise<void>,success?:string){setBusy(true);setError('');setNotice('');try{await fn();if(success)setNotice(success);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const blockers=completionBlockers(team,agents,orders,pending??-1);
  const supervisor=agents.find(agent=>agent.teamId===team.id&&agent.number===0);
  const hasDeveloperChat=agents.some(agent=>agent.teamId===team.id&&agent.number>0&&Boolean(agent.chatUrl));
  const canStartA0=Boolean(supervisor&&!supervisor.lastOrderId&&!['WORKING','STOPPED','BLOCKED'].includes(supervisor.state));
  const retryA0Setup=Boolean(supervisor?.chatUrl&&canStartA0);
  const a0Actions=events.filter(item=>item.agentId===supervisor?.id&&(item.type==='A0_AUTOMATION_PAUSED_BLOCKER'||item.type==='A0_AUTOMATION_RESUMED')).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const a0Paused=a0Actions.at(-1)?.type==='A0_AUTOMATION_PAUSED_BLOCKER';
  const hasA0FinalReply=Boolean(supervisor?.lastOrderId&&a0Observation?.state==='IDLE'&&a0Observation.latestRole==='assistant'&&a0Observation.latestMessageId);
  const canContinueFromA0=hasA0FinalReply&&(!team.plan||a0Paused);

  return <section className="panel"><h2>Team lifecycle</h2>
    {team.finalizedAt?<p>Finalized locally: {new Date(team.finalizedAt).toLocaleString()}. GitHub completion is separate.</p>:<>
      {!team.plan?<>
        <p>{retryA0Setup?'A0’s setup message was sent and its chat link is saved. Wait for the voice icon to return after the setup reply. If AgentSync missed that signal, retry the setup check below; it reuses this chat and does not send the setup message again.':'Importing a task file opens A0’s chat, waits for the setup reply and voice icon, saves its link, then queues the A0 planning prompt. Discuss blockers with A0 normally; when it returns a clear plan, click Continue to start work.'}</p>
        {canStartA0&&<button disabled={!retryA0Setup&&isBusy} onClick={()=>{const access=chatAdapter.ensureChatAccess();void run(async()=>{if(!await access)throw new Error('ChatGPT site access is required to create or resume A0 planning.');await chatAdapter.startA0PlanningBatch(team.batchId);},'A0 setup finished; the planning prompt was queued and sent.');}}>{retryA0Setup?'Retry A0 setup check':'Create A0 chat & send planning task'}</button>}
        {a0Paused&&<p className="error">Automation is paused because A0 needs discussion or returned an invalid response. Continue chatting with A0, then click Continue when its latest reply is ready.</p>}
        {canContinueFromA0&&<button disabled={isBusy} onClick={onContinueA0}>{a0Paused?'Continue after A0 discussion':'Continue from A0 plan'}</button>}
        <p>Continue reads A0’s latest reply directly, cleans spacing artifacts such as <code>&amp;#x20;</code>, validates the JSON, creates any missing chats, and starts cycle 1. No copy and paste is needed.</p>
        <details><summary>Manual plan import</summary>
          <textarea aria-label="A0 plan packet" placeholder='Paste A0’s complete JSON array, e.g. [{"type":"AGENTSYNC_PLAN",...}]' value={raw} maxLength={40000} onChange={e=>setRaw(e.target.value)}/>
          <button disabled={isBusy||!raw.trim()} onClick={()=>void run(async()=>setRaw(prettyPrintCopiedJson(raw)),'JSON cleaned and formatted.')}>Clean and format JSON</button>
          <button disabled={isBusy||!raw.trim()} onClick={()=>void run(async()=>{await approveTeamPlan(team.id,raw);setRaw('');},'Clear plan approved. Continue autowork when ready.')}>Approve pasted plan</button>
        </details>
      </>:<>
        <h3>Approved assignments</h3>{team.plan.map(p=><div className="event" key={p.agent}><strong>A{p.agent} — {p.scope}</strong><small>{p.requires.length?'Prerequisites: '+p.requires.map(n=>'A'+n).join(', '):'No prerequisites'}</small><small>{p.requires.every(n=>agents.some(a=>a.teamId===team.id&&a.number===n&&a.state==='COMPLETED'))?'Prerequisites satisfied':'Waiting for prerequisite acceptance'}</small></div>)}
        <p>Every submitted task prompt includes its cycle number. AgentSync waits until all assigned workers in that cycle are idle, saves their final replies, then sends one combined handoff to A0. Clear A0 actions continue automatically; blocker replies pause until you discuss them and click Continue.</p>
        {a0Paused&&<><p className="error">Automation is paused for A0. Discuss the blocker in A0’s chat, wait for its final JSON action array, then resume here.</p>{hasA0FinalReply&&<button disabled={isBusy} onClick={onContinueA0}>Continue after A0 discussion</button>}</>}
        <button disabled={isBusy} onClick={()=>void run(async()=>{if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access is required to continue autowork.');await chatAdapter.startApprovedTeam(team.id);},'Autowork continued. Eligible replies will be saved in History.')}>{hasDeveloperChat?'Continue autowork for A1–A5':'Start autowork for A1–A5'}</button>
      </>}
      <h3>Local completion checks</h3>
      {blockers.length?blockers.map(b=><p key={b}>• {b}</p>):<p>Local checks satisfied. Review actual code and evidence separately.</p>}
      <button disabled={isBusy||pending===null||blockers.length>0} onClick={()=>{if(window.confirm('Finalize this team locally after reviewing the supervisor decision and evidence? This does not close issues, mark a PR ready, or merge.'))void run(()=>finalizeTeam(team.id));}}>Finalize team locally</button>
    </>}
    {notice&&<p role="status" className="notice">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
