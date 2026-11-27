import {useState} from 'react';
import {browser} from 'wxt/browser';
import type {Agent,Team} from '../../src/core';
import {GitHubReader,formatA0RepositoryContext,makeBinding,type SyncResult,type GitHubCandidate} from '../../src/github';
import {saveGitHubBinding,importProtocolMessage} from '../../src/database';
import {chatAdapter} from '../../src/chat-adapter';
import {GitHubWriter} from '../../src/github-writer';
import {GitHubCompletion,type CompletionEvidence} from '../../src/github-completion';
import {parseMessage} from '../../src/protocol';
import {loadTimingSettings} from '../../src/extension-settings';

export default function GitHubPanel({team,agents}:{team:Team;agents:Agent[]}){
  const developers=agents.filter(a=>a.number!==0).sort((a,b)=>a.number-b.number);
  const [token,setToken]=useState(''),[pr,setPr]=useState(String(team.pullRequestNumber??'')),[issues,setIssues]=useState(developers.map(a=>String(a.issueNumber??'')));
  const [busy,setBusy]=useState(false),[result,setResult]=useState<SyncResult|null>(null),[notice,setNotice]=useState(''),[error,setError]=useState(''),[dismissed,setDismissed]=useState<string[]>([]);
  const [outbound,setOutbound]=useState('');
  const [evidence,setEvidence]=useState<CompletionEvidence|null>(null);
  const bound=team.pullRequestNumber!==undefined&&developers.length===5&&developers.every(a=>a.issueNumber!==undefined);
  async function run(fn:()=>Promise<void>){
    setBusy(true);setError('');setNotice('');
    try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  function synchronize(){
    // Request optional host access directly from the user gesture.
    if(!token.trim())return;
    setResult(null);setDismissed([]);
    void run(async()=>{
      if(!await browser.permissions.request({origins:['https://api.github.com/*']}))throw new Error('GitHub host permission declined.');
      const binding=bound?makeBinding(team,team.pullRequestNumber!,developers.map(a=>a.issueNumber!)):makeBinding(team,Number(pr),issues.map(Number));
      const reader=new GitHubReader(token,fetch,(await loadTimingSettings()).githubRequestTimeoutMs);
      if(!bound){
        if(!window.confirm('Bind these six existing GitHub resources to this team? The binding is immutable. Verify the issue assignments yourself.'))return;
        await reader.verify(binding);
        await saveGitHubBinding(team.id,binding);
        setNotice('GitHub resources verified and bound.');
      }else{
        const next=await reader.sync(team.id,binding);
        setResult(next);setNotice('Read-only synchronization completed.');
      }
    });
  }
  function copyA0RepositoryContext(){
    if(!bound||!token.trim())return;
    void run(async()=>{
      if(!await browser.permissions.contains({permissions:['clipboardWrite']}))throw new Error('Grant clipboard writing in Settings before copying context for A0.');
      if(!await browser.permissions.request({origins:['https://api.github.com/*']}))throw new Error('GitHub host permission declined.');
      const binding=makeBinding(team,team.pullRequestNumber!,developers.map(a=>a.issueNumber!));
      const context=await new GitHubReader(token,fetch,(await loadTimingSettings()).githubRequestTimeoutMs).readContext(binding);
      await chatAdapter.copyPrompt(formatA0RepositoryContext(context,team.id));
      setNotice('Verified PR and issue context copied. Review it, then paste it into this team’s A0 chat.');
    });
  }
  function provision(){
    if(!token.trim()||bound||!window.confirm('Authorize creation or reuse of the feature branch, five marked issues and a draft PR in '+team.repository+'? No code is committed or merged.'))return;
    void run(async()=>{
      if(!await browser.permissions.request({origins:['https://api.github.com/*']}))throw new Error('GitHub host permission declined.');
      if(!navigator.locks)throw new Error('Browser execution locks unavailable.');
      await navigator.locks.request('agentsync:github:'+team.repository.toLowerCase(),async()=>{
        const outcome=await new GitHubWriter(token,fetch,(await loadTimingSettings()).githubRequestTimeoutMs).provision(team);
        setIssues(outcome.issueNumbers.map(String));
        if(outcome.binding){await saveGitHubBinding(team.id,outcome.binding);setNotice('GitHub resources provisioned and bound.');}
        else setNotice('Branch and five issues are ready: '+outcome.issueNumbers.map(n=>'#'+n).join(', ')+'. Commit feature code, then run provisioning again to create the draft PR.');
      });
    });
  }
  function publish(){
    if(!bound||!token.trim())return;
    void run(async()=>{
      const message=parseMessage(outbound);
      if(message.teamId!==team.id)throw new Error('Message team mismatch.');
      if(!window.confirm('Publish this reviewed JSON message to its bound GitHub issue or PR? Verify the source conversation and remove sensitive content first.'))return;
      if(!await browser.permissions.request({origins:['https://api.github.com/*']}))throw new Error('GitHub host permission declined.');
      if(!navigator.locks)throw new Error('Browser execution locks unavailable.');
      const binding=makeBinding(team,team.pullRequestNumber!,developers.map(a=>a.issueNumber!));
      const timeoutMs=(await loadTimingSettings()).githubRequestTimeoutMs;
      const status=await navigator.locks.request('agentsync:github:'+team.repository.toLowerCase(),()=>new GitHubWriter(token,fetch,timeoutMs).publish(team.id,binding,message));
      setNotice(status==='EXISTS'?'Message already exists; no write.':'Comment published.');
      setOutbound('');
    });
  }
  function inspectCompletion(){
    if(!bound||!team.finalizedAt||!token.trim())return;
    setEvidence(null);
    void run(async()=>{
      if(!await browser.permissions.request({origins:['https://api.github.com/*']}))throw new Error('GitHub host permission declined.');
      const binding=makeBinding(team,team.pullRequestNumber!,developers.map(a=>a.issueNumber!));
      setEvidence(await new GitHubCompletion(token,fetch,(await loadTimingSettings()).githubRequestTimeoutMs).inspect(team,binding));
    });
  }
  function closeIssues(){
    if(!bound||!team.finalizedAt||!token.trim()||!evidence||evidence.blockers.length)return;
    const approvedHead=evidence.headSha;
    if(!window.confirm('Close the five marked developer issues as completed for reviewed commit '+approvedHead+'? Confirm that the code, actual required checks, review and repository rules have been independently verified. No PR will be merged or marked ready.'))return;
    setEvidence(null);
    void run(async()=>{
      if(!await browser.permissions.request({origins:['https://api.github.com/*']}))throw new Error('GitHub host permission declined.');
      if(!navigator.locks)throw new Error('Browser execution locks unavailable.');
      const binding=makeBinding(team,team.pullRequestNumber!,developers.map(a=>a.issueNumber!));
      const timeoutMs=(await loadTimingSettings()).githubRequestTimeoutMs;
      const closed=await navigator.locks.request('agentsync:github:'+team.repository.toLowerCase(),()=>new GitHubCompletion(token,fetch,timeoutMs).closeCompletedIssues(team,binding,approvedHead));
      setNotice('Completed issues: '+closed.map(n=>'#'+n).join(', ')+'. Refresh evidence before further actions.');
    });
  }
  function approve(candidate:GitHubCandidate){
    if(!window.confirm('Confirm the GitHub author, original conversation and message content. Importing an ACCEPT marks the developer completed locally; no remote issue is closed.'))return;
    void run(async()=>{
      const agent=agents.find(a=>a.number===candidate.sourceAgent);
      if(!agent)throw new Error('Unknown source agent.');
      const status=await importProtocolMessage(team.id,agent.id,JSON.stringify(candidate.message));
      setDismissed(previous=>[...previous,candidate.key]);
      setNotice(status==='DUPLICATE'?'Already imported; no changes.':'Message imported.');
    });
  }
  return <><h2>GitHub connection</h2><section className="panel">
    <p>{team.repository} · {team.branch} → {team.baseBranch}</p>
    <p>Use a repository-restricted fine-grained token with read access to issues and pull requests. Provisioning requires Contents, Issues and Pull requests write access; publishing requires relevant comment write access. Enter it here only; never paste it into chat. The token stays in panel memory and is not persisted.</p>
    <label>GitHub token<input type="password" autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={e=>{setToken(e.target.value);setEvidence(null);setResult(null);setDismissed([]);}}/></label>
    {!bound?<><label>Existing feature PR number<input inputMode="numeric" value={pr} disabled={busy} onChange={e=>setPr(e.target.value)}/></label>
      {developers.map((a,i)=><label key={a.id}>A{a.number} issue number<input inputMode="numeric" value={issues[i]??''} disabled={busy} onChange={e=>setIssues(old=>old.map((v,j)=>j===i?e.target.value:v))}/></label>)}</>:<p>Bound PR #{team.pullRequestNumber} · {developers.map(a=>'A'+a.number+': #'+a.issueNumber).join(' · ')}</p>}
    <div className="buttons"><button disabled={busy||!token.trim()} onClick={synchronize}>{bound?'Read GitHub comments':'Verify and bind'}</button>{bound&&<button disabled={busy||!token.trim()} onClick={copyA0RepositoryContext}>Read PR and issues for A0</button>}{!bound&&<button disabled={busy||!token.trim()} onClick={provision}>Provision or recover resources</button>}<button disabled={busy} onClick={()=>{setToken('');setEvidence(null);setResult(null);setDismissed([]);}}>Clear token</button></div>
    {bound&&<small>Read PR/issue details is read-only. It copies titles, states, links and bounded descriptions for A0; inspect the copied content before pasting it.</small>}
    {notice&&<p role="status" className="notice">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
    {result&&<><p>{result.candidates.length} protocol candidates · {result.rejected} rejected</p>{result.truncated&&<p role="alert">Partial scan: the 300-comment limit was reached for at least one resource.</p>}
      {result.candidates.filter(c=>!dismissed.includes(c.key)).map(c=><div className="order" key={c.key}><strong>A{c.sourceAgent} · {c.message.type}</strong><p>GitHub author: {c.author} · resource #{c.number}</p><a href={c.url} target="_blank" rel="noreferrer">Review original comment</a><pre>{JSON.stringify(c.message,null,2)}</pre><button disabled={busy} onClick={()=>approve(c)}>Approve local import</button></div>)}</>}
    {bound&&<><h3>Publish reviewed protocol message</h3><textarea aria-label="Outgoing protocol JSON" value={outbound} onChange={e=>setOutbound(e.target.value)} maxLength={100000}/><button disabled={busy||!token.trim()||!outbound.trim()} onClick={publish}>Review and publish comment</button></>}
    {bound&&team.finalizedAt&&<div className="order"><h3>GitHub completion evidence</h3><p>Read access to Checks and Commit statuses is required. Only observed head-commit checks are assessed; branch rules and required review must be verified independently. Unmarked resources require manual closure.</p>
      <button disabled={busy||!token.trim()} onClick={inspectCompletion}>Inspect completion evidence</button>
      {evidence&&<><p>Reviewed head: <code>{evidence.headSha}</code> · {evidence.draft?'Draft':'Not draft'}</p>
        {evidence.issues.map(i=><p key={i.number}>Issue #{i.number}: {i.state} · {i.marked?'Marked':'Unmarked'}</p>)}
        {evidence.checks.map((c,i)=><p key={i}>{c.name}: {c.passed?'Passed':'Not passed'}</p>)}
        {evidence.blockers.map(b=><p key={b} role="alert" className="error">{b}</p>)}
        {!evidence.blockers.length&&<p>Observed checks passed. This is not a merge-readiness determination.</p>}
        <button disabled={busy||!token.trim()||evidence.blockers.length>0||evidence.issues.every(i=>i.state==='closed')} onClick={closeIssues}>Review and close developer issues</button>
        <p><a href={'https://github.com/'+team.repository+'/pull/'+team.pullRequestNumber} target="_blank" rel="noreferrer">Review PR and change readiness manually on GitHub</a></p></>}
    </div>}
    <p>GitHub author identity alone cannot establish which ChatGPT conversation produced a message. All imports require your review. Remote writes require explicit confirmation; no background polling. If a write fails, inspect the repository before retrying.</p>
  </section></>;
}
