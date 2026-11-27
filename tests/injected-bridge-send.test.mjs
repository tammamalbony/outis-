import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('clears a stale draft, waits for the empty composer voice control, then sends the new setup prompt', async () => {
  const source = await readFile(new URL('../public/agentsync-bridge.js', import.meta.url), 'utf8');
  const messages = [];
  const snapshots = [];
  const listeners = [];
  let sentAt = 0;
  const location = { origin: 'https://chatgpt.com', pathname: '/', search: '', hash: '' };
  const form = { contains: element => element === sendButton };
  class TestTextArea {
    get value() { return this._value || ''; }
    getAttribute() { return null; }
    focus() {}
    dispatchEvent() {}
    closest(selector) { return selector === 'form' ? form : null; }
  }
  Object.defineProperty(TestTextArea.prototype, 'value', { set(value) { this._value = value; } });
  const composer = new TestTextArea();
  composer._value = 'Stale prompt from a previous ChatGPT attempt';
  const sendButton = {
    disabled: false,
    type: 'submit',
    innerText: '',
    textContent: '',
    get offsetWidth() { return composer._value ? 1 : 0; },
    getAttribute(name) { return name === 'aria-label' ? 'Send' : null; },
    click() {
      sentAt = Date.now();
      assert.ok(composer._value, 'send arrow is available only for a non-empty composer');
      messages.push({ hasAttribute: name => name === 'data-user-message-bubble', getAttribute: name => name === 'data-message-author-role' ? null : null, innerText: composer._value, textContent: composer._value });
      location.pathname = '/c/agentsync-smoke';
    },
  };
  const voiceButton = { get offsetWidth() { return composer._value ? 0 : 1; }, getAttribute(name) { return name === 'aria-label' ? 'Start Voice' : name === 'data-composer-voice-start' ? 'true' : null; } };
  const profileButton = { offsetWidth: 1, getAttribute(name) { return name === 'data-testid' ? 'profile-button' : null; } };
  const document = {
    readyState: 'complete',
    documentElement: {},
    querySelector(selector) { return selector.includes('prompt-textarea') || selector.startsWith('textarea') || selector.includes('contenteditable') ? composer : null; },
    querySelectorAll(selector) {
      if (selector.includes('data-message-author-role') || selector.includes('data-user-message-bubble') || selector.includes('data-dil-response')) return messages;
      if (selector === 'button') return [sendButton, voiceButton, profileButton];
      if (selector.includes('profile') || selector.includes('account')) return [profileButton];
      return [];
    },
    createElement() { throw new Error('Textarea path should not create elements.'); },
  };
  let response;
  const waits=[];
  const testSetTimeout=(callback,milliseconds,...args)=>{
    if(milliseconds===5_000){waits.push(milliseconds);return setTimeout(callback,0,...args);}
    return setTimeout(callback,milliseconds,...args);
  };
  const context = {
    document,
    location,
    chrome: { runtime: { id: 'test-extension', onMessage: { addListener(listener) { listeners.push(listener); }, removeListener(listener) { const index=listeners.indexOf(listener); if(index>=0)listeners.splice(index,1); } }, sendMessage(message, callback) { snapshots.push(message); callback?.(); } } },
    HTMLTextAreaElement: TestTextArea,
    HTMLInputElement: class {},
    InputEvent: class {},
    Event: class {},
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask,
    setTimeout: testSetTimeout,
    clearTimeout,
    Date,
    Map,
    Set,
    Promise,
    Error,
    JSON,
    RegExp,
    String,
    Boolean,
    globalThis: null,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  assert.equal(listeners.length, 1);
  assert.equal(snapshots.length, 0, 'a fresh-chat home tab is not reported as a registered conversation');

  await new Promise(resolve => listeners[0]({type:'AGENTSYNC_BRIDGE_DISABLE'}, {}, resolve));
  assert.equal(listeners.length, 0, 'old bridge listener is removed before re-injection');
  assert.equal(context.__agentsyncBridgeInstalled, false);
  vm.runInNewContext(source, context);
  assert.equal(listeners.length, 1, 'updated bridge can install into the same ChatGPT tab');
  assert.equal(snapshots.length, 0, 'reinstall does not report the temporary home route');

  let timeout;
  await new Promise((resolve, reject) => {
    const handled = listeners[0]({ type: 'AGENTSYNC_CREATE_CHAT', text: 'Set up the A1 chat.', dedupeKey: 'setup-smoke' }, {}, value => { response = value; clearTimeout(timeout); resolve(); });
    assert.equal(handled, true);
    timeout = setTimeout(() => reject(new Error('Chat setup did not return a result.')), 20_000);
  });

  assert.deepEqual(JSON.parse(JSON.stringify(response)), { submitted: true, conversationUrl: 'https://chatgpt.com/c/agentsync-smoke' });
  assert.equal(messages.length, 1);
  assert.match(messages[0].innerText, /^Set up the A1 chat\./);
  assert.doesNotMatch(messages[0].innerText, /Stale prompt/);
  assert.match(messages[0].innerText, /AgentSync delivery ID: setup-smoke/);
  assert.equal(waits.filter(wait=>wait===5_000).length, 1, 'new chat waits five seconds after clearing the old draft');
  assert.ok(Date.now()-sentAt>=10_000,'new chat URL is not returned before the configured ten-second grace period');
});

test('reads current ChatGPT user and assistant message containers', async () => {
  const source = await readFile(new URL('../public/agentsync-bridge.js', import.meta.url), 'utf8');
  const sent = [];
  const user = { hasAttribute: name => name === 'data-user-message-bubble', getAttribute: () => null, innerText: 'AgentSync setup prompt' };
  const assistant = { hasAttribute: name => name === 'data-dil-response', getAttribute: name => name === 'data-dil-message-id' ? 'response-123' : null, innerText: 'READY — waiting for the scoped AgentSync assignment.' };
  const document = {
    documentElement: {},
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('data-message-author-role') || selector.includes('data-user-message-bubble') || selector.includes('data-dil-response')) return [user, assistant];
      if (selector === 'button') return [];
      return [];
    },
  };
  const listeners = [];
  const context = {
    document,
    location: { origin: 'https://chatgpt.com', pathname: '/c/test', search: '', hash: '' },
    chrome: { runtime: { id: 'test-extension', onMessage: { addListener(listener) { listeners.push(listener); }, removeListener() {} }, sendMessage(message) { sent.push(message); } } },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout,
    clearTimeout,
    Date,
    Map,
    Set,
    Promise,
    Error,
    JSON,
    RegExp,
    String,
    Boolean,
    globalThis: null,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].snapshot.latestRole, 'assistant');
  assert.equal(sent[0].snapshot.latestMessageId, 'response-123');
  assert.equal(sent[0].snapshot.latestMessage, 'READY — waiting for the scoped AgentSync assignment.');
  assert.equal(sent[0].snapshot.state, 'UNKNOWN', 'missing composer is not reported as idle');
});

