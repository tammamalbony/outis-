import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlan,parseSupervisorPlan,assertPlanApproval,assertTeamDispatch,completionBlockers,batchCompletion,readyAssignments,awaitingSetupReply} from '../src/team-lifecycle.ts';
const team={id:'t',batchId:'b'};
const plan=Array.from({length:5},(_,i)=>({agent:i+1,scope:'Scope '+(i+1),requires:i===0?[]:[1]}));
const agents=Array.from({length:6},(_,i)=>({id:'a'+i,teamId:'t',number:i,chatUrl:'https://chatgpt.com/c/'+i,state:i===0?'STOPPED':'READY',lastOrderId:i===0?'review':undefined}));
const pending={teamId:'t',agentId:'a0',state:'PENDING'};
test('plan normalizes five unique assignments and rejects invalid or cyclic prerequisites',()=>{
 assert.deepEqual(parsePlan(JSON.stringify([...plan].reverse())),plan);
 for(const p of [plan.slice(1),[plan[0],...plan.slice(0,4)],plan.map(a=>a.agent===1?{...a,requires:[2]}:a),plan.map(a=>a.agent===1?{...a,requires:[1]}:a)])assert.throws(()=>parsePlan(JSON.stringify(p)));
});
test('A0 planning requires one complete JSON array plan entry',()=>{
 const packet={type:'AGENTSYNC_PLAN',teamId:'t',preflight:'CLEAR',blockers:[],plan};
 assert.deepEqual(parseSupervisorPlan(JSON.stringify([packet])),{...packet,plan});
 const slashes='\\'.repeat(3),pretty=JSON.stringify([packet],null,2),dirty=pretty.split('\n').map((line,index)=>index?`${slashes}\n&#x20; ${line}`:line).join('');
 assert.deepEqual(parseSupervisorPlan(dirty),{...packet,plan});
 assert.throws(()=>parseSupervisorPlan(JSON.stringify(packet)),/JSON array/);
 assert.throws(()=>parseSupervisorPlan('```agentsync-plan\n'+JSON.stringify(packet)+'\n```'),/valid JSON/);
});
test('plan approval requires stopped supervisor execution without pending work',()=>{
 assert.doesNotThrow(()=>assertPlanApproval(team,agents,[]));
 assert.throws(()=>assertPlanApproval(team,agents,[pending]));
 assert.throws(()=>assertPlanApproval({...team,plan},agents,[]));
 assert.throws(()=>assertPlanApproval(team,agents.map(a=>a.number===0?{...a,lastOrderId:undefined}:a),[]));
});
test('developer dispatch waits for approved plan and accepted same-team prerequisites',()=>{
 assert.doesNotThrow(()=>assertTeamDispatch(team,agents[0],agents));
 assert.throws(()=>assertTeamDispatch(team,agents[1],agents));
 assert.doesNotThrow(()=>assertTeamDispatch({...team,plan},agents[1],agents));
 assert.throws(()=>assertTeamDispatch({...team,plan},agents[2],agents));
 const accepted={...agents[1],state:'COMPLETED'};
 assert.throws(()=>assertTeamDispatch({...team,plan},agents[2],[{...accepted,teamId:'other'}]));
 assert.doesNotThrow(()=>assertTeamDispatch({...team,plan},agents[2],[accepted]));
 assert.throws(()=>assertTeamDispatch({...team,plan,finalizedAt:'now'},agents[0],agents));
});
test('autowork exposes only registered ready assignments whose prerequisites are accepted',()=>{
 const readyPlan=[{agent:1,scope:'first',requires:[]},{agent:2,scope:'second',requires:[1]},{agent:3,scope:'third',requires:[]},{agent:4,scope:'fourth',requires:[1]},{agent:5,scope:'fifth',requires:[]}];
 const approved={...team,plan:readyPlan};
 assert.deepEqual(readyAssignments(approved,agents,[]).map(item=>item.agent),[1,3,5]);
 const accepted=agents.map(agent=>agent.number===1?{...agent,state:'COMPLETED'}:agent);
 assert.deepEqual(readyAssignments(approved,accepted,[]).map(item=>item.agent),[2,3,4,5]);
 assert.deepEqual(readyAssignments(approved,accepted,[{...pending,agentId:'a2'}]).map(item=>item.agent),[3,4,5]);
 assert.deepEqual(readyAssignments(team,agents,[]),[]);
 assert.deepEqual(readyAssignments({...approved,finalizedAt:'now'},agents,[]),[]);
});
test('retrying autowork still waits for previously registered chats with no completed setup or assignment',()=>{
 assert.equal(awaitingSetupReply(agents[1]),true);
 assert.equal(awaitingSetupReply({...agents[1],lastOrderId:'order-1'}),false);
 assert.equal(awaitingSetupReply({...agents[1],state:'WORKING'}),false);
 assert.equal(awaitingSetupReply({...agents[1],chatUrl:undefined}),false);
});
test('local completion requires all five accepted, supervisor stopped, no pending work or notifications',()=>{
 const accepted=agents.map(a=>a.number===0?a:{...a,state:'COMPLETED'});
 assert.deepEqual(completionBlockers({...team,plan},accepted,[],0),[]);
 assert.equal(completionBlockers({...team,plan},accepted,[pending],1).length,2);
 assert.ok(completionBlockers(team,agents,[],0).length>=2);
 assert.ok(completionBlockers({...team,plan},accepted.slice(0,5),[],0).length);
});
test('batch completion counts finalized teams only and isolates batches',()=>{
 assert.deepEqual(batchCompletion([team,{...team,id:'t2',finalizedAt:'now'},{...team,batchId:'other',finalizedAt:'now'}],'b'),{completed:1,total:2,done:false});
 assert.equal(batchCompletion([{...team,finalizedAt:'now'}],'b').done,true);
 assert.equal(batchCompletion([],'b').done,false);
});
