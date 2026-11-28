import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('sends a forced status snapshot every five seconds and clears the timer when disabled',async()=>{
  const source=await readFile(new URL('../public/agentsync-bridge.js',import.meta.url),'utf8');
  const sent=[],listeners=[],intervals=new Map(),cleared=[];
  let nextInterval=0;
  const context={
    document:{documentElement:{},addEventListener(){},querySelector(){return null;},querySelectorAll(){return []; }},
    location:{origin:'https://chatgpt.com',pathname:'/c/poll-test',search:'',hash:''},
    chrome:{runtime:{id:'test-extension',onMessage:{addListener(listener){listeners.push(listener);},removeListener(listener){const i=listeners.indexOf(listener);if(i>=0)listeners.splice(i,1);}},sendMessage(message){sent.push(message);}}},
    MutationObserver:class{observe(){}disconnect(){}},
    setInterval(callback,delay){const id=++nextInterval;intervals.set(id,{callback,delay});return id;},
    clearInterval(id){cleared.push(id);intervals.delete(id);},
    setTimeout,clearTimeout,Date,Map,Set,Promise,Error,JSON,RegExp,String,Boolean,globalThis:null,
  };
  context.globalThis=context;
  vm.runInNewContext(source,context);
  assert.equal(sent.length,1,'the bridge reports state immediately on startup');
  assert.equal(intervals.size,1);
  const [id,timer]=[...intervals.entries()][0];
  assert.equal(timer.delay,5_000);
  timer.callback();
  assert.equal(sent.length,2,'the interval sends a fresh snapshot even when the state is unchanged');
  await new Promise(resolve=>listeners[0]({type:'AGENTSYNC_BRIDGE_DISABLE'}, {}, resolve));
  assert.deepEqual(cleared,[id]);
  assert.equal(intervals.size,0);
});