test('recognizes the visible Start Voice button without ChatGPT private markers', async () => {
  const source = await readFile(new URL('../public/agentsync-bridge.js', import.meta.url), 'utf8');
  const sent = [];
  const timers = [];
  let fakeNow = 10_000;
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fakeNow])); }
    static now() { return fakeNow; }
  }
  const composer = { value:'', disabled:false, getAttribute(){return null;}, getClientRects(){return [{}];} };
  const assistant = { hasAttribute:name=>name==='data-dil-response', getAttribute:name=>name==='data-dil-message-id'?'setup-reply-1':null, innerText:'READY — waiting for the scoped AgentSync assignment.' };
  const voice = { get offsetWidth(){return 1;}, getAttribute:name=>name==='aria-label'?'Start Voice':null };
  const document = {
    readyState:'complete', documentElement:{},
    querySelector(selector){return selector.includes('prompt-textarea')||selector.startsWith('textarea')||selector.includes('contenteditable')?composer:null;},
    querySelectorAll(selector){
      if(selector.includes('data-message-author-role')||selector.includes('data-user-message-bubble')||selector.includes('data-dil-response'))return [assistant];
      if(selector==='button')return [voice];
      return [];
    },
  };
  const listeners=[];
  const context={
    document,location:{origin:'https://chatgpt.com',pathname:'/c/setup-test',search:'',hash:''},
    chrome:{runtime:{id:'test-extension',onMessage:{addListener(listener){listeners.push(listener);},removeListener(){}},sendMessage(message){sent.push(message);}}},
    HTMLTextAreaElement:class {},HTMLInputElement:class {},MutationObserver:class{observe(){}disconnect(){}},
    setTimeout(callback,milliseconds){timers.push({callback,milliseconds});return timers.length;},clearTimeout(){},Date:TestDate,Map,Set,Promise,Error,JSON,RegExp,String,Boolean,globalThis:null,
  };
  context.globalThis=context;
  vm.runInNewContext(source,context);
  assert.equal(sent[0].snapshot.state,'UNKNOWN','assistant text must remain stable before reporting idle');
  const settle=timers.find(timer=>timer.milliseconds===1_500);
  assert.ok(settle,'bridge schedules a stability check for the finished reply');
  fakeNow+=1_500;
  settle.callback();
  assert.equal(sent.at(-1).snapshot.latestRole,'assistant');
  assert.equal(sent.at(-1).snapshot.state,'IDLE','accessible Start Voice control is enough to confirm the empty composer is ready');
});

