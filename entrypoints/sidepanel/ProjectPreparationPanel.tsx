import {useEffect,useState} from 'react';
import {browser} from 'wxt/browser';
import {buildA0SkillPrompt,buildAgentSkillsPrompt,buildAgentSyncCheckPrompt,buildRepositorySetupPrompt,normalizeGitHubRepository} from '../../src/project-preparation';
import type {Agent,Batch,Event,Team} from '../../src/core';
import RepositoryWizard from './RepositoryWizard';

type Prompt={id:string;title:string;description:string;text:string};
const preparationStorageKey='agentsync.repository-preparation.v1';
function promptsFor(normalized:string,requestedWork:string):Prompt[]{return [
  {id:'setup',title:'1. Prepare the repo and open a draft PR',description:'Inspect and initialize the repository for AgentSync v2, then return the real setup links.',text:buildRepositorySetupPrompt(normalized,requestedWork)},
  {id:'a0',title:'2. Create the A0 supervisor skill',description:'Define A0 planning, blocker checks, GitHub evidence review, and JSON-only dispatch rules.',text:buildA0SkillPrompt(normalized,requestedWork)},
  {id:'agents',title:'3. Create the A1–A5 agent skills',description:'Create five distinct skills and enforce the shared JSON-array status report.',text:buildAgentSkillsPrompt(normalized,requestedWork)},
  {id:'check',title:'4. Check whether AgentSync v2 is already set up',description:'Read-only check that returns verified file names, issue links, and pull request links.',text:buildAgentSyncCheckPrompt(normalized)},
];}

export default function ProjectPreparationPanel({onClipboardGranted,batches,teams,agents,events,onOpenWorkspace}:{onClipboardGranted?:()=>void;batches:Batch[];teams:Team[];agents:Agent[];events:Event[];onOpenWorkspace:()=>void}){
  const [open,setOpen]=useState(true);
  const [repository,setRepository]=useState('');
  const [requestedWork,setRequestedWork]=useState('');
  const [repo,setRepo]=useState('');
  const [prompts,setPrompts]=useState<Prompt[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{let active=true;void browser.storage.local.get(preparationStorageKey).then(stored=>{if(!active)return;const saved=stored[preparationStorageKey] as {repository?:string;requestedWork?:string;repo?:string}|undefined;const nextRepository=saved?.repository??'',nextWork=saved?.requestedWork??'',nextRepo=saved?.repo??'';setRepository(nextRepository);setRequestedWork(nextWork);if(nextRepo){try{const normalized=normalizeGitHubRepository(nextRepo);setRepo(normalized);setPrompts(promptsFor(normalized,nextWork));}catch{/* Stale local input is left editable and can be prepared again. */}}setLoaded(true);});return()=>{active=false;};},[]);
  useEffect(()=>{if(loaded)void browser.storage.local.set({[preparationStorageKey]:{repository,requestedWork,repo}});},[loaded,repository,requestedWork,repo]);
  async function copy(prompt:Prompt){
    setError('');setNotice('');
    try{
      if(!await browser.permissions.contains({permissions:['clipboardWrite']})){
        if(!await browser.permissions.request({permissions:['clipboardWrite']}))throw new Error('Clipboard access was not granted. Grant it in Settings to copy prompts.');
        onClipboardGranted?.();
      }
      await navigator.clipboard.writeText(prompt.text);
      setNotice(`${prompt.title} copied. Paste it into a repository-connected chat.`);
    }catch(e){setError(e instanceof Error?e.message:'Could not copy the prompt.');}
  }
  function prepare(){
    setError('');setNotice('');
    try{
      const normalized=normalizeGitHubRepository(repository);
      setRepo(normalized);
      setPrompts(promptsFor(normalized,requestedWork));
    }catch(e){setError(e instanceof Error?e.message:'Could not prepare prompts.');setRepo('');setPrompts([]);}
  }
  return <section className="panel project-preparation" aria-labelledby="project-preparation-title">
    <div className="agenthead"><div><p className="eyebrow">REPOSITORY WORKFLOW</p><h2 id="project-preparation-title">Repository prompts</h2></div><button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Close':'Enter repository link'}</button></div>
    {!open&&<p>Enter a GitHub repository link to create four copyable prompts for setup, A0, the five agent skills, and an existing AgentSync v2 check.</p>}
    {open&&<>
      <label>GitHub repository link<input value={repository} disabled={!loaded} onChange={e=>{setRepository(e.target.value);setRepo('');setPrompts([]);}} placeholder="https://github.com/owner/repository" autoComplete="url"/></label>
      <label>What should the repository workflow support? <span className="muted-label">Optional</span><textarea value={requestedWork} disabled={!loaded} onChange={e=>{setRequestedWork(e.target.value);setPrompts([]);}} placeholder="Describe the requested project or leave blank for repository inspection."/></label>
      <button type="button" disabled={!loaded} onClick={prepare}>Prepare four prompts</button>
    </>}
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    {repo&&<div className="project-prompts">
      <p>Repository: <strong>{repo}</strong></p>
      {prompts.map(prompt=><section className="prompt-card" key={prompt.id}><div className="agenthead"><strong>{prompt.title}</strong><button type="button" onClick={()=>void copy(prompt)}>Copy prompt</button></div><p>{prompt.description}</p><details><summary>Review prompt</summary><pre>{prompt.text}</pre></details></section>)}
      <RepositoryWizard repository={repo} requestedWork={requestedWork} batches={batches} teams={teams} agents={agents} events={events} onOpenWorkspace={onOpenWorkspace}/>
    </div>}
  </section>;
}
