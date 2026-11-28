import {useEffect,useRef,useState} from 'react';
import type {Agent,Batch,Event,Team} from '../../src/core';
import {normalizeCopiedJson} from '../../src/json-cleanup';
import {buildAgentSyncCheckPrompt,buildRepositoryInitializationPrompt,normalizeGitHubRepository} from '../../src/project-preparation';
import {emptyRepositoryWizardProgress,loadRepositoryWizardChatSnapshot,loadRepositoryWizardProgress,registerRepositoryWizardChat,removeRepositoryWizardChat,resetRepositoryWizardProgress,saveRepositoryWizardProgress,type RepositoryWizardProgress,type RepositoryWizardChatKind} from '../../src/repository-wizard';
import {chatAdapter} from '../../src/chat-adapter';

type Props={repository:string;requestedWork:string;batches:Batch[];teams:Team[];agents:Agent[];events:Event[];onOpenWorkspace:()=>void};
type CheckReply={initialized:boolean|null;evidence?:unknown[];missing?:unknown[];blocker?:string|null};
function parseReply(text:string):CheckReply|undefined{
  try{const value=JSON.parse(normalizeCopiedJson(text)) as Partial<CheckReply>;if(value&&typeof value==='object'&&(typeof value.initialized==='boolean'||value.initialized===null))return {initialized:value.initialized,evidence:Array.isArray(value.evidence)?value.evidence:[],missing:Array.isArray(value.missing)?value.missing:[],blocker:typeof value.blocker==='string'?value.blocker:null};}catch{/* The guide offers manual confirmation if ChatGPT does not return JSON. */}
  return undefined;
}
function repoMatches(value:string,repository:string){try{return normalizeGitHubRepository(value).toLowerCase()===repository.toLowerCase();}catch{return false;}}
function isoNow(){return new Date().toISOString();}

