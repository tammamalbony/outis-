import { GitHubReader, repoPath, type GitHubBinding } from './github.ts';
import type { Team } from './core';

export type CompletionEvidence = { headSha:string; draft:boolean; issues:{number:number;state:string;marked:boolean}[]; checks:{name:string;passed:boolean}[]; blockers:string[] };
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Unexpected GitHub response.');return v as Record<string,unknown>;}
function marked(body:unknown,teamId:string,agent:number):boolean{return typeof body==='string'&&body.split(/\r?\n/).includes('<!-- agentsync:team='+teamId+';role=A'+agent+' -->');}
export class GitHubCompletion extends GitHubReader {
  async inspect(team:Team,binding:GitHubBinding):Promise<CompletionEvidence>{
    if(!team.finalizedAt||team.repository!==binding.repository||team.branch!==binding.branch||team.baseBranch!==binding.baseBranch||team.pullRequestNumber!==binding.pullRequestNumber)throw new Error('Finalize and bind the team first.');
    await this.verify(binding);
    const root=repoPath(binding.repository),path=root+'/pulls/'+binding.pullRequestNumber;
    const pr=obj(await this.get(path));
    const head=obj(pr.head),base=obj(pr.base);
    const sha=head.sha;
    if(pr.number!==binding.pullRequestNumber||head.ref!==binding.branch||base.ref!==binding.baseBranch||typeof sha!=='string'||!/^[a-f0-9]{40}$/i.test(sha))throw new Error('Invalid PR head identity.');
    const blockers:string[]=[];
    if(pr.state!=='open'||pr.merged!==false)blockers.push('PR is not open and unmerged');
    if(pr.mergeable!==true)blockers.push('GitHub mergeability not confirmed');
    if(!marked(pr.body,team.id,0))blockers.push('PR lacks the team provisioning marker');
    const issues:CompletionEvidence['issues']=[];
    for(const [i,n] of binding.issueNumbers.entries()){
      const issue=obj(await this.get(root+'/issues/'+n));
      if(issue.number!==n||issue.pull_request)throw new Error('Issue identity mismatch.');
      const has=marked(issue.body,team.id,i+1);
      if(!has)blockers.push('Issue #'+n+' lacks its team/agent marker');
      if(issue.state!=='open'&&issue.state!=='closed')throw new Error('Unknown issue state.');
      if(issue.state==='closed'&&issue.state_reason!=='completed')blockers.push('Issue #'+n+' was closed for a reason other than completed');
      issues.push({number:n,state:issue.state,marked:has});
    }
    const checks:CompletionEvidence['checks']=[];
    const runs=obj(await this.get(root+'/commits/'+sha+'/check-runs?filter=latest&per_page=100'));
    if(!Array.isArray(runs.check_runs)||typeof runs.total_count!=='number')throw new Error('Invalid check-run response.');
    if(runs.total_count!==runs.check_runs.length)blockers.push('Check-run scan incomplete');
    for(const value of runs.check_runs){const c=obj(value);checks.push({name:String(c.name),passed:c.head_sha===sha&&c.status==='completed'&&c.conclusion==='success'});}
    const status=obj(await this.get(root+'/commits/'+sha+'/status?per_page=100'));
    if(!Array.isArray(status.statuses)||typeof status.total_count!=='number'||status.sha!==sha)throw new Error('Invalid commit-status response.');
    if(status.total_count!==status.statuses.length)blockers.push('Commit-status scan incomplete');
    for(const value of status.statuses){const c=obj(value);checks.push({name:String(c.context),passed:c.state==='success'});}
    if(status.total_count>0&&status.state!=='success')blockers.push('Combined commit status is not successful');
    if(!checks.length)blockers.push('No head-commit checks or statuses found');
    if(checks.some(c=>!c.passed))blockers.push('At least one observed head-commit check has not succeeded');
    const latest=obj(await this.get(path));
    if(obj(latest.head).sha!==sha||latest.state!==pr.state||latest.merged!==pr.merged||latest.mergeable!==pr.mergeable||obj(latest.base).ref!==binding.baseBranch)throw new Error('PR changed during inspection. Refresh evidence.');
    return {headSha:sha,draft:pr.draft===true,issues,checks,blockers};
  }
  async closeCompletedIssues(team:Team,binding:GitHubBinding,approvedHead:string):Promise<number[]> {
    const evidence=await this.inspect(team,binding);
    if(evidence.headSha!==approvedHead||evidence.blockers.length)throw new Error('Completion evidence changed or is blocked. Review again.');
    const root=repoPath(binding.repository),closed:number[]=[];
    for(const [i,issue] of evidence.issues.entries()){
      const pr=obj(await this.get(root+'/pulls/'+binding.pullRequestNumber));
      if(obj(pr.head).sha!==approvedHead||pr.state!=='open'||pr.merged!==false||obj(pr.base).ref!==binding.baseBranch)throw new Error('PR changed during closure. Inspect partial results before retrying.');
      const current=obj(await this.get(root+'/issues/'+issue.number));
      if(current.number!==issue.number||current.pull_request||!marked(current.body,team.id,i+1))throw new Error('Issue changed. Inspect partial results before retrying.');
      if(current.state==='closed'&&current.state_reason==='completed'){closed.push(issue.number);continue;}
      if(current.state!=='open')throw new Error('Issue state changed. Inspect partial results before retrying.');
      const updated=obj(await this.request(root+'/issues/'+issue.number,'PATCH',{state:'closed',state_reason:'completed'}));
      if(updated.number!==issue.number||updated.state!=='closed'||updated.state_reason!=='completed')throw new Error('Unexpected issue closure response. Inspect partial results before retrying.');
      closed.push(issue.number);
    }
    return closed;
  }
}
