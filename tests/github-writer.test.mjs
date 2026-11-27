import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHubWriter} from '../src/github-writer.ts';
import {makeBinding} from '../src/github.ts';
const team={id:'team-1',repository:'owner/project',branch:'feature/one',baseBranch:'develop',title:'Feature One'};
const sha='a'.repeat(40);
function fake({ahead=0,duplicate=false,failIssue=false,unmarkedPr=false}={}){
 let branch=false,n=0,issues=[],pulls=[],comments=[],writes=[];
 const mark=(role)=>'<!-- agentsync:team=team-1;role='+role+' -->';
 if(duplicate)issues=[{number:1,state:'open',body:mark('A1')},{number:2,state:'open',body:mark('A1')}];
 if(unmarkedPr)pulls=[{number:20,state:'open',body:'other',head:{ref:team.branch,repo:{id:1}},base:{ref:team.baseBranch,repo:{id:1}}}];
 const response=(v,status=200)=>new Response(JSON.stringify(v),{status});
 const fetcher=async(url,init)=>{
  const path=decodeURIComponent(new URL(url).pathname).replace('/repos/owner/project','');
  const body=init.body?JSON.parse(init.body):undefined;
  if(init.method==='POST'){
   writes.push([path,body]);
   if(path==='/git/refs'){branch=true;return response({ref:body.ref,object:{sha}},201);}
   if(path==='/issues'){const issue={...body,number:++n,state:'open'};issues.push(issue);if(failIssue&&n===2)throw Error('ambiguous network failure');return response(issue,201);}
   if(path==='/pulls'){const pr={...body,number:++n,state:'open',head:{ref:body.head,repo:{id:1}},base:{ref:body.base,repo:{id:1}}};pulls.push(pr);return response(pr,201);}
   if(path.endsWith('/comments')){comments.push(body);return response(body,201);}
   throw Error('Unexpected write '+path);
  }
  if(path==='')return response({id:1,full_name:'owner/project'});
  if(path.startsWith('/git/ref/heads/')){const name=path.slice('/git/ref/heads/'.length);return name===team.baseBranch||branch?response({ref:'refs/heads/'+name,object:{sha}}):response({},404);}
  if(path==='/issues')return response(issues);
  if(path==='/pulls')return response(pulls);
  if(path.startsWith('/compare/'))return response({ahead_by:ahead});
  if(path.endsWith('/comments'))return response(comments);
  if(path.startsWith('/pulls/'))return response(pulls.find(x=>x.number===Number(path.split('/').at(-1))));
  if(path.startsWith('/issues/'))return response(issues.find(x=>x.number===Number(path.split('/').at(-1))));
  throw Error('Unexpected read '+path);
 };
 return {writer:new GitHubWriter('test-token',fetcher),writes,setAhead:v=>{ahead=v;}};
}
test('provision branch and five issues, defer empty PR, resume without duplicates',async()=>{
 const f=fake();const first=await f.writer.provision(team);assert.equal(first.binding,null);assert.equal(first.issueNumbers.length,5);assert.equal(f.writes.length,6);
 f.setAhead(1);const next=await f.writer.provision(team);assert.equal(next.binding.pullRequestNumber,6);assert.equal(f.writes.length,7);
 assert.equal(f.writes.at(-1)[1].draft,true);assert.deepEqual(await f.writer.provision(team),next);assert.equal(f.writes.length,7);
});
test('recover an issue committed remotely before connection failure',async()=>{
 const f=fake({failIssue:true});await assert.rejects(f.writer.provision(team),/ambiguous/);
 const next=await f.writer.provision(team);assert.deepEqual(next.issueNumbers,[1,2,3,4,5]);assert.equal(f.writes.filter(([p])=>p==='/issues').length,5);
});
test('duplicate issues or unmarked PR stop before any remote writes',async()=>{
 for(const options of [{duplicate:true},{unmarkedPr:true}]){const f=fake(options);await assert.rejects(f.writer.provision(team),/Duplicate|conflict/);assert.equal(f.writes.length,0);}
});
test('publish only scoped messages, deduplicate and reject conflicting reuse',async()=>{
 const f=fake({ahead:1});const {binding}=await f.writer.provision(team);
 const m={type:'AGENT_STATUS',messageId:'r1',teamId:team.id,agentId:1,executionId:'exec',status:'IN_PROGRESS',completed:[],remaining:['work'],dependencies:[]};
 assert.equal(await f.writer.publish(team.id,binding,m),'PUBLISHED');assert.equal(await f.writer.publish(team.id,binding,m),'EXISTS');
 await assert.rejects(f.writer.publish(team.id,binding,{...m,remaining:['other']}),/Conflicting/);
 await assert.rejects(f.writer.publish(team.id,binding,{...m,teamId:'other'}),/team mismatch/);
 assert.equal(f.writes.filter(([p])=>p.endsWith('/comments')).length,1);
});