test('recognizes the current ChatGPT voice SVG even when its button label differs', async () => {
  const source = await readFile(new URL('../public/agentsync-bridge.js', import.meta.url), 'utf8');
  const sent = [];
  const timers = [];
  let fakeNow = 20_000;
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fakeNow])); }
    static now() { return fakeNow; }
  }
  const composer = { value:'', disabled:false, getAttribute(){return null;}, getClientRects(){return [{}];} };
  const assistant = { hasAttribute:name=>name==='data-dil-response', getAttribute:name=>name==='data-dil-message-id'?'setup-reply-voice-svg':null, innerText:'READY — waiting for the scoped AgentSync assignment.' };
  const voiceButton = { get offsetWidth(){return 1;}, getAttribute:name=>name==='aria-label'?'Voice input':null, getClientRects(){return [{}];} };
  const voiceUse = {
    getAttribute:name=>name==='href'?'/cdn/assets/icons-fb01fecc45cedc8e.svg#codex-icon-voice-regular-20':null,
    getAttributeNS(){return null;},
    closest:selector=>selector==='button'?voiceButton:null,
  };
  const document = {
    readyState:'complete', documentElement:{},
    querySelector(selector){return selector.includes('prompt-textarea')||selector.startsWith('textarea')||selector.includes('contenteditable')?composer:null;},
    querySelectorAll(selector){
      if(selector.includes('data-message-author-role')||selector.includes('data-user-message-bubble')||selector.includes('data-dil-response'))return [assistant];
      if(selector==='button')return [voiceButton];
      if(selector==='button svg use')return [voiceUse];
      return [];
    },
  };
  const listeners=[];
  const context={
    document,location:{origin:'https://chatgpt.com',pathname:'/c/setup-test',search:'',hash:''},
    chrome:{runtime:{id:'test-extension',onMessage:{addListener(listener){listeners.push(listener);},removeListener(){}},sendMessage(message){sent.push(message);}}},
    HTMLTextAreaElement:class {},HTMLInputElement:class {},MutationObserver:class{observe(){}disconnect(){}},
    setTimeout(callback,milliseconds){timers.push({callback,milliseconds});return timers.length;},clearTimeout(){},Date:TestDate,Map,Set,Promise,Error,JSON,RegExp,String,Boolean,globalThis:null,
  };
  context.globalThis=context;
  vm.runInNewContext(source,context);
  assert.equal(sent[0].snapshot.state,'UNKNOWN','the response must remain stable before it is marked idle');
  const settle=timers.find(timer=>timer.milliseconds===1_500);
  assert.ok(settle,'the bridge schedules its reply stability check when the SVG voice control is visible');
  fakeNow+=1_500;
  settle.callback();
  assert.equal(sent.at(-1).snapshot.latestRole,'assistant');
  assert.equal(sent.at(-1).snapshot.latestMessage,'READY — waiting for the scoped AgentSync assignment.');
  assert.equal(sent.at(-1).snapshot.state,'IDLE','the current ChatGPT voice SVG confirms the finished composer even when its label is not Start Voice');
});

