import {useState} from 'react';
import {browser} from 'wxt/browser';
import {buildA0SkillPrompt,buildAgentSkillsPrompt,buildAgentSyncCheckPrompt,buildRepositorySetupPrompt,normalizeGitHubRepository} from '../../src/project-preparation';

type Prompt={id:string;title:string;description:string;text:string};

export default function ProjectPreparationPanel({onClipboardGranted}:{onClipboardGranted?:()=>void}){
  const [open,setOpen]=useState(true);
  const [repository,setRepository]=useState('');
  const [requestedWork,setRequestedWork]=useState('');
  const [repo,setRepo]=useState('');
  const [prompts,setPrompts]=useState<Prompt[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
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
      setPrompts([
        {id:'setup',title:'1. Prepare the repo and open a draft PR',description:'Inspect and initialize the repository for AgentSync v2, then return the real setup links.',text:buildRepositorySetupPrompt(normalized,requestedWork)},
        {id:'a0',title:'2. Create the A0 supervisor skill',description:'Define A0 planning, blocker checks, GitHub evidence review, and JSON-only dispatch rules.',text:buildA0SkillPrompt(normalized,requestedWork)},
        {id:'agents',title:'3. Create the A1–A5 agent skills',description:'Create five distinct skills and enforce the shared JSON-array status report.',text:buildAgentSkillsPrompt(normalized,requestedWork)},
        {id:'check',title:'4. Check whether AgentSync v2 is already set up',description:'Read-only check that returns verified file names, issue links, and pull request links.',text:buildAgentSyncCheckPrompt(normalized)},
      ]);
    }catch(e){setError(e instanceof Error?e.message:'Could not prepare prompts.');setRepo('');setPrompts([]);}
  }
  return <section className="panel project-preparation" aria-labelledby="project-preparation-title">
    <div className="agenthead"><div><p className="eyebrow">REPOSITORY WORKFLOW</p><h2 id="project-preparation-title">Repository prompts</h2></div><button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Close':'Enter repository link'}</button></div>
    {!open&&<p>Enter a GitHub repository link to create four copyable prompts for setup, A0, the five agent skills, and an existing AgentSync v2 check.</p>}
    {open&&<>
      <label>GitHub repository link<input value={repository} onChange={e=>setRepository(e.target.value)} placeholder="https://github.com/owner/repository" autoComplete="url"/></label>
      <label>What should the repository workflow support? <span className="muted-label">Optional</span><textarea value={requestedWork} onChange={e=>setRequestedWork(e.target.value)} placeholder="Describe the requested project or leave blank for repository inspection."/></label>
      <button type="button" onClick={prepare}>Prepare four prompts</button>
    </>}
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    {repo&&<div className="project-prompts">
      <p>Repository: <strong>{repo}</strong></p>
      {prompts.map(prompt=><section className="prompt-card" key={prompt.id}><div className="agenthead"><strong>{prompt.title}</strong><button type="button" onClick={()=>void copy(prompt)}>Copy prompt</button></div><p>{prompt.description}</p><details><summary>Review prompt</summary><pre>{prompt.text}</pre></details></section>)}
    </div>}
  </section>;
}
