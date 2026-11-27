import test from 'node:test';
import assert from 'node:assert/strict';
import {executionPhase,assertHandoffAvailable,stoppedExecution} from '../src/execution.ts';
const team={id:'team',batchId:'batch'};
const batch={id:'batch',paused:false};
const agent={id:'agent',teamId:'team',state:'READY',chatUrl:'https://chatgpt.com/c/abc'};
const order={id:'order',teamId:'team',agentId:'agent',state:'PENDING'};
const time='2026-11-24T00:00:00Z';
test('queued and uncertain handoffs retain pending state',()=>{
  assert.equal(executionPhase(order),'QUEUED');
  assert.equal(executionPhase({...order,handoffAt:time}),'HANDOFF_UNCERTAIN');
  assert.equal(executionPhase({...order,state:'CANCELLED',handoffAt:time}),'CANCELLED');
});
test('handoff cannot be repeated or prepared for a paused or unrelated batch',()=>{
  assert.doesNotThrow(()=>assertHandoffAvailable(order,agent,team,batch));
  assert.throws(()=>assertHandoffAvailable({...order,handoffAt:time},agent,team,batch),/already prepared/);
  assert.throws(()=>assertHandoffAvailable(order,agent,team,{...batch,paused:true}),/paused/);
  assert.throws(()=>assertHandoffAvailable(order,agent,team,{...batch,id:'other'}),/mismatch/);
  assert.throws(()=>assertHandoffAvailable(order,{...agent,id:'other'},team,batch),/identity/);
  assert.throws(()=>assertHandoffAvailable({...order,state:'CONFIRMED'},agent,team,batch),/pending/);
});
test('confirmed legacy records do not imply a stopped execution',()=>{
  const o={...order,state:'CONFIRMED'};
  assert.equal(executionPhase(o),'CONFIRMED_LEGACY');
  assert.equal(executionPhase(o,{...agent,lastOrderId:order.id,state:'WORKING'}),'RUNNING_REPORTED');
  assert.equal(executionPhase(o,{...agent,lastOrderId:'other',state:'WORKING'}),'CONFIRMED_LEGACY');
  assert.equal(executionPhase({...o,stoppedAt:time}),'STOPPED_REPORTED');
});
test('stop records are tied to the exact confirmed execution',()=>{
  const o={...order,state:'CONFIRMED'},a={...agent,lastOrderId:order.id,state:'WORKING'};
  assert.equal(stoppedExecution(o,a),true);
  for(const x of [undefined,order,{...o,id:'other'},{...o,agentId:'other'},{...o,teamId:'other'},{...o,stoppedAt:time}])assert.equal(stoppedExecution(x,a),false);
});