test('confirms a send from the stop-square SVG before the user bubble or composer update', async () => {
  const source = await readFile(new URL('../public/agentsync-bridge.js', import.meta.url), 'utf8');
  const listeners = [];
  const snapshots = [];
  const messages = [];
  const location = { origin:'https://chatgpt.com', pathname:'/c/stop-square-test', search:'', hash:'' };
  const form = { contains:element=>element===sendButton };
  const userMessage = { hasAttribute:name=>name==='data-user-message-bubble', getAttribute:()=>null, innerText:'AgentSync chat setup' };
  const assistantMessage = { hasAttribute:name=>name==='data-dil-response', getAttribute:()=>null, innerText:'READY — waiting for the scoped AgentSync assignment.' };
  class TestTextArea {
    constructor(){this._value='';this.disabled=false;}
    get value(){return this._value;}
    set value(value){this._value=value;}
    getAttribute(){return null;}
    getClientRects(){return [{}];}
    focus(){}
    dispatchEvent(){}
    closest(selector){return selector==='form'?form:null;}
  }
  const composer = new TestTextArea();
  const stopPath = { getAttribute:name=>name==='d'?'M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z':null };
  const stopButton = {
    get offsetWidth(){return 1;},
    getAttribute(){return null;},
    querySelectorAll(selector){return selector==='svg path'?[stopPath]:[];},
  };
  const voiceButton = { get offsetWidth(){return composer.value?0:1;}, getAttribute:name=>name==='aria-label'?'Start Voice':null };
  let buttons = [];
  const sendButton = {
    type:'submit', disabled:false, innerText:'', textContent:'',
    get offsetWidth(){return composer.value?1:0;},
    getAttribute:name=>name==='aria-label'?'Send':null,
    click(){
      assert.ok(composer.value.includes('AgentSync delivery ID: stop-square-order'));
      buttons=[sendButton,voiceButton,stopButton];
    },
  };
  messages.push(userMessage,assistantMessage);
  buttons=[sendButton,voiceButton];
  const document = {
    readyState:'complete', documentElement:{},
    querySelector(selector){return selector.includes('prompt-textarea')||selector.startsWith('textarea')||selector.includes('contenteditable')?composer:null;},
    querySelectorAll(selector){
      if(selector.includes('data-message-author-role')||selector.includes('data-user-message-bubble')||selector.includes('data-dil-response'))return messages;
      if(selector==='button')return buttons;
      if(selector.includes('profile')||selector.includes('account'))return [];
      return [];
    },
  };
  const context={
    document,location,
    chrome:{runtime:{id:'test-extension',onMessage:{addListener(listener){listeners.push(listener);},removeListener(){}},sendMessage(message){snapshots.push(message);}}},
    HTMLTextAreaElement:TestTextArea,HTMLInputElement:class{},InputEvent:class{},Event:class{},
    MutationObserver:class{observe(){}disconnect(){}},queueMicrotask,setTimeout,clearTimeout,Date,Map,Set,Promise,Error,JSON,RegExp,String,Boolean,globalThis:null,
  };
  context.globalThis=context;
  vm.runInNewContext(source,context);
  let result;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Stop-square submission was not confirmed.')),3_000);
    listeners[0]({
      type:'AGENTSYNC_SEND_ORDER', conversationUrl:'https://chatgpt.com/c/stop-square-test',
      dedupeKey:'stop-square-order', text:`${'x'.repeat(40_000)}\n\nAgentSync delivery ID: stop-square-order`,
      timings:{sessionStableMs:1_600,composerTextTimeoutMs:100,sendControlTimeoutMs:100,submissionTimeoutMs:100,pollIntervalMs:1},
    },{},value=>{result=value;clearTimeout(timeout);resolve();});
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{submitted:true});
  assert.equal(messages.length,2,'the new user bubble may appear after generation starts; the existing setup messages stay intact');
  assert.ok(snapshots.some(item=>item.type==='AGENTSYNC_CHAT_SNAPSHOT'&&item.snapshot.state==='GENERATING'));
});

test('bridge ping forces a fresh snapshot and acknowledges background receipt', async () => {
  const source = await readFile(new URL('../public/agentsync-bridge.js', import.meta.url), 'utf8');
  const listeners=[],sent=[];
  const document={readyState:'complete',documentElement:{},querySelector(){return null;},querySelectorAll(){return [];}};
  const context={
    document,location:{origin:'https://chatgpt.com',pathname:'/c/bridge-ping-test',search:'',hash:''},
    chrome:{runtime:{id:'test-extension',onMessage:{addListener(listener){listeners.push(listener);},removeListener(){}},sendMessage(message,callback){sent.push(message);callback?.({received:true});}}},
    MutationObserver:class{observe(){}disconnect(){}},setTimeout,clearTimeout,Date,Map,Set,Promise,Error,JSON,RegExp,String,Boolean,globalThis:null,
  };
  context.globalThis=context;
  vm.runInNewContext(source,context);
  assert.equal(sent.length,1,'bridge sends an initial snapshot when installed');
  context.location.pathname='/';
  const transitionResponse=await new Promise(resolve=>listeners[0]({type:'AGENTSYNC_BRIDGE_PING'},{},resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(transitionResponse)),{ready:true},'a temporary home route does not fail bridge refresh');
  assert.equal(sent.length,1,'a non-conversation route is not sent as a chat snapshot');
  context.location.pathname='/c/bridge-ping-test';
  const response=await new Promise(resolve=>listeners[0]({type:'AGENTSYNC_BRIDGE_PING'},{},resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(response)),{ready:true});
  assert.equal(sent.length,2,'ping bypasses snapshot deduplication so registration receives current page state');
});
