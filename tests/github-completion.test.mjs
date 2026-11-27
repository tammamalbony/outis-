import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubCompletion } from '../src/github-completion.ts';
import { makeBinding } from '../src/github.ts';
const team={id:'t',repository:'owner/project',branch:'feature/t',baseBranch:'develop',pullRequestNumber:6,finalizedAt:'now'};
const binding=makeBinding(team,6,[1,2,3,4,5]);
const sha='a'.repeat(40);
function fake({noChecks=false,failed=false,unmarked=false,partial=false,changed=false,failClose=false}={}){
  const writes=[],closed=new Set();let pulls=0;
  const mark=n=>'<!-- agentsync:team=t;role=A'+n+' -->';
  const reader=new GitHubCompletion('token',async(url,init)=>{
    const path=new URL(url).pathname.replace('/repos/owner/project','');
    const response=v=>new Response(JSON.stringify(v));
    if(path==='')return response({id:1,full_name:team.repository});
    if(path==='/pulls/6')return response({number:6,state:'open',merged:false,mergeable:true,draft:true,body:mark(0),head:{ref:team.branch,sha:changed&&++pulls>=3?'b'.repeat(40):sha,repo:{id:1}},base:{ref:team.baseBranch,repo:{id:1}}});
    if(path.endsWith('/check-runs'))return response({total_count:noChecks?0:partial?2:1,check_runs:noChecks?[]:[{name:'CI',head_sha:sha,status:'completed',conclusion:failed?'failure':'success'}]});
    if(path.endsWith('/status'))return response({sha,state:'pending',total_count:0,statuses:[]});
    const n=Number(path.split('/').at(-1));
    if(init.method==='PATCH'){writes.push(n);closed.add(n);if(failClose&&n===2)throw Error('ambiguous write');}
    return response({number:n,state:closed.has(n)?'closed':'open',state_reason:closed.has(n)?'completed':null,body:unmarked&&n===1?'other':mark(n)});
  });return {reader,writes};
}
test('inspect finalized team with successful observed checks, without writes',async()=>{const f=fake();const e=await f.reader.inspect(team,binding);assert.equal(e.headSha,sha);assert.deepEqual(e.blockers,[]);assert.equal(e.issues.length,5);assert.deepEqual(f.writes,[]);await assert.rejects(f.reader.inspect({...team,finalizedAt:undefined},binding),/Finalize/);});
test('missing, failed or incomplete checks and unmarked resources block closure',async()=>{for(const options of [{noChecks:true},{failed:true},{partial:true},{unmarked:true}]){const f=fake(options);assert.ok((await f.reader.inspect(team,binding)).blockers.length);await assert.rejects(f.reader.closeCompletedIssues(team,binding,sha),/blocked/);assert.deepEqual(f.writes,[]);}});
test('stale approved head and changed PR fail closed',async()=>{const a=fake();await assert.rejects(a.reader.closeCompletedIssues(team,binding,'b'.repeat(40)),/changed/);assert.deepEqual(a.writes,[]);const b=fake({changed:true});await assert.rejects(b.reader.inspect(team,binding),/changed/);assert.deepEqual(b.writes,[]);});
test('closure is recoverable after a remote write succeeds but its response fails',async()=>{const f=fake({failClose:true});await assert.rejects(f.reader.closeCompletedIssues(team,binding,sha),/ambiguous/);assert.deepEqual(await f.reader.closeCompletedIssues(team,binding,sha),[1,2,3,4,5]);assert.deepEqual(f.writes,[1,2,3,4,5]);assert.deepEqual(await f.reader.closeCompletedIssues(team,binding,sha),[1,2,3,4,5]);assert.equal(f.writes.length,5);});
