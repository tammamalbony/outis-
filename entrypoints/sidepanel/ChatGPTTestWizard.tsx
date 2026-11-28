import {useEffect,useRef,useState} from 'react';
import {browser} from 'wxt/browser';
import type {Agent} from '../../src/core';
import {chatAdapter} from '../../src/chat-adapter';

type Probe={href:string;hasConversationUrl:boolean;conversationUrl:string;pageLoaded:boolean;composerVisible:boolean;composerText:string;composerTextTruncated:boolean;composerMode:'CHAT'|'WORK'|'UNKNOWN';effort:'LOW'|'MEDIUM'|'HIGH'|'UNKNOWN';composerEmpty:boolean;composerLength:number;voiceVisible:boolean;voiceEnabled:boolean;arrowVisible:boolean;arrowEnabled:boolean;stopVisible:boolean;stopEnabled:boolean;pauseVisible:boolean;pauseEnabled:boolean;userMessageCount:number;latestReplyFirstLine:string;latestReplyCopyStatus:'NOT_COPIED'|'COPY_CLICKED'|'COPIED';state:'LOADING'|'NEW'|'IDLE'|'WORKING'|'PROMPT_READY'|'SUBMITTED'|'WAITING';observedAt:string};
type Milestone='voice'|'arrow'|'submitted'|'stop'|'voice-again';
type TestRunPhase='IDLE'|'RUNNING'|'PASSED'|'FAILED';
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
  const [tabId,setTabId]=useState<number>(),[probe,setProbe]=useState<Probe>(),[error,setError]=useState(''),[sequence,setSequence]=useState<{stage:Milestone;at:string}[]>([]),[baseline,setBaseline]=useState<number>(),[busy,setBusy]=useState(false),[controlBusy,setControlBusy]=useState(false),[effortDraft,setEffortDraft]=useState(1),[chatActionStatus,setChatActionStatus]=useState(''),[testRunPhase,setTestRunPhase]=useState<TestRunPhase>('IDLE'),[testRunStep,setTestRunStep]=useState(-1),[testRunMessage,setTestRunMessage]=useState('');
  const nextStage=useRef(0);
  const effortTouched=useRef(false);
  const previousTestComposerText=useRef(false);
  const previousTestUserCount=useRef(0);
  const testSubmittedUntil=useRef(0);
  const pollError=useRef(false);
  const testRunActive=useRef(false);
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
  async function waitForTestSnapshot(id:number,predicate:(value:Probe)=>boolean,timeoutMs:number){
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
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
  function markTestMilestone(stage:Milestone){
    const index=stages.indexOf(stage);
    setSequence(old=>{
      const next=[...old];
      while(next.length<=index)next.push({stage:stages[next.length],at:new Date().toLocaleTimeString()});
      return next;
    });
    nextStage.current=Math.max(nextStage.current,index+1);
  }
  async function runOneClickTest(){
    if(testRunActive.current)return;
    testRunActive.current=true;setTestRunPhase('RUNNING');setTestRunStep(0);setTestRunMessage('Starting a clean ChatGPT test conversation…');setControlBusy(true);setError('');setChatActionStatus('');setProbe(undefined);setSequence([]);setBaseline(0);nextStage.current=0;previousTestComposerText.current=false;previousTestUserCount.current=0;testSubmittedUntil.current=0;effortTouched.current=false;
    let createdTabId:number|undefined;
    try{
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access was not granted.');
      const tab=await browser.tabs.create({url:'https://chatgpt.com/',active:true});
      if(tab.id===undefined)throw new Error('Chrome did not return the new test tab.');
      createdTabId=tab.id;setTabId(tab.id);setTestRunStep(1);setTestRunMessage('Waiting for the new chat to load…');
      const initial=await waitForTestSnapshot(tab.id,value=>value.pageLoaded&&value.composerVisible,45_000);
      setTestRunStep(1);setTestRunMessage(initial.composerEmpty?'Composer is already clear.':'Clearing the old composer draft…');
      if(!initial.composerEmpty){
        const cleared=await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_TEST_CLEAR_COMPOSER'}) as {confirmed?:boolean;error?:string}|undefined;
        if(cleared?.error||cleared?.confirmed!==true)throw new Error(cleared?.error||'ChatGPT did not confirm clearing the old draft.');
      }
      setTestRunStep(2);setTestRunMessage('Selecting Chat mode…');
      const mode=await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_ENSURE_CHAT_MODE'}) as {confirmed?:boolean;error?:string}|undefined;
      if(mode?.error||mode?.confirmed!==true)throw new Error(mode?.error||'ChatGPT did not confirm Chat mode.');
      setTestRunStep(3);setTestRunMessage('Setting High effort…');
      const effort=await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_SET_EFFORT',effort:'HIGH'}) as {confirmed?:boolean;error?:string}|undefined;
      if(effort?.error||effort?.confirmed!==true)throw new Error(effort?.error||'ChatGPT did not confirm High effort.');
      setTestRunStep(4);setTestRunMessage('Waiting for an empty composer and enabled voice button…');
      const ready=await waitForTestSnapshot(tab.id,value=>value.state==='NEW'&&value.composerEmpty&&value.voiceVisible&&value.voiceEnabled&&value.composerMode==='CHAT'&&value.effort==='HIGH',30_000);
      markTestMilestone('voice');setBaseline(ready.userMessageCount);previousTestUserCount.current=ready.userMessageCount;
      setTestRunStep(5);setTestRunMessage('Putting the labeled demo prompt in the composer…');
      const key=`test_${crypto.randomUUID()}`;
      const prompt=`AgentSync one-click test: please reply with exactly “AgentSync test received.”\n\nAgentSync delivery ID: ${key}`;
      const drafted=await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_TEST_SET_COMPOSER_TEXT',text:prompt}) as {confirmed?:boolean;error?:string}|undefined;
      if(drafted?.error||drafted?.confirmed!==true)throw new Error(drafted?.error||'ChatGPT did not confirm the demo prompt in the composer.');
      const arrow=await waitForTestSnapshot(tab.id,value=>value.state==='PROMPT_READY'&&value.arrowVisible&&value.arrowEnabled&&value.composerText.includes(key),15_000);
      markTestMilestone('arrow');previousTestComposerText.current=true;previousTestUserCount.current=arrow.userMessageCount;
      setTestRunStep(6);setTestRunMessage('Submitting the demo prompt…');
      const submitted=await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_TEST_SEND_DEMO',dedupeKey:key,text:prompt}) as {submitted?:boolean;error?:string}|undefined;
      if(submitted?.error||submitted?.submitted!==true)throw new Error(submitted?.error||'ChatGPT did not confirm that it received the demo prompt.');
      markTestMilestone('submitted');setTestRunStep(7);setTestRunMessage('Waiting for ChatGPT to reply and return to idle…');
      await waitForTestSnapshot(tab.id,value=>value.state==='WORKING',30_000);
      markTestMilestone('stop');
      const reply=await waitForTestSnapshot(tab.id,value=>value.state==='IDLE'&&value.composerEmpty&&value.voiceEnabled&&value.userMessageCount>ready.userMessageCount&&value.latestReplyFirstLine.toLowerCase().includes('agentsync test received'),120_000);
      markTestMilestone('voice-again');setTestRunStep(8);setTestRunMessage('The expected reply arrived. Deleting the temporary test chat…');
      const deleted=await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_TEST_DELETE_CHAT',confirmDelete:true}) as {performed?:boolean;conversationChanged?:boolean;notice?:string;error?:string}|undefined;
      if(deleted?.error||deleted?.performed!==true||deleted.conversationChanged!==true)throw new Error(deleted?.error||'The reply passed, but ChatGPT did not confirm deletion. The test chat was kept for inspection.');
      setTestRunPhase('PASSED');setTestRunStep(testRunSteps.length);setTestRunMessage(`Passed: ChatGPT replied “${reply.latestReplyFirstLine}” and the temporary chat was deleted.`);
      setChatActionStatus('Test passed. Expected reply received; temporary chat deleted.');
    }catch(e){
      const message=e instanceof Error?e.message:String(e);setTestRunPhase('FAILED');setTestRunMessage(message);setError(message);
    }finally{testRunActive.current=false;setControlBusy(false);}
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
      <div className="buttons"><button type="button" disabled={busy||controlBusy||testRunPhase==='RUNNING'} onClick={()=>void runOneClickTest()}>{testRunPhase==='RUNNING'?'Running test…':'Run one-click test'}</button><button type="button" className="secondary-button" disabled={busy||controlBusy} onClick={()=>void openNew()}>{busy?'Opening…':'Open new chat'}</button><button type="button" className="secondary-button" disabled={busy||controlBusy} onClick={async()=>{const [tab]=await browser.tabs.query({active:true,currentWindow:true});if(tab?.id!==undefined)void watchTab(tab.id);else setError('No active browser tab was found.');}}>Watch active tab</button><button type="button" className="secondary-button" disabled={!tabId||controlBusy} onClick={resetSequence}>Reset sequence</button></div>
    </div>
    {(testRunPhase!=='IDLE'||testRunMessage)&&<section className="panel" aria-live="polite"><h3>One-click test progress</h3><p className={testRunPhase==='FAILED'?'error':testRunPhase==='PASSED'?'notice':''} role="status">{testRunMessage}</p><ol className="chat-test-sequence">{testRunSteps.map((step,index)=>{const done=testRunPhase==='PASSED'||testRunStep>index;const active=testRunPhase==='RUNNING'&&testRunStep===index;const failed=testRunPhase==='FAILED'&&testRunStep===index;return <li key={step} data-reached={done} data-active={active} data-failed={failed}><span>{done?'✓':failed?'!':active?'…':index+1}</span><div><strong>{step}</strong><small>{failed?'Stopped here':done?'Complete':active?'In progress':'Waiting'}</small></div></li>;})}</ol></section>}
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
