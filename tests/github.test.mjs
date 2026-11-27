import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBinding,parseComment,commentEnvelope,formatA0RepositoryContext,GitHubReader} from '../src/github.ts';
const team={id:'team-1',repository:'owner/project',branch:'feature/one',baseBranch:'develop'};
const binding=makeBinding(team,6,[1,2,3,4,5]);
const report={type:'AGENT_STATUS',messageId:'r1',teamId:'team-1',agentId:1,executionId:'e1',status:'IN_PROGRESS',completed:[],remaining:['work'],dependencies:[]};
const order={type:'DISPATCH_ORDER',orderId:'o1',teamId:'team-1',sourceAgentId:0,targetAgentId:1,action:'RESUME',prompt:'Continue',expectedResult:'Tests'};
function mock({wrongHead=false,issueIsPr=false,fail=0,fullPage=false}={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push([url,init]);const u=new URL(url);const path=u.pathname;
  const response=body=>new Response(JSON.stringify(body),{status:200});
  if(fail)return new Response('',{status:fail});
  if(path==='/repos/owner/project')return response({id:20,full_name:'owner/project'});
  if(path.endsWith('/pulls/6'))return response({number:6,head:{ref:wrongHead?'other':team.branch,repo:{id:20}},base:{ref:'develop',repo:{id:20}}});
  if(path.endsWith('/comments')){
   const n=Number(path.split('/').at(-2));const comment=(id,body)=>({id,body,user:{login:'developer'}});
   return response(fullPage&&n===1?Array.from({length:100},(_,i)=>comment(i+1,'ordinary')):n===1?[comment(10,commentEnvelope(report)),comment(11,commentEnvelope({...report,teamId:'other'})),comment(12,'ordinary')]:n===6?[comment(20,commentEnvelope(order))]:[]);
  }
  const n=Number(path.split('/').at(-1));return response({number:n,...(issueIsPr&&n===1?{pull_request:{}}:{})});
 };return {calls,reader:new GitHubReader('test-token',fetcher)};
}
test('binding requires six distinct positive resource numbers and valid repo',()=>{assert.equal(binding.issueNumbers.length,5);for(const issues of [[1,2],[1,2,3,4,6],[0,2,3,4,5],[1,1,2,3,4]])assert.throws(()=>makeBinding(team,6,issues));assert.throws(()=>makeBinding({...team,repository:'../project'},6,[1,2,3,4,5]));});
test('only explicit protocol envelopes are parsed',()=>{assert.deepEqual(parseComment(commentEnvelope(report)),report);assert.equal(parseComment(JSON.stringify(report)),null);assert.equal(parseComment('quoted\n'+commentEnvelope(report)),null);});
test('read-only sync validates resource and message scope',async()=>{const {calls,reader}=mock();const result=await reader.sync(team.id,binding);assert.deepEqual(result.candidates.map(c=>c.sourceAgent),[0,1]);assert.equal(result.rejected,1);assert.equal(result.truncated,false);assert.ok(calls.every(([u,i])=>u.startsWith('https://api.github.com/')&&i.method==='GET'&&i.redirect==='error'&&i.credentials==='omit'));});
test('wrong PR branch and PR masquerading as issue are rejected',async()=>{await assert.rejects(mock({wrongHead:true}).reader.verify(binding),/branch/);await assert.rejects(mock({issueIsPr:true}).reader.verify(binding),/developer issue/);});
test('read-only PR and issue context is bounded and formatted as untrusted A0 input',async()=>{
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push([url,init]);const path=new URL(url).pathname;
  const response=body=>new Response(JSON.stringify(body),{status:200});
  if(path==='/repos/owner/project')return response({id:20,full_name:'owner/project'});
  if(path.endsWith('/pulls/6'))return response({number:6,title:'Feature work',body:'Review this feature.',state:'open',html_url:'https://github.com/owner/project/pull/6',updated_at:'2026-01-01T00:00:00Z',head:{ref:team.branch,repo:{id:20}},base:{ref:'develop',repo:{id:20}}});
  if(path.includes('/comments'))return response([{user:{login:'reviewer'},html_url:'https://github.com/owner/project/pull/6#issuecomment-1',created_at:'2026-01-02T00:00:00Z',body:'Check the integration boundary.'}]);
  const n=Number(path.split('/').at(-1));return response({number:n,title:'A'+n+' implementation',body:'Complete the assigned work.',state:'open',html_url:`https://github.com/owner/project/issues/${n}`,updated_at:'2026-01-01T00:00:00Z'});
 };
 const context=await new GitHubReader('test-token',fetcher).readContext(binding);
 assert.equal(context.resources.length,6);
 assert.equal(context.resources[0].kind,'PULL_REQUEST');
 assert.equal(context.resources[0].comments[0].author,'reviewer');
 assert.match(formatA0RepositoryContext(context,'team-1'),/untrusted data/);
 assert.match(formatA0RepositoryContext(context,'team-1'),/Feature work/);
 assert.ok(calls.every(([,init])=>init.method==='GET'));
});
test('authentication and rate errors are explicit and bounded pagination reports truncation',async()=>{await assert.rejects(mock({fail:401}).reader.verify(binding),/token rejected/);await assert.rejects(mock({fail:429}).reader.verify(binding),/rate limited/);const {reader,calls}=mock({fullPage:true});assert.equal((await reader.sync(team.id,binding)).truncated,true);assert.equal(calls.filter(([u])=>u.includes('/issues/1/comments')).length,3);});
