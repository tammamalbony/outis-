import {useEffect,useRef,useState} from 'react';
import {browser} from 'wxt/browser';
import type {Agent} from '../../src/core';
import {chatAdapter} from '../../src/chat-adapter';

type Probe={href:string;hasConversationUrl:boolean;conversationUrl:string;pageLoaded:boolean;composerVisible:boolean;composerText:string;composerTextTruncated:boolean;composerMode:'CHAT'|'WORK'|'UNKNOWN';effort:'LOW'|'MEDIUM'|'HIGH'|'UNKNOWN';composerEmpty:boolean;composerLength:number;voiceVisible:boolean;voiceEnabled:boolean;arrowVisible:boolean;arrowEnabled:boolean;stopVisible:boolean;stopEnabled:boolean;pauseVisible:boolean;pauseEnabled:boolean;userMessageCount:number;latestReplyFirstLine:string;latestReplyCopyStatus:'NOT_COPIED'|'COPY_CLICKED'|'COPIED';state:'LOADING'|'NEW'|'IDLE'|'WORKING'|'PROMPT_READY'|'SUBMITTED'|'WAITING';observedAt:string};
type Milestone='voice'|'arrow'|'submitted'|'stop'|'voice-again';
type TestRunPhase='IDLE'|'RUNNING'|'PASSED'|'FAILED'|'STOPPED';
type TestRunResult={status:'waiting'|'running'|'passed'|'stopped'|'failed';detail:string};
type TestRunContext={tabId:number;promptKey?:string;prompt?:string;userMessageCount?:number};
const stages:Milestone[]=['voice','arrow','submitted','stop','voice-again'];
const names:Record<Milestone,string>={voice:'Voice ready',arrow:'Arrow ready',submitted:'Prompt submitted',stop:'Generating', 'voice-again':'Voice returned'};
const testRunSteps=['Open a fresh test chat','Clear any old draft','Confirm Chat mode','Set High effort','Wait for voice ready','Prepare demo prompt','Submit the prompt','Receive the expected reply','Delete the test chat'];
const explanations:Record<Probe['state'],string>={
  LOADING:'The ChatGPT document is still loading. The wizard is waiting for its composer controls.',
  NEW:'The URL is chatgpt.com with no /c/ conversation, and the empty composer has an enabled voice button. This is a ready new chat.',
  IDLE:'The URL contains a /c/ conversation, and the empty composer has an enabled voice button. This is a ready idle chat.',
  WORKING:'The stop control is enabled. ChatGPT is generating a response.',
  PROMPT_READY:'The composer contains text and its enabled arrow is visible. The prompt is ready to submit, even if another status icon is present.',
  SUBMITTED:'A new user message appeared and the composer cleared. ChatGPT accepted the prompt.',
  WAITING:'The page has not reached a recognized ready state. Check the composer and wait for its action button to become enabled.'
};
export default function ChatGPTTestWizard({savedAgents=[],embedded=false}:{savedAgents?:Agent[];embedded?:boolean}){
  const [tabId,setTabId]=useState<number>(),[probe,setProbe]=useState<Probe>(),[error,setError]=useState(''),[sequence,setSequence]=useState<{stage:Milestone;at:string}[]>([]),[baseline,setBaseline]=useState<number>(),[busy,setBusy]=useState(false),[controlBusy,setControlBusy]=useState(false),[effortDraft,setEffortDraft]=useState(1),[chatActionStatus,setChatActionStatus]=useState(''),[testRunPhase,setTestRunPhase]=useState<TestRunPhase>('IDLE'),[testRunStep,setTestRunStep]=useState(-1),[testRunMessage,setTestRunMessage]=useState(''),[testRunResults,setTestRunResults]=useState<TestRunResult[]>(()=>testRunSteps.map(()=>({status:'waiting',detail:'Not started'})));
  const nextStage=useRef(0);
  const effortTouched=useRef(false);
  const previousTestComposerText=useRef(false);
  const previousTestUserCount=useRef(0);
  const testSubmittedUntil=useRef(0);
  const pollError=useRef(false);
  const testRunActive=useRef(false);
  const testStopRequested=useRef(false);
  const testStopDetail=useRef('');
  const testCheckpoint=useRef(0);
  const testContext=useRef<TestRunContext|undefined>(undefined);
  useEffect(()=>{
    let cancelled=false;
    void browser.permissions.contains({origins:['https://chatgpt.com/*']}).then(async granted=>{
      if(!granted||cancelled)return;
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});
      if(!cancelled&&tab?.id!==undefined&&tab.url?.startsWith('https://chatgpt.com/'))void watchTab(tab.id);
    }).catch(()=>{});
    return()=>{cancelled=true;};
  },[]);
  async function watchTab(id:number){
    setBusy(true);setError('');setTabId(undefined);setProbe(undefined);setSequence([]);setBaseline(undefined);nextStage.current=0;previousTestComposerText.current=false;previousTestUserCount.current=0;testSubmittedUntil.current=0;effortTouched.current=false;
    try{
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access was not granted.');
      const tab=await browser.tabs.get(id);
      if(!tab.url?.startsWith('https://chatgpt.com/'))throw new Error('Choose a ChatGPT tab at chatgpt.com.');
      setTabId(id);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  async function openNew(){
    setBusy(true);setError('');setProbe(undefined);setSequence([]);setBaseline(undefined);nextStage.current=0;previousTestComposerText.current=false;previousTestUserCount.current=0;testSubmittedUntil.current=0;effortTouched.current=false;
    try{
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access was not granted.');
      const tab=await browser.tabs.create({url:'https://chatgpt.com/',active:true});
      if(tab.id===undefined)throw new Error('Chrome did not return the new ChatGPT tab.');
      setTabId(tab.id);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  async function waitForTestSnapshot(id:number,predicate:(value:Probe)=>boolean,timeoutMs:number,cancellable=false){
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      if(cancellable&&testStopRequested.current)throw new Error('Stop requested.');
      const tab=await browser.tabs.get(id);
      const url=tab.url||'';
      if(!url||url==='about:blank'||url.startsWith('chrome://newtab')){
        await new Promise(resolve=>window.setTimeout(resolve,500));
        continue;
      }
      if(!url.startsWith('https://chatgpt.com/'))throw new Error(`The test tab left chatgpt.com (current URL: ${url}).`);
      if(tab.status==='complete'){
        try{
          await browser.scripting.executeScript({target:{tabId:id},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
          const value=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
          if(value){setProbe(value);if(predicate(value))return value;}
        }catch{/* The content bridge may not be ready until the next poll. */}
      }
      await new Promise(resolve=>window.setTimeout(resolve,500));
    }
    throw new Error('Timed out while waiting for ChatGPT to reach the expected test state. The test chat was kept for inspection.');
  }
  function beginTestStep(index:number,message:string){
    if(testStopRequested.current)throw new Error('Stop requested.');
    testCheckpoint.current=index;setTestRunStep(index);setTestRunMessage(message);
    setTestRunResults(old=>old.map((item,i)=>i===index?{status:'running',detail:message}:item));
  }
  function passTestStep(index:number,detail:string){
    setTestRunResults(old=>old.map((item,i)=>i===index?{status:'passed',detail}:item));
    testCheckpoint.current=index+1;
  }
  function markTestMilestone(stage:Milestone){
    const index=stages.indexOf(stage);
    setSequence(old=>{
      const next=[...old];
      while(next.length<=index)next.push({stage:stages[next.length],at:new Date().toLocaleTimeString()});
      return next;
    });
    nextStage.current=Math.max(nextStage.current,index+1);
  }
  async function runOneClickTest(action:'START'|'RESUME'|'RESTART'='START'){
    if(testRunActive.current)return;
    if(action==='RESUME'&&!testContext.current){setError('This run has no saved test tab to resume. Choose Restart test.');return;}
    const restarting=action!=='RESUME';
    const previousTestKept=action==='RESTART'&&Boolean(testContext.current);
    if(restarting){testContext.current=undefined;testCheckpoint.current=0;setTestRunResults(testRunSteps.map(()=>({status:'waiting',detail:'Not started'})));setSequence([]);nextStage.current=0;previousTestComposerText.current=false;previousTestUserCount.current=0;testSubmittedUntil.current=0;setBaseline(0);}
    testStopRequested.current=false;testStopDetail.current='';testRunActive.current=true;setTestRunPhase('RUNNING');setControlBusy(true);setError('');setChatActionStatus('');effortTouched.current=false;
    const context=testContext.current;
    if(!context)setTabId(undefined);else setTabId(context.tabId);
    try{
      if(restarting&&action==='RESTART')setTestRunMessage('Restarting in a new temporary chat. Any previous failed test chat remains open for inspection.');
      let ctx=testContext.current;
      if(!ctx){
        beginTestStep(0,previousTestKept?'Opening a new temporary chat; the previous incomplete chat remains open for inspection…':'Opening a fresh temporary ChatGPT tab…');
        if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access was not granted, so no test tab was opened.');
        const tab=await browser.tabs.create({url:'https://chatgpt.com/',active:true});
        if(tab.id===undefined)throw new Error('Chrome did not return a tab ID. The test stopped before it could inspect ChatGPT.');
        ctx={tabId:tab.id};testContext.current=ctx;setTabId(tab.id);
        passTestStep(0,`Opened test tab ${tab.id} at chatgpt.com.${previousTestKept?' The previous incomplete test chat was kept open.':''}`);
      }
      const id=ctx.tabId;
      if(testCheckpoint.current<=1){
        beginTestStep(1,'Waiting for the composer, then clearing any old draft…');
        const initial=await waitForTestSnapshot(id,value=>value.pageLoaded&&value.composerVisible,45_000,true);
        if(!initial.composerEmpty){
          const cleared=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_CLEAR_COMPOSER'}) as {confirmed?:boolean;error?:string}|undefined;
          if(cleared?.error||cleared?.confirmed!==true)throw new Error(cleared?.error||'ChatGPT did not confirm the old draft was cleared.');
          passTestStep(1,'Cleared the old composer draft; it was not submitted.');
        }else passTestStep(1,'Composer was already empty; nothing was cleared.');
      }
      if(testCheckpoint.current<=2){
        beginTestStep(2,'Selecting and confirming Chat mode…');
        const mode=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_ENSURE_CHAT_MODE'}) as {confirmed?:boolean;error?:string}|undefined;
        if(mode?.error||mode?.confirmed!==true)throw new Error(mode?.error||'ChatGPT did not confirm Chat mode.');
        passTestStep(2,'Chat mode confirmed.');
      }
      if(testCheckpoint.current<=3){
        beginTestStep(3,'Selecting and confirming High effort…');
        const effort=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_SET_EFFORT',effort:'HIGH'}) as {confirmed?:boolean;error?:string}|undefined;
        if(effort?.error||effort?.confirmed!==true)throw new Error(effort?.error||'ChatGPT did not confirm High effort.');
        passTestStep(3,'High effort confirmed.');
      }
      if(testCheckpoint.current<=4){
        beginTestStep(4,'Waiting for an empty composer, enabled voice button, Chat mode, and High effort…');
        const ready=await waitForTestSnapshot(id,value=>value.state==='NEW'&&value.composerEmpty&&value.voiceVisible&&value.voiceEnabled&&value.composerMode==='CHAT'&&value.effort==='HIGH',30_000,true);
        ctx.userMessageCount=ready.userMessageCount;setBaseline(ready.userMessageCount);previousTestUserCount.current=ready.userMessageCount;
        markTestMilestone('voice');
        passTestStep(4,`Ready: new-chat URL, empty composer, voice enabled, Chat selected, High effort selected (${ready.userMessageCount} existing user messages).`);
      }
      if(testCheckpoint.current<=5){
        beginTestStep(5,'Preparing the labeled test prompt and checking the enabled arrow…');
        if(!ctx.promptKey){ctx.promptKey=`test_${crypto.randomUUID()}`;ctx.prompt=`AgentSync one-click test: please reply with exactly “AgentSync test received.”\n\nAgentSync delivery ID: ${ctx.promptKey}`;}
        let current=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
        if(!current)throw new Error('ChatGPT did not return a composer snapshot; the prompt was not staged.');
        if(!current.composerEmpty&&!current.composerText.includes(ctx.promptKey)){
          const cleared=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_CLEAR_COMPOSER'}) as {confirmed?:boolean;error?:string}|undefined;
          if(cleared?.error||cleared?.confirmed!==true)throw new Error(cleared?.error||'An unrelated draft remained in the test composer; it was not replaced.');
        }
        if(!current.composerText.includes(ctx.promptKey)){
          const drafted=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SET_COMPOSER_TEXT',text:ctx.prompt}) as {confirmed?:boolean;error?:string}|undefined;
          if(drafted?.error||drafted?.confirmed!==true)throw new Error(drafted?.error||'ChatGPT did not confirm the labeled test prompt in the composer.');
        }
        const arrow=await waitForTestSnapshot(id,value=>value.state==='PROMPT_READY'&&value.arrowVisible&&value.arrowEnabled&&value.composerText.includes(ctx!.promptKey!),15_000,true);
        markTestMilestone('arrow');previousTestComposerText.current=true;previousTestUserCount.current=arrow.userMessageCount;
        passTestStep(5,`Prompt is visible in the composer (${arrow.composerLength} characters); the arrow is visible and enabled.`);
      }
      if(testCheckpoint.current<=6){
        beginTestStep(6,'Submitting the labeled test prompt once…');
        const before=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
        if(!before)throw new Error('Could not confirm the prompt state before submission.');
        if(before.composerEmpty&&ctx.userMessageCount!==undefined&&before.userMessageCount>ctx.userMessageCount){
          passTestStep(6,'Prompt was already accepted before resume; it was not sent again.');
        }else{
          const submitted=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SEND_DEMO',dedupeKey:ctx.promptKey,text:ctx.prompt}) as {submitted?:boolean;duplicate?:boolean;error?:string}|undefined;
          if(submitted?.error||submitted?.submitted!==true)throw new Error(submitted?.error||'ChatGPT did not confirm prompt submission. The test chat was kept for inspection.');
          markTestMilestone('submitted');
          passTestStep(6,submitted.duplicate?'Submission was already recorded for this delivery ID; no duplicate prompt was sent.':'ChatGPT confirmed the test prompt was submitted.');
        }
      }
      if(testCheckpoint.current<=7){
        beginTestStep(7,'Waiting for generation, the expected reply, and the return to idle…');
        let reply=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
        if(!reply)throw new Error('Could not inspect the test chat after submission.');
        if(!(reply.state==='IDLE'&&reply.composerEmpty&&reply.voiceEnabled&&reply.latestReplyFirstLine.toLowerCase().includes('agentsync test received'))){
          const working=await waitForTestSnapshot(id,value=>value.state==='WORKING',30_000,true);
          markTestMilestone('stop');
          reply=await waitForTestSnapshot(id,value=>value.state==='IDLE'&&value.composerEmpty&&value.voiceEnabled&&value.latestReplyFirstLine.toLowerCase().includes('agentsync test received'),120_000,true);
          if(working.state!=='WORKING')throw new Error('ChatGPT did not expose its working state after submission.');
        }
        markTestMilestone('voice-again');
        passTestStep(7,`Reply verified; ChatGPT returned to idle with voice enabled. First line: “${reply.latestReplyFirstLine}”`);
      }
      if(testCheckpoint.current<=8){
        beginTestStep(8,'Verifying the expected reply again before deleting the temporary test chat…');
        const final=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
        if(!final||final.state!=='IDLE'||!final.latestReplyFirstLine.toLowerCase().includes('agentsync test received'))throw new Error('Deletion was withheld: the expected reply is not currently visible in an idle test chat.');
        if(testStopRequested.current)throw new Error('Stop requested before deletion; the test chat was kept for inspection.');
        const deleted=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_DELETE_CHAT',confirmDelete:true}) as {performed?:boolean;conversationChanged?:boolean;notice?:string;error?:string}|undefined;
        if(deleted?.error||deleted?.performed!==true||deleted.conversationChanged!==true)throw new Error(deleted?.error||'Reply passed, but ChatGPT did not confirm deletion. The test chat was kept for inspection.');
        passTestStep(8,'Expected reply rechecked; ChatGPT confirmed the temporary test chat was deleted.');
      }
      setTestRunPhase('PASSED');setTestRunStep(testRunSteps.length);setTestRunMessage('All checks passed. The expected reply was confirmed and the temporary test chat was deleted.');
      setChatActionStatus('Test passed. Expected reply received; temporary chat deleted.');testContext.current=undefined;
    }catch(e){
      const reason=e instanceof Error?e.message:String(e);
      if(testStopRequested.current){
        const detail=`Stopped at “${testRunSteps[testCheckpoint.current]??'test cleanup'}” by request. ${testStopDetail.current}${reason==='Stop requested.'?' No later test steps were run.':` ${reason}`}`;
        setTestRunPhase('STOPPED');setTestRunMessage(detail);setTestRunResults(old=>old.map((item,i)=>i===testCheckpoint.current?{status:'stopped',detail}:item));
      }else{
        const detail=`Stopped at “${testRunSteps[testCheckpoint.current]??'test cleanup'}”: ${reason}`;
        setTestRunPhase('FAILED');setTestRunMessage(detail);setError(detail);setTestRunResults(old=>old.map((item,i)=>i===testCheckpoint.current?{status:'failed',detail}:item));
      }
    }finally{testRunActive.current=false;setControlBusy(false);}
  }
  async function stopOneClickTest(){
    if(!testRunActive.current)return;
    testStopRequested.current=true;
    testStopDetail.current='No later test step will run; the current ChatGPT action may finish first.';
    if(probe?.state==='WORKING'&&testContext.current){
      try{
        const result=await browser.tabs.sendMessage(testContext.current.tabId,{type:'AGENTSYNC_TEST_STOP_GENERATION'}) as {stopped?:boolean;reason?:string}|undefined;
        testStopDetail.current=result?.stopped?`${result.reason} `:`ChatGPT generation was not stopped (${result?.reason??'no confirmation'}). `;
      }catch{testStopDetail.current='ChatGPT generation stop was not confirmed. ';}
    }
    setTestRunMessage(`Stop requested. ${testStopDetail.current}`);
  }
  async function setMode(mode:'CHAT'|'WORK'){
    if(tabId===undefined)return;
    setControlBusy(true);setError('');
    try{
      const result=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_SET_COMPOSER_MODE',mode}) as {confirmed?:boolean;error?:string}|undefined;
      if(result?.error||result?.confirmed!==true)throw new Error(result?.error||`ChatGPT did not confirm ${mode} mode.`);
      const value=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
      if(value)setProbe(value);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setControlBusy(false);}
  }
  async function setEffort(value:number){
    if(tabId===undefined)return;
    const effort=(['LOW','MEDIUM','HIGH'] as const)[value];
    setControlBusy(true);setError('');
    try{
      const result=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_SET_EFFORT',effort}) as {confirmed?:boolean;error?:string}|undefined;
      if(result?.error||result?.confirmed!==true)throw new Error(result?.error||`ChatGPT did not confirm ${effort} effort.`);
      const snapshot=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
      if(snapshot)setProbe(snapshot);
      effortTouched.current=false;setEffortDraft(value);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setControlBusy(false);}
  }
  async function changeComposerText(clear:boolean){
    if(tabId===undefined)return;
    setControlBusy(true);setError('');
    try{
      const result=await browser.tabs.sendMessage(tabId,{type:clear?'AGENTSYNC_TEST_CLEAR_COMPOSER':'AGENTSYNC_TEST_SET_COMPOSER_TEXT',text:'AgentSync demo: please reply with “Demo received.”'}) as {confirmed?:boolean;error?:string}|undefined;
      if(result?.error||result?.confirmed!==true)throw new Error(result?.error||'ChatGPT did not confirm the composer change.');
      const snapshot=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
      if(snapshot)setProbe(snapshot);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setControlBusy(false);}
  }
  useEffect(()=>{
    if(tabId===undefined)return;
    let stopped=false,timer:number|undefined,chatModeChecked=false;
    const poll=async()=>{
      try{
        const tab=await browser.tabs.get(tabId);
        if(!tab.url?.startsWith('https://chatgpt.com/'))throw new Error('The watched tab left chatgpt.com.');
        if(tab.status==='complete'){
          await browser.scripting.executeScript({target:{tabId},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
          const tabUrl=new URL(tab.url);
          if(!chatModeChecked&&tabUrl.pathname==='/'){
            chatModeChecked=true;
            const mode=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_ENSURE_CHAT_MODE'}) as {confirmed?:boolean;error?:string}|undefined;
            if(mode?.error||mode?.confirmed!==true)throw new Error(mode?.error||'ChatGPT did not confirm Chat mode.');
          }
          const value=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
          if(value&&!stopped){
            if(previousTestComposerText.current&&value.composerEmpty&&value.userMessageCount>previousTestUserCount.current)testSubmittedUntil.current=Date.now()+2500;
            previousTestComposerText.current=!value.composerEmpty;previousTestUserCount.current=value.userMessageCount;
            const current=testSubmittedUntil.current>Date.now()?{...value,state:'SUBMITTED' as const}:value;
            setProbe(current);if(!effortTouched.current)setEffortDraft(value.effort==='LOW'?0:value.effort==='HIGH'?2:1);setBaseline(old=>old??value.userMessageCount);if(pollError.current){pollError.current=false;setError('');}
            const next=stages[nextStage.current];
            const reached=next==='voice'||next==='voice-again'?(value.state==='NEW'||value.state==='IDLE'):next==='arrow'?value.state==='PROMPT_READY':next==='submitted'?current.state==='SUBMITTED':value.state==='WORKING';
            if(reached){setSequence(old=>[...old,{stage:next,at:new Date().toLocaleTimeString()}]);nextStage.current+=1;}
          }
        }
      }catch(e){if(!stopped){pollError.current=true;setError(e instanceof Error?e.message:String(e));}}
      if(!stopped)timer=window.setTimeout(()=>void poll(),600);
    };
    void poll();return()=>{stopped=true;if(timer!==undefined)clearTimeout(timer);};
  },[tabId]);
  function resetSequence(){nextStage.current=0;setSequence([]);setBaseline(probe?.userMessageCount);}
  const submitted=Boolean(probe&&baseline!==undefined&&probe.userMessageCount>baseline&&probe.composerEmpty);
  const complete=sequence.length===5&&sequence[4]?.stage==='voice-again';
  const savedAgent=probe?savedAgents.find(agent=>{try{return agent.chatUrl&&new URL(agent.chatUrl).pathname.replace(/\/$/,'')===new URL(probe.href).pathname.replace(/\/$/,'');}catch{return false;}}):undefined;
  async function testChatAction(action:'OPEN'|'DELETE'|'ARCHIVE'){
    if(tabId===undefined||!probe?.hasConversationUrl)return;
    if(action==='DELETE'){
      const chatName=savedAgent?.chatName??`A${savedAgent?.number??'?'} · ${savedAgent?.role??'saved chat'}`;
      if(!window.confirm(`Permanently delete “${chatName}” from ChatGPT? This may be unrecoverable and can break its saved AgentSync chat link.`))return;
    }
    setControlBusy(true);setError('');setChatActionStatus('');
    try{
      const type=action==='OPEN'?'AGENTSYNC_TEST_OPEN_CHAT_MENU':action==='ARCHIVE'?'AGENTSYNC_TEST_ARCHIVE_CHAT':'AGENTSYNC_TEST_DELETE_CHAT';
      const result=await browser.tabs.sendMessage(tabId,{type,confirmDelete:action==='DELETE'}) as {menuOpen?:boolean;actions?:string[];performed?:boolean;conversationChanged?:boolean;notice?:string;error?:string}|undefined;
      if(result?.error)throw new Error(result.error);
      if(action==='OPEN'&&result?.menuOpen)setChatActionStatus(`Menu opened. Detected: ${(result.actions??[]).join(' and ')}.`);
      else if(result?.performed)setChatActionStatus(result.notice??`${action==='ARCHIVE'?'Archive':'Delete'} action completed${result.conversationChanged?' · conversation URL changed':''}.`);
      else throw new Error('ChatGPT did not confirm the requested menu action.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setControlBusy(false);}
  }
  return <section className="chat-test-wizard" role="tabpanel" id={embedded?'panel-live-chat':'panel-chatgpt'} aria-labelledby={embedded?'status-live-chat-title':'tab-chatgpt'}>
    <div className="panel chat-test-intro"><p className="eyebrow">CHATGPT DIAGNOSTICS</p><h2 id={embedded?'status-live-chat-title':undefined}>{embedded?'Current ChatGPT tab':'Test wizard'}</h2><p>Watch the active ChatGPT tab or open a new one. The view detects the conversation URL, composer state, action icons, selected mode and effort, and the voice → arrow → stop → voice flow.</p>
      <div className="buttons">
        {testRunPhase==='RUNNING'?<button type="button" className="danger-button" onClick={()=>void stopOneClickTest()}>Stop test</button>:<>
          <button type="button" disabled={busy||controlBusy} onClick={()=>void runOneClickTest(testRunPhase==='IDLE'?'START':'RESTART')}>{testRunPhase==='IDLE'?'Run one-click test':'Restart test'}</button>
          {(testRunPhase==='STOPPED'||testRunPhase==='FAILED')&&testContext.current&&<button type="button" className="secondary-button" disabled={busy||controlBusy} onClick={()=>void runOneClickTest('RESUME')}>Resume test</button>}
        </>}
        <button type="button" className="secondary-button" disabled={busy||controlBusy||testRunPhase==='RUNNING'} onClick={()=>void openNew()}>{busy?'Opening…':'Open new chat'}</button><button type="button" className="secondary-button" disabled={busy||controlBusy||testRunPhase==='RUNNING'} onClick={async()=>{const [tab]=await browser.tabs.query({active:true,currentWindow:true});if(tab?.id!==undefined)void watchTab(tab.id);else setError('No active browser tab was found.');}}>Watch active tab</button><button type="button" className="secondary-button" disabled={!tabId||controlBusy} onClick={resetSequence}>Reset sequence</button>
      </div>
    </div>
    {(testRunPhase!=='IDLE'||testRunMessage)&&<section className="panel" aria-live="polite"><h3>One-click test progress</h3><p className={testRunPhase==='FAILED'||testRunPhase==='STOPPED'?'error':testRunPhase==='PASSED'?'notice':''} role="status">{testRunMessage}</p><ol className="chat-test-sequence">{testRunSteps.map((step,index)=>{const result=testRunResults[index]??{status:'waiting' as const,detail:'Not started'};return <li key={step} data-reached={result.status==='passed'} data-active={result.status==='running'} data-failed={result.status==='failed'||result.status==='stopped'}><span>{result.status==='passed'?'✓':result.status==='failed'?'!':result.status==='stopped'?'Ⅱ':result.status==='running'?'…':index+1}</span><div><strong>{step}</strong><small>{result.detail}</small></div></li>;})}</ol>{testRunPhase==='FAILED'||testRunPhase==='STOPPED'?<p className="chat-test-control-note">Resume continues from the stopped step. Restart creates a new temporary test chat; the previous chat stays open for inspection.</p>:null}</section>}
    {error&&<p className="error" role="alert">{error}</p>}
    {!probe?<section className="panel"><strong>Waiting for ChatGPT</strong><p>Open a new chat or watch an active ChatGPT tab. The wizard needs permission to inspect the tab’s composer buttons and URL.</p></section>:<>
      <section className="panel"><div className="chat-test-state"><span className={`chat-state-dot state-${probe.state.toLowerCase()}`}/><div><p className="eyebrow">CURRENT STATE</p><h3>{probe.state.replace('_',' ')}</h3></div></div><p>{explanations[probe.state]}</p><dl className="chat-test-facts">
        <div><dt>Page loaded</dt><dd>{probe.pageLoaded?'Yes':'No'}</dd></div><div><dt>Conversation URL</dt><dd>{probe.hasConversationUrl?'Yes':'No — new-chat URL'}{probe.hasConversationUrl&&<a href={probe.conversationUrl} target="_blank" rel="noreferrer">Open conversation</a>}</dd></div><div><dt>Composer mode</dt><dd>{probe.composerMode==='CHAT'?'Chat selected':probe.composerMode==='WORK'?'Work selected':'Not detected'}</dd></div><div><dt>Effort</dt><dd>{probe.effort==='UNKNOWN'?'Not detected':`${probe.effort[0]}${probe.effort.slice(1).toLowerCase()} selected`}</dd></div>
        <div><dt>Composer</dt><dd>{!probe.composerVisible?'Not found':probe.composerEmpty?'Empty':`Has text (${probe.composerLength} characters)`}</dd></div>
        <div><dt>Voice button</dt><dd>{probe.voiceVisible?probe.voiceEnabled?'Visible · enabled':'Visible · disabled':'Not visible'}</dd></div><div><dt>Arrow button</dt><dd>{probe.arrowVisible?probe.arrowEnabled?'Visible · enabled':'Visible · disabled':'Not visible'}</dd></div>
        <div><dt>Stop button</dt><dd>{probe.stopVisible?probe.stopEnabled?'Visible · enabled':'Visible · disabled':'Not visible'}</dd></div><div><dt>Pause button</dt><dd>{probe.pauseVisible?probe.pauseEnabled?'Visible':'Visible · disabled':'Not visible'}</dd></div>
        <div><dt>Prompt submitted</dt><dd>{submitted?'Detected — composer cleared after a new user message':'Not detected'}</dd></div>
      </dl><p className="chat-test-saved-name">Saved chat: <strong>{savedAgent?.chatName??(savedAgent?`A${savedAgent.number} · ${savedAgent.role}`:probe.hasConversationUrl?'Not registered with an AgentSync agent':'New chat · not saved yet')}</strong></p><small className="chat-test-url">Tab URL: {probe.href}</small></section>
      <section className="panel"><h3>Composer controls</h3><p>Change the selected ChatGPT mode and thinking effort in the watched tab.</p><div className="chat-test-controls" role="group" aria-label="Composer mode controls"><button type="button" aria-pressed={probe.composerMode==='CHAT'} disabled={controlBusy||probe.composerMode==='CHAT'} onClick={()=>void setMode('CHAT')}>Chat</button><button type="button" className="secondary-button" aria-pressed={probe.composerMode==='WORK'} disabled={controlBusy||probe.composerMode==='WORK'} onClick={()=>void setMode('WORK')}>Work</button></div><label className="chat-test-effort">Effort: <strong>{(['Low','Medium','High'] as const)[effortDraft]}</strong><input type="range" min="0" max="2" step="1" value={effortDraft} aria-label="ChatGPT effort" disabled={controlBusy} onChange={e=>{effortTouched.current=true;setEffortDraft(Number(e.currentTarget.value));}}/><span className="chat-test-effort-labels"><span>Low</span><span>Medium</span><span>High</span></span></label><button type="button" className="secondary-button" disabled={controlBusy||probe.effort===(['LOW','MEDIUM','HIGH'] as const)[effortDraft]} onClick={()=>void setEffort(effortDraft)}>{controlBusy?'Applying…':'Apply effort'}</button><div className="chat-test-composer-buttons"><button type="button" disabled={controlBusy||!probe.composerVisible||!probe.composerEmpty} onClick={()=>void changeComposerText(false)}>Post demo text</button><button type="button" className="secondary-button" disabled={controlBusy||!probe.composerVisible||probe.composerEmpty} onClick={()=>void changeComposerText(true)}>Clear composer</button></div><small className="chat-test-control-note">These buttons only fill or clear the draft. They never submit it.</small></section>
      <section className="panel"><h3>Chat menu tests</h3><p>These actions target the watched conversation. Delete asks for confirmation first.</p><div className="chat-test-composer-buttons"><button type="button" className="secondary-button" disabled={controlBusy||!probe.hasConversationUrl} onClick={()=>void testChatAction('OPEN')}>Open chat menu</button><button type="button" className="secondary-button" disabled={controlBusy||!probe.hasConversationUrl} onClick={()=>void testChatAction('ARCHIVE')}>Archive chat</button><button type="button" className="danger-button" disabled={controlBusy||!probe.hasConversationUrl} onClick={()=>void testChatAction('DELETE')}>Delete chat</button></div>{chatActionStatus&&<p className="notice" role="status">{chatActionStatus}</p>}<small className="chat-test-control-note">The menu must show Archive and Delete before either action is clicked.</small></section>
      <section className="panel"><h3>Composer text</h3><pre className="chat-test-content">{probe.composerText||'(empty)'}{probe.composerTextTruncated?'\n… text clipped at 5,000 characters':''}</pre><h3>Latest reply</h3><p className="chat-test-reply">{probe.latestReplyFirstLine||'No assistant reply yet.'}</p><p className="chat-test-copy">Copy status: {probe.latestReplyCopyStatus==='COPIED'?'Copied':probe.latestReplyCopyStatus==='COPY_CLICKED'?'Copy clicked · waiting for visible confirmation':'Not copied'}</p></section>
      <section className="panel"><h3>State sequence</h3><ol className="chat-test-sequence">{stages.map((stage,index)=>{const reached=sequence[index]?.stage===stage;const help=stage==='voice'||stage==='voice-again'?'Empty composer and enabled voice control':stage==='arrow'?'Type a prompt; enabled arrow appears':stage==='submitted'?'Submit once; the composer clears and the user message appears':'Generation begins; the stop control appears';return <li key={`${stage}-${index}`} data-reached={reached}><span>{reached?'✓':index+1}</span><div><strong>{names[stage]}</strong><small>{reached?sequence[index].at:help}</small></div></li>;})}</ol>{complete&&<p className="notice">Test passed: the prompt was submitted, generation stopped, and the chat returned to idle.</p>}</section>
    </>}
  </section>;
}