export default function RepositoryWizard({repository,requestedWork,batches,teams,agents,events,onOpenWorkspace}:Props){
  const [progress,setProgress]=useState<RepositoryWizardProgress>(()=>emptyRepositoryWizardProgress(repository));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const progressRef=useRef(progress);
  const processingRef=useRef('');
  progressRef.current=progress;

  async function persist(next:RepositoryWizardProgress){progressRef.current=next;setProgress(next);await saveRepositoryWizardProgress(next);}
  async function patch(patch:Partial<RepositoryWizardProgress>){await persist({...progressRef.current,...patch,repository});}

  useEffect(()=>{let active=true;void loadRepositoryWizardProgress(repository).then(value=>{if(active){progressRef.current=value;setProgress(value);}});return()=>{active=false;};},[repository]);

  async function startCheck(){
    setBusy(true);setError('');
    try{
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT access was not granted. No repository check was sent.');
      await removeRepositoryWizardChat(repository);
      await persist({...progressRef.current,repository,phase:'checking',checkChatUrl:undefined,initializeChatUrl:undefined,lastReply:undefined,lastHandledMessageId:undefined,checkedAt:undefined});
      const url=await chatAdapter.createNewChat(buildAgentSyncCheckPrompt(repository),`agentsync-repository-check:${repository}:${Date.now()}`);
      await registerRepositoryWizardChat(repository,'check',url);
      await patch({checkChatUrl:url});
    }catch(e){await patch({phase:'needs_confirmation'});setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }

  async function startInitialization(evidence:string){
    setBusy(true);setError('');
    try{
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT access was not granted. Repository initialization was not sent.');
      await persist({...progressRef.current,repository,phase:'initializing',initializeChatUrl:undefined,lastHandledMessageId:undefined,lastReply:evidence});
      const prompt=buildRepositoryInitializationPrompt(repository,requestedWork,evidence);
      const url=await chatAdapter.createNewChat(prompt,`agentsync-repository-initialize:${repository}:${Date.now()}`);
      await registerRepositoryWizardChat(repository,'initialize',url);
      await patch({initializeChatUrl:url});
    }catch(e){await patch({phase:'needs_confirmation'});setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }

  useEffect(()=>{
    let active=true;
    async function poll(){
      if(!active)return;
      const current=progressRef.current;
      const kind:RepositoryWizardChatKind|undefined=current.phase==='checking'?'check':current.phase==='initializing'?'initialize':undefined;
      const url=kind==='check'?current.checkChatUrl:current.initializeChatUrl;
      if(!kind||!url)return;
      try{
        const snapshot=await loadRepositoryWizardChatSnapshot(url);
        if(!snapshot||snapshot.state!=='IDLE'||snapshot.latestRole!=='assistant'||!snapshot.latestMessage.trim()||snapshot.latestMessageId===current.lastHandledMessageId||processingRef.current===snapshot.latestMessageId)return;
        processingRef.current=snapshot.latestMessageId;
        const reply=parseReply(snapshot.latestMessage);
        if(kind==='check'){
          await removeRepositoryWizardChat(repository,url);
          await patch({lastHandledMessageId:snapshot.latestMessageId,lastReply:snapshot.latestMessage,checkedAt:isoNow(),phase:reply?.initialized===true?'initialized':reply?.initialized===false?'needs_initialization':'needs_confirmation'});
          if(reply?.initialized===false&&active)await startInitialization(JSON.stringify(reply));
        }else{
          await removeRepositoryWizardChat(repository,url);
          await patch({lastHandledMessageId:snapshot.latestMessageId,lastReply:snapshot.latestMessage,checkedAt:isoNow(),phase:reply?.initialized===true?'initialized':'needs_confirmation'});
        }
      }catch(e){if(active)setError(e instanceof Error?e.message:String(e));}
    }
    void poll();const timer=window.setInterval(()=>void poll(),2500);
    return()=>{active=false;window.clearInterval(timer);};
  },[repository,progress.phase,progress.checkChatUrl,progress.initializeChatUrl,progress.lastHandledMessageId]);

  const matchingBatches=batches.filter(batch=>repoMatches(batch.config.repository,repository)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const selectedBatch=matchingBatches.find(batch=>batch.id===progress.selectedBatchId)??matchingBatches[0];
  const batchTeams=teams.filter(team=>team.batchId===selectedBatch?.id);
  const selectedTeam=batchTeams.find(team=>team.id===progress.selectedTeamId)??batchTeams[0];
  const supervisor=agents.find(agent=>agent.id===`${selectedTeam?.id}:A0`);
  const developers=agents.filter(agent=>agent.teamId===selectedTeam?.id&&agent.number>0).sort((a,b)=>a.number-b.number);
  const planReceived=Boolean(selectedTeam&&events.some(item=>item.teamId===selectedTeam.id&&item.agentId===`${selectedTeam.id}:A0`&&item.type==='A0_PLAN_READY_FOR_CONTINUE'));
  const stage1Done=progress.phase==='initialized';
  const stage2Done=Boolean(selectedBatch&&supervisor?.chatUrl);
  const stage3Done=Boolean(selectedTeam?.plan||planReceived);
  const stage4Done=developers.length===5&&developers.every(agent=>agent.chatUrl);

  async function recheckLocal(stage:2|3|4){await patch({stageChecks:{...progressRef.current.stageChecks,[stage]:isoNow()}});}
  async function resetStage(stage:1|2|3|4){
    setError('');
    if(stage===1){if(['checking','initializing'].includes(progressRef.current.phase)&&!window.confirm('Reset clears only saved tracking. It cannot stop a ChatGPT check or setup that has already been sent. Continue?'))return;await removeRepositoryWizardChat(repository);const fresh=emptyRepositoryWizardProgress(repository);progressRef.current=fresh;setProgress(fresh);await resetRepositoryWizardProgress(repository);processingRef.current='';return;}
    const stageChecks={...progressRef.current.stageChecks};delete stageChecks[stage];
    await patch(stage===2?{selectedBatchId:undefined,selectedTeamId:undefined,stageChecks:{}}:{stageChecks});
  }
  async function confirmStage1(){await removeRepositoryWizardChat(repository);await patch({phase:'initialized',checkedAt:isoNow(),lastHandledMessageId:undefined});}

  return <section className="repository-wizard" aria-labelledby="repo-wizard-title">
    <div className="repository-wizard-heading"><div><p className="eyebrow">RESUMABLE REPOSITORY WIZARD</p><h3 id="repo-wizard-title">Setup status · {repository}</h3><p>Progress is saved on this device. Rechecks are manual; reset clears only the wizard’s saved check, not repository files or AgentSync chats.</p></div></div>
    <ol className="repo-wizard-steps">
      <li className="repo-wizard-step" data-complete={stage1Done}>
        <div className="repo-wizard-step-top"><span className="repo-wizard-number">1</span><div><h4>AgentSync files and skills</h4><p>{progress.phase==='initialized'?'Initialized or confirmed ready':progress.phase==='checking'?'Waiting for ChatGPT’s read-only check…':progress.phase==='initializing'?'ChatGPT is initializing the missing setup…':progress.phase==='needs_initialization'?'The check found missing setup; starting initialization.':progress.phase==='needs_confirmation'?'Check reply needs review or confirmation.':'Not checked yet.'}</p></div></div>
        <div className="repo-wizard-actions"><button type="button" disabled={busy||progress.phase==='initializing'} onClick={()=>void startCheck()}>{progress.phase==='initializing'?'Initialization running…':progress.phase==='checking'?'Recheck repository':'Check repository'}</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>void resetStage(1)}>Reset</button></div>
        {(progress.checkChatUrl||progress.initializeChatUrl)&&<p className="repo-wizard-link">Chat: <a href={progress.initializeChatUrl??progress.checkChatUrl} target="_blank" rel="noreferrer">Open the current check or setup</a></p>}
        {progress.lastReply&&<details className="repo-wizard-reply"><summary>Review the latest reply</summary><pre>{progress.lastReply}</pre></details>}
        {progress.phase==='needs_initialization'&&<button type="button" disabled={busy} onClick={()=>void startInitialization(progress.lastReply??'')}>Initialize missing setup now</button>}
        {progress.phase==='needs_confirmation'&&<div className="repo-wizard-actions"><button type="button" disabled={busy} onClick={()=>void confirmStage1()}>I confirm setup is ready</button><button type="button" disabled={busy} onClick={()=>void startInitialization(progress.lastReply??'')}>Initialize repository</button></div>}
        {progress.checkedAt&&<small className="repo-wizard-time">Last result: {new Date(progress.checkedAt).toLocaleString()}</small>}
      </li>

      <li className="repo-wizard-step" data-complete={stage2Done}>
        <div className="repo-wizard-step-top"><span className="repo-wizard-number">2</span><div><h4>Imported task file and A0 chat</h4><p>{selectedBatch?`${selectedBatch.filename} · ${supervisor?.chatUrl?'A0 chat saved':'A0 chat not saved'}`:'No task file for this repository is imported in AgentSync.'}</p></div></div>
        {matchingBatches.length>0&&<label>Imported task file<select value={selectedBatch?.id??''} onChange={event=>void patch({selectedBatchId:event.target.value,selectedTeamId:undefined,stageChecks:{}})}>{matchingBatches.map(batch=><option key={batch.id} value={batch.id}>{batch.filename} · {new Date(batch.createdAt).toLocaleDateString()}</option>)}</select></label>}
        {batchTeams.length>1&&<label>Feature team<select value={selectedTeam?.id??''} onChange={event=>void patch({selectedTeamId:event.target.value,stageChecks:{}})}>{batchTeams.map(team=><option key={team.id} value={team.id}>{team.title}</option>)}</select></label>}
        <div className="repo-wizard-actions"><button type="button" onClick={()=>void patch({selectedBatchId:selectedBatch?.id,selectedTeamId:selectedTeam?.id,stageChecks:{...progressRef.current.stageChecks,2:isoNow()}})}>Recheck task and A0</button><button type="button" className="secondary-button" onClick={()=>void resetStage(2)}>Reset</button></div>
        {supervisor?.chatUrl&&<p className="repo-wizard-link"><a href={supervisor.chatUrl} target="_blank" rel="noreferrer">Open saved A0 chat</a></p>}
        {!stage2Done&&<button type="button" className="repo-wizard-reset-link" onClick={onOpenWorkspace}>Open Workspace to import a task file or create A0</button>}
        {progress.stageChecks?.[2]&&<small className="repo-wizard-time">Checked: {new Date(progress.stageChecks[2]).toLocaleString()}</small>}
      </li>

      <li className="repo-wizard-step" data-complete={stage3Done}>
        <div className="repo-wizard-step-top"><span className="repo-wizard-number">3</span><div><h4>A0 plan</h4><p>{selectedTeam?.plan?'Approved plan is saved':planReceived?'A0 returned a plan; it is waiting for your review and approval.':supervisor?.chatUrl?'A0 chat is saved; no plan has been received yet.':'Select a task file and feature team with an A0 chat first.'}</p></div></div>
        {selectedTeam?.plan&&<details className="repo-wizard-reply"><summary>View saved plan</summary><pre>{JSON.stringify(selectedTeam.plan,null,2)}</pre></details>}
        <div className="repo-wizard-actions"><button type="button" onClick={()=>void recheckLocal(3)}>Recheck plan</button><button type="button" className="secondary-button" onClick={()=>void resetStage(3)}>Reset</button></div>
        {supervisor?.chatUrl&&!stage3Done&&<p className="repo-wizard-link"><a href={supervisor.chatUrl} target="_blank" rel="noreferrer">Open A0 to review or continue the plan</a></p>}
        {!stage3Done&&<button type="button" className="repo-wizard-reset-link" onClick={onOpenWorkspace}>Open Workspace to review A0</button>}
        {progress.stageChecks?.[3]&&<small className="repo-wizard-time">Checked: {new Date(progress.stageChecks[3]).toLocaleString()}</small>}
      </li>

      <li className="repo-wizard-step" data-complete={stage4Done}>
        <div className="repo-wizard-step-top"><span className="repo-wizard-number">4</span><div><h4>A1–A5 saved chats</h4><p>{developers.filter(agent=>agent.chatUrl).length} of 5 worker chats saved for the selected team.</p></div></div>
        {selectedTeam&&<div className="repo-wizard-agent-list">{developers.map(agent=><div key={agent.id}><span>A{agent.number} · {agent.role}</span>{agent.chatUrl?<a href={agent.chatUrl} target="_blank" rel="noreferrer">Saved chat</a>:<span className="muted-label">Not saved</span>}</div>)}</div>}
        <div className="repo-wizard-actions"><button type="button" onClick={()=>void recheckLocal(4)}>Recheck worker chats</button><button type="button" className="secondary-button" onClick={()=>void resetStage(4)}>Reset</button></div>
        {progress.stageChecks?.[4]&&<small className="repo-wizard-time">Checked: {new Date(progress.stageChecks[4]).toLocaleString()}</small>}
      </li>
    </ol>
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
