import type { Team } from './core';
import { GitHubReader, GitHubNotFound, repoPath, makeBinding, commentEnvelope, parseComment, type GitHubBinding } from './github.ts';
import { parseMessage, messageKey, type ProtocolMessage } from './protocol.ts';
export type ProvisionResult={issueNumbers:number[]; binding:GitHubBinding|null};
const roles=['Architecture','Backend','Frontend','Integration','QA and security'];
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Unexpected GitHub response.');return v as Record<string,unknown>;}
function positive(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1)throw new Error('Invalid GitHub number.');return v;}
function marker(teamId:string,role:string):string{
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(teamId))throw new Error('Invalid team identifier.');
  return '<!-- agentsync:team='+teamId+';role='+role+' -->';
}
function hasMarker(v:Record<string,unknown>,m:string):boolean{return typeof v.body==='string'&&v.body.split(/\r?\n/).includes(m);}
function branchPath(b:string):string{
  if(!b||b.includes('..')||b.includes('@{')||/[\s~^:?*\\[\]\\]/.test(b)||b.split('/').some(x=>!x||x.startsWith('.')||x.endsWith('.lock'))||b.endsWith('.'))throw new Error('Invalid branch.');
  return b.split('/').map(encodeURIComponent).join('/');
}
function title(s:string):string{return s.replace(/[\r\n]+/g,' ').slice(0,180);}
export class GitHubWriter extends GitHubReader {
  private async scan(path:string):Promise<Record<string,unknown>[]>{
    const all:Record<string,unknown>[]=[];
    for(let page=1;page<=10;page++){
      const rows=await this.get(path+(path.includes('?')?'&':'?')+'per_page=100&page='+page);
      if(!Array.isArray(rows))throw new Error('Unexpected GitHub collection.');
      all.push(...rows.map(obj));
      if(rows.length<100)return all;
    }
    throw new Error('Resource scan exceeded 1,000 records. Stop and reconcile manually before creating anything.');
  }
  private async ref(root:string,branch:string):Promise<string|null>{
    try{
      const result=obj(await this.get(root+'/git/ref/heads/'+branchPath(branch)));
      if(result.ref!=='refs/heads/'+branch)throw new Error('Branch reference mismatch.');
      const sha=obj(result.object).sha;
      if(typeof sha!=='string'||!/^[a-f0-9]{40}$/i.test(sha))throw new Error('Invalid branch SHA.');
      return sha;
    }catch(e){if(e instanceof GitHubNotFound)return null;throw e;}
  }
  async provision(team:Team):Promise<ProvisionResult>{
    const root=repoPath(team.repository);
    const repo=obj(await this.get(root));
    if(typeof repo.full_name!=='string'||repo.full_name.toLowerCase()!==team.repository.toLowerCase()||!Number.isSafeInteger(repo.id))throw new Error('Repository identity mismatch.');
    if(!team.branch.startsWith('feature/')||team.branch===team.baseBranch)throw new Error('Expected an isolated feature branch.');
    const base=await this.ref(root,team.baseBranch);if(!base)throw new Error('Base branch is missing or inaccessible.');
    const feature=await this.ref(root,team.branch);
    // Complete discovery before any write. Search exact markers, including closed resources.
    const issueRows=await this.scan(root+'/issues?state=all&sort=created&direction=asc');
    const pullRows=await this.scan(root+'/pulls?state=all&head='+encodeURIComponent(team.repository.split('/')[0]+':'+team.branch)+'&base='+encodeURIComponent(team.baseBranch));
    const issueNumbers:(number|null)[]=roles.map((_,i)=>{
      const matches=issueRows.filter(x=>!x.pull_request&&hasMarker(x,marker(team.id,'A'+(i+1))));
      if(matches.length>1)throw new Error('Duplicate marked issues for A'+(i+1)+'. Reconcile manually.');
      if(matches.length===1&&matches[0].state!=='open')throw new Error('A marked developer issue is closed. Reconcile manually.');
      return matches.length?positive(matches[0].number):null;
    });
    const matching=pullRows.filter(p=>{
      const h=obj(p.head),b=obj(p.base);
      return h.ref===team.branch&&b.ref===team.baseBranch&&obj(h.repo).id===repo.id&&obj(b.repo).id===repo.id;
    });
    if(matching.length>1||matching.some(p=>!hasMarker(p,marker(team.id,'A0'))||p.state!=='open'))throw new Error('Existing PR conflict. Bind or reconcile manually; no new resources created.');
    if(!feature&&matching.length)throw new Error('Existing PR has no accessible feature branch.');
    if(team.pullRequestNumber!==undefined||new Set(issueNumbers.filter(n=>n!==null)).size!==issueNumbers.filter(n=>n!==null).length)throw new Error('Team already bound or resource collision.');
    if(!feature){
      const created=obj(await this.request(root+'/git/refs','POST',{ref:'refs/heads/'+team.branch,sha:base}));
      if(created.ref!=='refs/heads/'+team.branch||obj(created.object).sha!==base)throw new Error('Unexpected created ref. Inspect GitHub before retrying.');
    }
    for(let i=0;i<roles.length;i++){
      if(issueNumbers[i]!==null)continue;
      const m=marker(team.id,'A'+(i+1));
      const created=obj(await this.request(root+'/issues','POST',{title:title(team.title)+' | A'+(i+1)+' — '+roles[i],body:m+'\n\nFeature branch: '+team.branch+'\n\nCoordinate scope, progress, dependencies and verified evidence with A0. Do not merge.'}));
      if(!hasMarker(created,m)||created.pull_request)throw new Error('Unexpected created issue. Inspect GitHub before retrying.');
      issueNumbers[i]=positive(created.number);
    }
    const issues=issueNumbers.map(positive);
    let pr=matching.length?positive(matching[0].number):null;
    if(pr===null){
      const compare=obj(await this.get(root+'/compare/'+branchPath(team.baseBranch)+'...'+branchPath(team.branch)));
      if(typeof compare.ahead_by!=='number'||!Number.isSafeInteger(compare.ahead_by)||compare.ahead_by<0)throw new Error('Invalid comparison response.');
      if(compare.ahead_by===0)return {issueNumbers:issues,binding:null};
      const m=marker(team.id,'A0');
      const created=obj(await this.request(root+'/pulls','POST',{title:title(team.title),head:team.branch,base:team.baseBranch,draft:true,body:m+'\n\nDeveloper issues: '+issues.map(n=>'#'+n).join(', ')+'\n\nHuman review required. No automatic merge.'}));
      if(!hasMarker(created,m))throw new Error('Unexpected created PR. Inspect GitHub before retrying.');
      pr=positive(created.number);
    }
    const binding=makeBinding(team,pr,issues);
    await this.verify(binding);
    return {issueNumbers:issues,binding};
  }
  async publish(teamId:string,binding:GitHubBinding,input:ProtocolMessage):Promise<'PUBLISHED'|'EXISTS'>{
    const message=parseMessage(JSON.stringify(input));
    if(message.teamId!==teamId)throw new Error('Message team mismatch.');
    await this.verify(binding);
    const n=message.type==='AGENT_STATUS'?binding.issueNumbers[message.agentId-1]:binding.pullRequestNumber;
    const path=repoPath(binding.repository)+'/issues/'+positive(n)+'/comments';
    const rows=await this.scan(path);
    let existing=false;
    for(const row of rows){
      if(typeof row.body!=='string')continue;
      let parsed:ProtocolMessage|null;
      try{parsed=parseComment(row.body);}catch{continue;}
      if(!parsed||messageKey(parsed)!==messageKey(message))continue;
      if(JSON.stringify(parsed)!==JSON.stringify(message))throw new Error('Conflicting published message ID.');
      existing=true;
    }
    if(existing)return 'EXISTS';
    const body=commentEnvelope(message);
    if(body.length>65000)throw new Error('Comment exceeds GitHub body limit.');
    const created=obj(await this.request(path,'POST',{body}));
    if(created.body!==body)throw new Error('Unexpected comment response. Inspect GitHub before retrying.');
    return 'PUBLISHED';
  }
}
