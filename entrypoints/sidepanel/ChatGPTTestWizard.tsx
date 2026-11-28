import {useEffect,useRef,useState} from 'react';
import {browser} from 'wxt/browser';
import type {Agent} from '../../src/core';
import {chatAdapter} from '../../src/chat-adapter';

type Probe={href:string;hasConversationUrl:boolean;conversationUrl:string;pageLoaded:boolean;composerVisible:boolean;composerText:string;composerTextTruncated:boolean;composerMode:'CHAT'|'WORK'|'UNKNOWN';effort:'LOW'|'MEDIUM'|'HIGH'|'UNKNOWN';composerEmpty:boolean;composerLength:number;voiceVisible:boolean;voiceEnabled:boolean;arrowVisible:boolean;arrowEnabled:boolean;stopVisible:boolean;stopEnabled:boolean;pauseVisible:boolean;pauseEnabled:boolean;userMessageCount:number;latestUserMessage:string;latestUserMessageTruncated:boolean;latestReplyText:string;latestReplyTruncated:boolean;latestReplyFirstLine:string;latestReplyCopyStatus:'NOT_COPIED'|'COPY_CLICKED'|'COPIED';state:'LOADING'|'NEW'|'IDLE'|'WORKING'|'PROMPT_READY'|'SUBMITTED'|'WAITING';observedAt:string};
type Milestone='voice'|'arrow'|'submitted'|'stop'|'voice-again';
type TestRunPhase='IDLE'|'RUNNING'|'PAUSED'|'PASSED'|'FAILED'|'STOPPED';
type TestRunResult={status:'waiting'|'running'|'passed'|'stopped'|'failed';detail:string};
type TestStepMetric={attempts:number;startedAt?:number;durationMs:number};
type TestRetryEvent={step:string;at:string;detail:string};
type TestRunContext={tabId:number;promptKey?:string;prompt?:string;userMessageCount?:number};
const stages:Milestone[]=['voice','arrow','submitted','stop','voice-again'];
const names:Record<Milestone,string>={voice:'Voice ready',arrow:'Arrow ready',submitted:'Prompt submitted',stop:'Generating', 'voice-again':'Voice returned'};
const testRunSteps=['Open a fresh test chat','Clear any old draft','Confirm Chat mode','Set High effort','Wait for voice ready','Prepare demo prompt','Submit the prompt','Receive the expected reply','Delete the test chat'];
function validateChatGPTTabUrl(rawUrl?:string){
  if(!rawUrl)throw new Error('The active tab has no URL yet. Wait for it to finish loading, then try again.');
  let url:URL;try{url=new URL(rawUrl);}catch{throw new Error('The active tab URL is not valid.');}
  if(url.origin!=='https://chatgpt.com'||url.username||url.password)throw new Error('This tab is not on the approved ChatGPT site (https://chatgpt.com).');
  const isNewChat=url.pathname==='/'||url.pathname==='';
  const isConversation=/^\/c\/[A-Za-z0-9-]+\/?$/.test(url.pathname);
  if(!isNewChat&&!isConversation)throw new Error('This ChatGPT page is not a supported new chat or conversation. Open chatgpt.com or a /c/ conversation URL.');
  return {url:`${url.origin}${isNewChat?'/':url.pathname.replace(/\/$/,'')}`,kind:isNewChat?'new chat':'conversation'} as const;
}
const explanations:Record<Probe['state'],string>={
  LOADING:'The ChatGPT document is still loading. The wizard is waiting for its composer controls.',
  NEW:'The URL is chatgpt.com with no /c/ conversation, and the empty composer has an enabled voice button. This is a ready new chat.',
  IDLE:'The URL contains a /c/ conversation, and the empty composer has an enabled voice button. This is a ready idle chat.',
  WORKING:'The stop control is enabled. ChatGPT is generating a response.',
  PROMPT_READY:'The composer contains text and its enabled arrow is visible. The prompt is ready to submit, even if another status icon is present.',
  SUBMITTED:'A new user message appeared and the composer cleared. ChatGPT accepted the prompt.',
  WAITING:'The page has not reached a recognized ready state. Check the composer and wait for its action button to become enabled.'
};
const statusIconPaths:Record<string,string>={
  link:'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.72-1.72',
  chat:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
  send:'m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  mic:'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8',
  stop:'M7 7h10v10H7z',
  loading:'M20 7v5h-5M4 17v-5h5M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2',
  ready:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 12l2.5 2.5L16 9',
  composer:'M4 5h16v14H4zM8 9h8M8 13h8M8 17h4',
  mode:'M4 7h16M4 12h16M4 17h16M8 5v4M15 10v4M10 15v4',
  'mode-chat':'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5ZM8 12h.01M12 12h.01M16 12h.01',
  'mode-work':'M3 8h18v12H3zM8 8V5h8v3M3 12h18M10 12v2h4v-2',
  'effort-low':'M4 19h16M7 19v-5',
  'effort-medium':'M4 19h16M7 19v-5M12 19V9',
  'effort-high':'M4 19h16M7 19v-5M12 19V9M17 19V4',
  'effort-unknown':'M12 17h.01M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1 .9-1.7 1.3-1.7 2.7M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  button:'M5 3v18l5-5 4 6 3-2-4-6h7L5 3Z',
  'user-message':'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5ZM12 16V8M9 11l3-3 3 3',
  'assistant-message':'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5ZM9 12h.01M12 12h.01M15 12h.01'
};
export default function ChatGPTTestWizard({savedAgents=[]}:{savedAgents?:Agent[]}){
  const [tabId,setTabId]=useState<number>(),[probe,setProbe]=useState<Probe>(),[observedTabUrl,setObservedTabUrl]=useState(''),[observedTabUrlValid,setObservedTabUrlValid]=useState<boolean>(),[activeTabLoading,setActiveTabLoading]=useState(false),[error,setError]=useState(''),[tabSelectionStatus,setTabSelectionStatus]=useState(''),[sequence,setSequence]=useState<{stage:Milestone;at:string}[]>([]),[baseline,setBaseline]=useState<number>(),[busy,setBusy]=useState(false),[controlBusy,setControlBusy]=useState(false),[effortDraft,setEffortDraft]=useState(1),[chatActionStatus,setChatActionStatus]=useState(''),[composerTestStatus,setComposerTestStatus]=useState(''),[testRunPhase,setTestRunPhase]=useState<TestRunPhase>('IDLE'),[testRunStep,setTestRunStep]=useState(-1),[testRunMessage,setTestRunMessage]=useState(''),[testRunResults,setTestRunResults]=useState<TestRunResult[]>(()=>testRunSteps.map(()=>({status:'waiting',detail:'Not started'})));
  const [railActionStatus,setRailActionStatus]=useState('');
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
  const latestProbe=useRef<Probe|undefined>(undefined);
  const clearComposerOnNewChat=useRef(false);
  const lastWatchedRoute=useRef('');
  const manualDemoKey=useRef<string|undefined>(undefined);
  const testStepMetrics=useRef<TestStepMetric[]>(testRunSteps.map(()=>({attempts:0,durationMs:0})));
  const testRetryEvents=useRef<TestRetryEvent[]>([]);
  const testRunStartedAt=useRef<number|undefined>(undefined);
  useEffect(()=>{
    let cancelled=false;
    void browser.permissions.contains({origins:['https://chatgpt.com/*']}).then(async granted=>{
      if(!granted||cancelled)return;
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});
      if(!cancelled&&tab?.id!==undefined){try{validateChatGPTTabUrl(tab.pendingUrl||tab.url);void watchTab(tab.id);}catch{/* Unsupported active tabs stay unwatched until the user chooses one. */}}
    }).catch(()=>{});
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    if(tabId===undefined)return;
    const handleTabActivated=(activeInfo:{tabId:number})=>{
      if(activeInfo.tabId!==tabId)setBaseline(latestProbe.current?.userMessageCount);
    };
    browser.tabs.onActivated.addListener(handleTabActivated);
    return()=>browser.tabs.onActivated.removeListener(handleTabActivated);
  },[tabId]);
  async function watchTab(id:number){
    clearComposerOnNewChat.current=false;setBusy(true);setError('');setTabId(undefined);setProbe(undefined);setSequence([]);setBaseline(undefined);nextStage.current=0;previousTestComposerText.current=false;previousTestUserCount.current=0;testSubmittedUntil.current=0;effortTouched.current=false;
    latestProbe.current=undefined;
    try{
      const tab=await browser.tabs.get(id);
      const validated=validateChatGPTTabUrl(tab.pendingUrl||tab.url);
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access was not granted.');
      lastWatchedRoute.current=validated.url;setTabId(id);
      setObservedTabUrl(tab.pendingUrl||tab.url||validated.url);setObservedTabUrlValid(true);setActiveTabLoading(tab.status!=='complete');
      setTabSelectionStatus(`Using validated ChatGPT ${validated.kind}: ${validated.url}`);
    }catch(e){const message=e instanceof Error?e.message:String(e);setTabSelectionStatus(`Active tab rejected: ${message}`);setError(message);}finally{setBusy(false);}
  }
  async function useActiveTab(){
    setError('');setTabSelectionStatus('Checking the active tab URL…');
    try{
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});
      if(tab?.id===undefined)throw new Error('No active browser tab was found.');
      const rawUrl=tab.pendingUrl||tab.url||'';setTabId(undefined);setProbe(undefined);setObservedTabUrl(rawUrl);setObservedTabUrlValid(false);setActiveTabLoading(tab.status!=='complete');
      const validated=validateChatGPTTabUrl(rawUrl);
      setObservedTabUrlValid(true);
      setTabSelectionStatus(`URL accepted · ${validated.kind}: ${validated.url}`);
      await watchTab(tab.id);
    }catch(e){const message=e instanceof Error?e.message:String(e);setError(message);setTabSelectionStatus(`URL rejected · ${message}`);}
  }
  async function openNew(){
    setBusy(true);setError('');setProbe(undefined);setSequence([]);setBaseline(undefined);nextStage.current=0;previousTestComposerText.current=false;previousTestUserCount.current=0;testSubmittedUntil.current=0;effortTouched.current=false;latestProbe.current=undefined;clearComposerOnNewChat.current=false;
    try{
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access was not granted.');
      const tab=await browser.tabs.create({url:'https://chatgpt.com/',active:true});
      if(tab.id===undefined)throw new Error('Chrome did not return the new ChatGPT tab.');
      clearComposerOnNewChat.current=true;lastWatchedRoute.current='https://chatgpt.com/';setTabId(tab.id);setObservedTabUrl('https://chatgpt.com/');setObservedTabUrlValid(true);setActiveTabLoading(true);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  async function waitForTestSnapshot(id:number,predicate:(value:Probe)=>boolean,timeoutMs:number,cancellable=false,onSnapshot?:(value:Probe)=>Promise<void>|void){
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
        let value:Probe|undefined;
        try{
          await browser.scripting.executeScript({target:{tabId:id},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
          value=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
        }catch{/* The content bridge may not be ready until the next poll. */}
        if(value){setProbe(value);await onSnapshot?.(value);if(predicate(value))return value;}
      }
      await new Promise(resolve=>window.setTimeout(resolve,500));
    }
    throw new Error('Timed out while waiting for ChatGPT to reach the expected test state. The test chat was kept for inspection.');
  }
  function beginTestStep(index:number,message:string){
    if(testStopRequested.current)throw new Error('Stop requested.');
    const metric=testStepMetrics.current[index];
    if(metric){metric.attempts+=1;metric.startedAt=Date.now();}
    if(!testRunStartedAt.current)testRunStartedAt.current=Date.now();
    testCheckpoint.current=index;setTestRunStep(index);setTestRunMessage(message);
    setTestRunResults(old=>old.map((item,i)=>i===index?{status:'running',detail:message}:item));
  }
  function passTestStep(index:number,detail:string){
    const metric=testStepMetrics.current[index];if(metric?.startedAt){metric.durationMs+=Date.now()-metric.startedAt;metric.startedAt=undefined;}
    setTestRunResults(old=>old.map((item,i)=>i===index?{status:'passed',detail}:item));
    testCheckpoint.current=index+1;
  }
  function recordTestRetry(index:number,detail:string){
    testRetryEvents.current.push({step:testRunSteps[index]??`Step ${index+1}`,at:new Date().toISOString(),detail});
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
  async function runOneClickTest(action:'START'|'RESUME'|'RESTART'='START',autoRun=false){
    if(testRunActive.current)return;
    if(action==='RESUME'&&!testContext.current){setError('This run has no saved test tab to resume. Choose Restart test.');return;}
    const restarting=action!=='RESUME';
    const previousTestKept=action==='RESTART'&&Boolean(testContext.current);
    if(restarting){testContext.current=undefined;testCheckpoint.current=0;testStepMetrics.current=testRunSteps.map(()=>({attempts:0,durationMs:0}));testRetryEvents.current=[];testRunStartedAt.current=undefined;manualDemoKey.current=undefined;setTestRunResults(testRunSteps.map(()=>({status:'waiting',detail:'Not started'})));setSequence([]);nextStage.current=0;previousTestComposerText.current=false;previousTestUserCount.current=0;testSubmittedUntil.current=0;setBaseline(0);}
    testStopRequested.current=false;testStopDetail.current='';testRunActive.current=true;setTestRunPhase('RUNNING');setControlBusy(true);setError('');setChatActionStatus('');effortTouched.current=false;
    const context=testContext.current;
    if(!context)setTabId(undefined);else setTabId(context.tabId);
    const stepLimit=autoRun?8:testCheckpoint.current;
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
      if(testCheckpoint.current<=1&&stepLimit>=1){
        beginTestStep(1,'Waiting for the composer, then clearing any old draft…');
        const initial=await waitForTestSnapshot(id,value=>value.pageLoaded&&value.composerVisible,45_000,true);
        if(!initial.composerEmpty){
          const cleared=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_CLEAR_COMPOSER'}) as {confirmed?:boolean;error?:string}|undefined;
          if(cleared?.error||cleared?.confirmed!==true)throw new Error(cleared?.error||'ChatGPT did not confirm the old draft was cleared.');
          passTestStep(1,'Cleared the old composer draft; it was not submitted.');
        }else passTestStep(1,'Composer was already empty; nothing was cleared.');
      }
      if(testCheckpoint.current<=2&&stepLimit>=2){
        beginTestStep(2,'Selecting and confirming Chat mode…');
        const mode=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_ENSURE_CHAT_MODE'}) as {confirmed?:boolean;error?:string}|undefined;
        if(mode?.error||mode?.confirmed!==true)throw new Error(mode?.error||'ChatGPT did not confirm Chat mode.');
        passTestStep(2,'Chat mode confirmed.');
      }
      if(testCheckpoint.current<=3&&stepLimit>=3){
        beginTestStep(3,'Selecting and confirming High effort…');
        const effort=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_SET_EFFORT',effort:'HIGH'}) as {confirmed?:boolean;error?:string}|undefined;
        if(effort?.error||effort?.confirmed!==true)throw new Error(effort?.error||'ChatGPT did not confirm High effort.');
        passTestStep(3,'High effort confirmed.');
      }
      if(testCheckpoint.current<=4&&stepLimit>=4){
        beginTestStep(4,'Waiting for an empty composer, enabled voice button, Chat mode, and High effort…');
        let restoredDraftsCleared=0;
        const ready=await waitForTestSnapshot(id,value=>value.state==='NEW'&&value.composerEmpty&&value.voiceVisible&&value.voiceEnabled&&value.composerMode==='CHAT'&&value.effort==='HIGH',30_000,true,async value=>{
          if(value.composerVisible&&!value.composerEmpty){
            if(restoredDraftsCleared>=3)throw new Error('ChatGPT restored draft text three times. The composer is not empty, so the voice-ready state cannot be confirmed. The prompt was not submitted.');
            restoredDraftsCleared+=1;recordTestRetry(4,`Composer was non-empty (${value.composerLength} characters); clearing restored draft attempt ${restoredDraftsCleared}.`);setTestRunMessage('ChatGPT restored an old draft after loading. Clearing it and waiting for the empty-composer voice button…');
            const cleared=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_CLEAR_COMPOSER'}) as {confirmed?:boolean;error?:string}|undefined;
            if(cleared?.error||cleared?.confirmed!==true)throw new Error(cleared?.error||'ChatGPT did not confirm clearing the restored draft; voice readiness remains unconfirmed.');
          }
        });
        ctx.userMessageCount=ready.userMessageCount;setBaseline(ready.userMessageCount);previousTestUserCount.current=ready.userMessageCount;
        markTestMilestone('voice');
        passTestStep(4,`Ready: new-chat URL, empty composer, voice enabled, Chat selected, High effort selected. ${restoredDraftsCleared?`Cleared ${restoredDraftsCleared} late-restored draft(s).`:'Composer stayed empty after load.'}`);
      }
      if(testCheckpoint.current<=5&&stepLimit>=5){
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
      if(testCheckpoint.current<=6&&stepLimit>=6){
        beginTestStep(6,'Clicking the enabled send arrow once, then checking the result…');
        const before=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
        if(!before)throw new Error('Could not inspect the composer before clicking. No action was taken.');
        const promptKey=ctx.promptKey,prompt=ctx.prompt;
        if(!promptKey||!prompt)throw new Error('Saved test prompt or delivery ID is missing. No action was taken.');
        if(before.composerEmpty&&ctx.userMessageCount!==undefined&&before.userMessageCount>ctx.userMessageCount){
          const proof=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_VERIFY_LAST_USER_MESSAGE',conversationUrl:before.conversationUrl,dedupeKey:promptKey,text:prompt,allowNewConversation:true}) as {confirmed?:boolean;reason?:string}|undefined;
          if(proof?.confirmed!==true)throw new Error(`Composer is empty, but the exact saved test prompt is not confirmed as the latest user message (${proof?.reason??'no proof returned'}). It was not resent; the test chat was kept for inspection.`);
          markTestMilestone('submitted');
          passTestStep(6,'On resume, confirmed the exact latest user message, saved delivery ID, and empty composer; it was not sent again.');
        }else{
          if(!before.composerVisible||before.composerEmpty||!before.composerText.includes(promptKey))throw new Error('The labeled test prompt is not already in the composer. Nothing was staged, cleared, or submitted.');
          if(!before.arrowVisible||!before.arrowEnabled)throw new Error('The send arrow is not visible and enabled. Nothing was clicked; prepare the prompt and retry this step.');
          const clicked=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_CLICK_SEND_ARROW'}) as {clicked?:boolean;error?:string}|undefined;
          if(clicked?.clicked!==true)throw new Error(clicked?.error||'ChatGPT did not confirm a click on the send arrow. No other submission method was attempted.');
          const accepted=await waitForTestSnapshot(id,value=>value.composerEmpty&&value.userMessageCount>before.userMessageCount,20_000,true);
          const proof=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_VERIFY_LAST_USER_MESSAGE',conversationUrl:accepted.conversationUrl,dedupeKey:promptKey,text:prompt,allowNewConversation:true}) as {confirmed?:boolean;reason?:string}|undefined;
          if(proof?.confirmed!==true)throw new Error(`The arrow was clicked once, but the exact test prompt is not confirmed as the latest user message (${proof?.reason??'no proof returned'}). No retry or resend was attempted; the test chat was kept for inspection.`);
          markTestMilestone('submitted');
          passTestStep(6,'Clicked ChatGPT’s enabled arrow once; the composer cleared, a new user message appeared, and the exact prompt was verified.');
        }
      }
      if(testCheckpoint.current<=7&&stepLimit>=7){
        beginTestStep(7,'Waiting for generation, the expected reply, and the return to idle…');
        let reply=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
        if(!reply)throw new Error('Could not inspect the test chat after submission.');
        if(!(reply.state==='IDLE'&&reply.composerEmpty&&reply.voiceEnabled&&reply.latestReplyFirstLine.toLowerCase().includes('agentsync test received'))){
          if(reply.state==='WORKING')markTestMilestone('stop');
          reply=await waitForTestSnapshot(id,value=>value.state==='IDLE'&&value.composerEmpty&&value.voiceEnabled&&value.latestReplyFirstLine.toLowerCase().includes('agentsync test received'),120_000,true,value=>{if(value.state==='WORKING')markTestMilestone('stop');});
        }
        markTestMilestone('voice-again');
        passTestStep(7,`Reply verified; ChatGPT returned to idle with voice enabled. First line: “${reply.latestReplyFirstLine}”`);
      }
      if(testCheckpoint.current<=8&&stepLimit>=8){
        beginTestStep(8,'Verifying the expected reply again before deleting the temporary test chat…');
        const final=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
        if(!final||final.state!=='IDLE'||!final.latestReplyFirstLine.toLowerCase().includes('agentsync test received'))throw new Error('Deletion was withheld: the expected reply is not currently visible in an idle test chat.');
        if(testStopRequested.current)throw new Error('Stop requested before deletion; the test chat was kept for inspection.');
        const deleted=await browser.tabs.sendMessage(id,{type:'AGENTSYNC_TEST_DELETE_CHAT',confirmDelete:true}) as {performed?:boolean;conversationChanged?:boolean;notice?:string;error?:string}|undefined;
        if(deleted?.error||deleted?.performed!==true||deleted.conversationChanged!==true)throw new Error(deleted?.error||'Reply passed, but ChatGPT did not confirm deletion. The test chat was kept for inspection.');
        passTestStep(8,'Expected reply rechecked; ChatGPT confirmed the temporary test chat was deleted.');
      }
      if(testCheckpoint.current>8){
        setTestRunPhase('PASSED');setTestRunStep(testRunSteps.length);setTestRunMessage('All checks passed. The expected reply was confirmed and the temporary test chat was deleted.');
        setChatActionStatus('Test passed. Expected reply received; temporary chat deleted.');testContext.current=undefined;
      }else{
        setTestRunPhase('PAUSED');setTestRunStep(testCheckpoint.current);setTestRunMessage(`Step ${stepLimit+1} of ${testRunSteps.length} completed. Review the result, then click Next step to continue.`);
      }
    }catch(e){
      const reason=e instanceof Error?e.message:String(e);
      if(testStopRequested.current){
        const detail=`Stopped at “${testRunSteps[testCheckpoint.current]??'test cleanup'}” by request. ${testStopDetail.current}${reason==='Stop requested.'?' No later test steps were run.':` ${reason}`}`;
        const metric=testStepMetrics.current[testCheckpoint.current];if(metric?.startedAt){metric.durationMs+=Date.now()-metric.startedAt;metric.startedAt=undefined;}
        setTestRunPhase('STOPPED');setTestRunMessage(detail);setTestRunResults(old=>old.map((item,i)=>i===testCheckpoint.current?{status:'stopped',detail}:item));
      }else{
        const detail=`Stopped at “${testRunSteps[testCheckpoint.current]??'test cleanup'}”: ${reason}`;
        const metric=testStepMetrics.current[testCheckpoint.current];if(metric?.startedAt){metric.durationMs+=Date.now()-metric.startedAt;metric.startedAt=undefined;}
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
      setRailActionStatus(`${mode==='CHAT'?'Chat':'Work'} mode selected.`);
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
      setRailActionStatus(`${effort[0]}${effort.slice(1).toLowerCase()} effort selected.`);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setControlBusy(false);}
  }
  async function changeComposerText(clear:boolean){
    if(tabId===undefined)return;
    setControlBusy(true);setError('');setComposerTestStatus('');
    try{
      if(clear)manualDemoKey.current=undefined;
      else if(!manualDemoKey.current)manualDemoKey.current=`test_${crypto.randomUUID()}`;
      const text=clear?'':`AgentSync demo: please reply with “Demo received.”\n\nAgentSync delivery ID: ${manualDemoKey.current}`;
      const result=await browser.tabs.sendMessage(tabId,{type:clear?'AGENTSYNC_TEST_CLEAR_COMPOSER':'AGENTSYNC_TEST_SET_COMPOSER_TEXT',text}) as {confirmed?:boolean;error?:string}|undefined;
      if(result?.error||result?.confirmed!==true)throw new Error(result?.error||'ChatGPT did not confirm the composer change.');
      const snapshot=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
      if(snapshot)setProbe(snapshot);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setControlBusy(false);}
  }
  async function submitCurrentPrompt(){
    if(tabId===undefined)return;
    setControlBusy(true);setError('');setComposerTestStatus('');
    try{
      const snapshot=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
      if(!snapshot?.composerVisible||snapshot.composerEmpty)throw new Error('The composer is empty. Nothing was submitted.');
      if(!snapshot.arrowVisible||!snapshot.arrowEnabled)throw new Error('The send arrow is not visible and enabled yet. Nothing was sent. Wait until ChatGPT shows the arrow, then try again.');
      const result=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_CLICK_SEND_ARROW'}) as {clicked?:boolean;error?:string}|undefined;
      if(result?.error||result?.clicked!==true)throw new Error(result?.error||'ChatGPT did not confirm the send-arrow click.');
      const updated=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
      if(updated){setProbe(updated);setComposerTestStatus(updated.composerEmpty?'Clicked the send arrow. ChatGPT cleared the composer.':'Clicked the send arrow. The composer still has text; check ChatGPT before trying again.');}
    }catch(e){setComposerTestStatus(e instanceof Error?e.message:String(e));}finally{setControlBusy(false);}
  }
  async function activateStatusRailIcon(icon:string){
    if(!probe)return;
    if(icon==='link'){
      if(!statusUrlValid)return;
      await copyStatusRailText(statusUrl,'Current ChatGPT URL');
      return;
    }
    if(icon==='mode-chat'||icon==='mode-work'||icon==='mode'){
      await setMode(probe.composerMode==='CHAT'?'WORK':'CHAT');
      return;
    }
    if(icon.startsWith('effort-')){
      const current=probe.effort==='LOW'?0:probe.effort==='MEDIUM'?1:probe.effort==='HIGH'?2:-1;
      await setEffort((current+1)%3);
      return;
    }
    if(icon==='user-message'){
      if(!submitted||!probe.latestUserMessage)return;
      await copyStatusRailText(probe.latestUserMessage,`Latest submitted message${probe.latestUserMessageTruncated?' (first 40,000 characters)':''}`);
      return;
    }
    if(icon==='assistant-message'){
      if(!probe.latestReplyText)return;
      await copyStatusRailText(probe.latestReplyText,`Latest assistant response${probe.latestReplyTruncated?' (first 40,000 characters)':''}`);
    }
  }
  async function copyStatusRailText(text:string,label:string){
    try{
      if(!await browser.permissions.request({permissions:['clipboardWrite']}))throw new Error('Clipboard permission was not granted.');
      await navigator.clipboard.writeText(text);setRailActionStatus(`${label} copied.`);
    }catch(e){setRailActionStatus(`Could not copy ${label.toLowerCase()}: ${e instanceof Error?e.message:String(e)}`);}
  }
  async function copyTestReport(){
    const elapsedMs=testRunStartedAt.current?Date.now()-testRunStartedAt.current:0;
    const lines=[
      'AgentSync ChatGPT test report',
      `Outcome: ${testRunPhase}`,
      `Generated: ${new Date().toISOString()}`,
      `Elapsed: ${(elapsedMs/1000).toFixed(1)} seconds`,
      `Position: ${testRunPhase==='PASSED'?'all steps complete':testRunPhase==='PAUSED'?`ready for step ${testCheckpoint.current+1} of ${testRunSteps.length}`:testRunPhase==='RUNNING'?`running ${testRunSteps[testRunStep]??'a test step'}`:testRunSteps[testCheckpoint.current]??'unknown'}`,
      `Reason / summary: ${testRunMessage||error||'No run summary recorded.'}`,
      `Test tab ID: ${testContext.current?.tabId??tabId??'unknown'}`,
      `Delivery ID: ${testContext.current?.promptKey??'none'}`,
      '',
      'Steps:'
    ];
    testRunSteps.forEach((step,index)=>{
      const metric=testStepMetrics.current[index];const result=testRunResults[index];
      const duration=(metric?.durationMs??0)+(metric?.startedAt?Date.now()-metric.startedAt:0);
      lines.push(`${index+1}. ${step} | status: ${result?.status??'waiting'} | attempts: ${metric?.attempts??0} | elapsed: ${(duration/1000).toFixed(1)}s | ${result?.detail??'Not started'}`);
    });
    lines.push('','Retries and recovery events:');
    if(testRetryEvents.current.length)for(const event of testRetryEvents.current)lines.push(`- ${event.at} | ${event.step} | ${event.detail}`);else lines.push('- None recorded.');
    lines.push('','Observed ChatGPT state:');
    if(probe){
      lines.push(`URL: ${probe.href}`,`Conversation URL detected: ${probe.hasConversationUrl?'yes':'no'}`,`Page loaded: ${probe.pageLoaded?'yes':'no'}`,`State: ${probe.state}`,`Composer: ${probe.composerVisible?(probe.composerEmpty?'empty':`contains ${probe.composerLength} characters`):'not detected'}`,`Mode: ${probe.composerMode}`,`Effort: ${probe.effort}`,`Voice: visible=${probe.voiceVisible}, enabled=${probe.voiceEnabled}`,`Arrow: visible=${probe.arrowVisible}, enabled=${probe.arrowEnabled}`,`Stop: visible=${probe.stopVisible}, enabled=${probe.stopEnabled}`,`User message count: ${probe.userMessageCount}`,`Latest reply first line: ${probe.latestReplyFirstLine||'(none detected)'}`,`Last snapshot: ${probe.observedAt}`);
    }else lines.push('No ChatGPT snapshot available.');
    lines.push('','Observed sequence:',...(sequence.length?sequence.map(item=>`- ${item.at}: ${item.stage}`):['- No milestones recorded.']));
    try{await navigator.clipboard.writeText(lines.join('\n'));setChatActionStatus('Test report copied to clipboard.');}
    catch(e){setError(`Could not copy the test report: ${e instanceof Error?e.message:String(e)}`);}
  }
  useEffect(()=>{
    if(tabId===undefined)return;
    let stopped=false,timer:number|undefined,chatModeChecked=false;
    const poll=async()=>{
      try{
        const tab=await browser.tabs.get(tabId);
        const rawUrl=tab.pendingUrl||tab.url||'';setObservedTabUrl(rawUrl);setActiveTabLoading(tab.status!=='complete');
        let currentRoute='';
        try{currentRoute=validateChatGPTTabUrl(rawUrl).url;setObservedTabUrlValid(true);}catch{setObservedTabUrlValid(false);setProbe(undefined);throw new Error(`The watched tab URL is not an approved ChatGPT page: ${rawUrl||'(no URL)'}`);}
        if(tab.status!=='complete')setProbe(undefined);
        if(tab.status==='complete'){
          await browser.scripting.executeScript({target:{tabId},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
          const tabUrl=new URL(rawUrl);
          if(!chatModeChecked&&tabUrl.pathname==='/'){
            chatModeChecked=true;
            const mode=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_ENSURE_CHAT_MODE'}) as {confirmed?:boolean;error?:string}|undefined;
            if(mode?.error||mode?.confirmed!==true)throw new Error(mode?.error||'ChatGPT did not confirm Chat mode.');
          }
          let value=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
          if(value&&clearComposerOnNewChat.current){
            if(value.hasConversationUrl)clearComposerOnNewChat.current=false;
            else if(value.composerVisible){
              if(!value.composerEmpty){
                const cleared=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_CLEAR_COMPOSER'}) as {confirmed?:boolean;error?:string}|undefined;
                if(cleared?.error||cleared?.confirmed!==true)throw new Error(cleared?.error||'Could not clear the new chat composer.');
                value=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
              }
              clearComposerOnNewChat.current=false;
            }
          }
          if(value&&!stopped){
            setActiveTabLoading(!value.pageLoaded);
            const previousRoute=lastWatchedRoute.current;
            const changedToNewChat=Boolean(previousRoute&&previousRoute!==currentRoute&&currentRoute==='https://chatgpt.com/');
            const changedConversation=Boolean(previousRoute&&previousRoute!==currentRoute&&/^https:\/\/chatgpt\.com\/c\//.test(previousRoute)&&/^https:\/\/chatgpt\.com\/c\//.test(currentRoute));
            if(changedToNewChat||changedConversation){setBaseline(value.userMessageCount);testSubmittedUntil.current=0;if(changedToNewChat)clearComposerOnNewChat.current=true;}
            lastWatchedRoute.current=currentRoute;
            if(previousTestComposerText.current&&value.composerEmpty&&value.userMessageCount>previousTestUserCount.current)testSubmittedUntil.current=Date.now()+2500;
            previousTestComposerText.current=!value.composerEmpty;previousTestUserCount.current=value.userMessageCount;
            const current=testSubmittedUntil.current>Date.now()?{...value,state:'SUBMITTED' as const}:value;
            latestProbe.current=current;setProbe(current);if(!effortTouched.current)setEffortDraft(value.effort==='LOW'?0:value.effort==='HIGH'?2:1);setBaseline(old=>old??value.userMessageCount);if(pollError.current){pollError.current=false;setError('');}
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
  const statusUrl=probe?.href||observedTabUrl;
  let statusUrlKind:'new chat'|'conversation'|'unknown'='unknown';
  let statusUrlValid=observedTabUrlValid;
  if(statusUrl){try{statusUrlKind=validateChatGPTTabUrl(statusUrl).kind;statusUrlValid=true;}catch{statusUrlValid=false;}}
  const primaryButtonEnabled=probe?(probe.arrowVisible?probe.arrowEnabled:probe.stopVisible?probe.stopEnabled:probe.voiceVisible?probe.voiceEnabled:false):undefined;
  const statusItems=[
    {icon:'link',label:statusUrlValid?'URL valid · click to copy':'URL valid',state:statusUrlValid===true?'yes':'no',detail:statusUrlValid===undefined?'No active tab URL has been checked.':statusUrlValid?`${statusUrl} · click to copy`:'This URL is not an approved ChatGPT URL.'},
    {icon:'chat',label:'New chat URL',state:statusUrlKind==='new chat'?'yes':'no',detail:statusUrlKind==='unknown'?'Chat URL type is not known.':statusUrlKind==='new chat'?'The URL is chatgpt.com without a conversation ID.':'A conversation ID is present in the URL.'},
    {icon:'send',label:'Send arrow',state:probe?.arrowVisible?'yes':'no',detail:!probe?'Waiting for a page snapshot.':probe.arrowVisible?`Visible · ${probe.arrowEnabled?'enabled':'disabled'}`:'Not visible'},
    {icon:'mic',label:'Voice control',state:probe?.voiceVisible?'yes':'no',detail:!probe?'Waiting for a page snapshot.':probe.voiceVisible?`Visible · ${probe.voiceEnabled?'enabled':'disabled'}`:'Not visible'},
    {icon:'stop',label:'Stop control',state:probe?.stopVisible?'yes':'no',detail:!probe?'Waiting for a page snapshot.':probe.stopVisible?`Visible · ${probe.stopEnabled?'enabled':'disabled'}`:'Not visible'},
    {icon:'loading',label:'Page loading',state:activeTabLoading||!probe?.pageLoaded?'loading':'ready',detail:activeTabLoading?'The active tab is still loading.':probe?.pageLoaded?'The active page has finished loading.':statusUrl?'Waiting to confirm the page is ready.':'No active tab is selected.'},
    {icon:'ready',label:'Page ready',state:probe?.pageLoaded&&probe.composerVisible?'yes':'no',detail:!probe?'Waiting for the page snapshot.':probe.pageLoaded&&probe.composerVisible?'Page loaded and composer detected.':`Page loaded: ${probe.pageLoaded?'yes':'no'} · composer: ${probe.composerVisible?'visible':'not visible'}`},
    {icon:'composer',label:'Composer',state:!probe||!probe.composerVisible?'unknown':'yes',detail:!probe?'Waiting for a page snapshot.':probe.composerVisible?probe.composerEmpty?'Visible · empty':`Visible · ${probe.composerLength} characters`:'Not detected'},
    {icon:probe?.composerMode==='CHAT'?'mode-chat':probe?.composerMode==='WORK'?'mode-work':'mode',label:probe?.composerMode==='CHAT'?'Chat mode · click to switch':probe?.composerMode==='WORK'?'Work mode · click to switch':'Mode · click to set Chat',state:probe&&probe.composerMode!=='UNKNOWN'?'yes':'unknown',detail:probe?.composerMode==='CHAT'?'Chat mode · click to switch to Work':probe?.composerMode==='WORK'?'Work mode · click to switch to Chat':'Mode not detected · click to select Chat'},
    {icon:probe?.effort==='LOW'?'effort-low':probe?.effort==='MEDIUM'?'effort-medium':probe?.effort==='HIGH'?'effort-high':'effort-unknown',label:probe?.effort&&probe.effort!=='UNKNOWN'?`${probe.effort[0]}${probe.effort.slice(1).toLowerCase()} effort · click to cycle`:'Effort · click to set Low',state:probe&&probe.effort!=='UNKNOWN'?'yes':'unknown',detail:probe&&probe.effort!=='UNKNOWN'?`${probe.effort[0]}${probe.effort.slice(1).toLowerCase()} effort · click to cycle Low, Medium, High`:'Effort not detected · click to set Low'},
    {icon:'button',label:'Action button',state:primaryButtonEnabled?'yes':'no',detail:primaryButtonEnabled===undefined?'No action button is enabled.':`${probe?.arrowVisible?'Arrow':probe?.stopVisible?'Stop':probe?.voiceVisible?'Voice':'No action'} · ${primaryButtonEnabled?'enabled':'disabled'}`},
    {icon:'user-message',label:submitted?'Submitted message · click to copy':'User message submitted',state:submitted?'yes':'no',detail:submitted?`Latest detected user message:\n${probe?.latestUserMessage||'(message text not detected)'}`:'No newly submitted user message detected since monitoring began.'},
    {icon:'assistant-message',label:probe?.latestReplyFirstLine?'Response · click to copy':'Assistant response detected',state:probe?.latestReplyFirstLine?'yes':'no',detail:probe?.latestReplyFirstLine?`Latest response, first line:\n${probe.latestReplyFirstLine}`:'No assistant response detected yet.'}
  ] as const;
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
  return <section className="chat-test-wizard" role="tabpanel" id="panel-chatgpt" aria-labelledby="tab-chatgpt">
    {statusUrl&&<aside className="chat-status-rail" aria-label="Live active tab status">{statusItems.map(item=>{
      const isMode=item.icon==='mode-chat'||item.icon==='mode-work'||item.icon==='mode';
      const isEffort=item.icon.startsWith('effort-');
      const isCopyMessage=item.icon==='user-message'&&submitted&&Boolean(probe?.latestUserMessage);
      const isCopyReply=item.icon==='assistant-message'&&Boolean(probe?.latestReplyText);
      const clickable=(item.icon==='link'&&statusUrlValid===true)||isMode||isEffort||isCopyMessage||isCopyReply;
      const disabled=controlBusy||!clickable||((isMode||isEffort)&&!probe);
      const title=`${item.label}: ${item.detail}`;
      const content=<><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={statusIconPaths[item.icon]}/></svg><span className="chat-status-rail-label">{item.label}</span></>;
      return clickable?<button key={item.label} type="button" className="chat-status-rail-item" data-state={item.state} data-icon={item.icon} title={title} aria-label={title} disabled={disabled} onClick={()=>void activateStatusRailIcon(item.icon)}>{content}</button>:<span key={item.label} className="chat-status-rail-item" data-state={item.state} data-icon={item.icon} title={title} aria-label={title} role="img" tabIndex={0}>{content}</span>;
    })}{railActionStatus&&<span className="chat-status-rail-action" role="status">{railActionStatus}</span>}</aside>}
    <header className="chat-test-header">
      <div><p className="eyebrow">CHATGPT</p><h2>ChatGPT test</h2><p>Run the test one step at a time. Review each result before continuing.</p></div>
      <div className="chat-test-toolbar">
        <button type="button" className="secondary-button" disabled={busy||controlBusy||testRunPhase==='RUNNING'} onClick={()=>void openNew()}>{busy?'Opening…':'Open new chat'}</button>
        <button type="button" className="secondary-button" disabled={busy||controlBusy||testRunPhase==='RUNNING'} onClick={()=>void useActiveTab()}>Use active tab</button>
      </div>
      {tabSelectionStatus&&<p className={`chat-test-tab-validation ${tabSelectionStatus.startsWith('URL accepted')||tabSelectionStatus.startsWith('Using validated')?'is-valid':'is-invalid'}`} role="status">{tabSelectionStatus}</p>}
    </header>
    <section className="panel chat-test-progress" aria-live="polite">
      <div className="chat-test-progress-heading"><div><p className="eyebrow">TEST WIZARD</p><h3>Step-by-step test</h3><p>{testRunPhase==='IDLE'?'Start opens a temporary ChatGPT chat. Each click runs one step.':testRunPhase==='PAUSED'?`Ready for step ${testCheckpoint.current+1} of ${testRunSteps.length}.`:testRunPhase==='PASSED'?'All steps passed.':'Follow the current step and review its status.'}</p></div>
        <div className="chat-test-primary-actions">
          {testRunPhase==='RUNNING'?<button type="button" className="danger-button" onClick={()=>void stopOneClickTest()}>Stop</button>:<>
            <button type="button" disabled={busy||controlBusy||((testRunPhase==='FAILED'||testRunPhase==='STOPPED')&&!testContext.current)} onClick={()=>void runOneClickTest(testRunPhase==='IDLE'?'START':testRunPhase==='PASSED'?'RESTART':'RESUME')}>{testRunPhase==='IDLE'?'Start test':testRunPhase==='PAUSED'?'Next step':testRunPhase==='PASSED'?'Start new test':testContext.current?'Retry this step':'Restart test'}</button>
            <button type="button" className="secondary-button" disabled={busy||controlBusy||testRunPhase==='FAILED'||testRunPhase==='STOPPED'} onClick={()=>void runOneClickTest(testRunPhase==='IDLE'?'START':testRunPhase==='PAUSED'?'RESUME':'RESTART',true)}>{testRunPhase==='PAUSED'?'Run remaining steps':testRunPhase==='PASSED'?'Run test again':'Auto test'}</button>
          </>}
          {testRunPhase!=='IDLE'&&testRunPhase!=='PASSED'&&testRunPhase!=='RUNNING'&&<button type="button" className="secondary-button" disabled={busy||controlBusy} onClick={()=>void runOneClickTest('RESTART')}>Restart</button>}
        </div>
      </div>
      {testRunMessage&&<p className={`chat-test-run-message ${testRunPhase==='FAILED'||testRunPhase==='STOPPED'?'error':testRunPhase==='PASSED'?'notice':''}`} role="status">{testRunMessage}</p>}
      <ol className="chat-test-sequence">{testRunSteps.map((step,index)=>{const result=testRunResults[index]??{status:'waiting' as const,detail:'Not started'};const nextStep=testRunPhase==='PAUSED'&&index===testCheckpoint.current;return <li key={step} data-reached={result.status==='passed'} data-active={result.status==='running'||nextStep} data-failed={result.status==='failed'||result.status==='stopped'}><span>{result.status==='passed'?'✓':result.status==='failed'?'!':result.status==='stopped'?'Ⅱ':result.status==='running'?'…':index+1}</span><div><strong>{step}</strong><small>{nextStep?'Up next · ':''}{result.detail}</small></div></li>;})}</ol>
      {testCheckpoint.current>0&&testRunPhase!=='RUNNING'&&<button type="button" className="secondary-button" onClick={()=>void copyTestReport()}>Copy test report</button>}
    </section>
    {error&&<p className="error" role="alert">{error}</p>}
    {!probe?<section className="panel chat-test-waiting"><strong>Waiting for ChatGPT</strong><p>Open a new chat or watch the active ChatGPT tab to begin monitoring.</p></section>:<>
      <section className="panel chat-test-current">
        <div className="chat-test-current-heading"><span className={`chat-state-dot state-${probe.state.toLowerCase()}`}/><div><p className="eyebrow">CURRENT CHAT</p><h3>{savedAgent?.chatName??(savedAgent?`A${savedAgent.number} · ${savedAgent.role}`:probe.hasConversationUrl?'Unregistered conversation':'New chat')}</h3><small>{probe.state.replace('_',' ')} · {probe.hasConversationUrl?'conversation URL detected':'new-chat URL'}</small></div></div>
        <p className="chat-test-state-explanation">{explanations[probe.state]}</p>
        <div className="chat-test-summary-grid"><div><span>Composer</span><strong>{!probe.composerVisible?'Not found':probe.composerEmpty?'Empty':`Text · ${probe.composerLength} chars`}</strong></div><div><span>Mode</span><strong>{probe.composerMode==='UNKNOWN'?'Unknown':probe.composerMode==='CHAT'?'Chat':'Work'}</strong></div><div><span>Effort</span><strong>{probe.effort==='UNKNOWN'?'Unknown':`${probe.effort[0]}${probe.effort.slice(1).toLowerCase()}`}</strong></div><div><span>Voice</span><strong>{probe.voiceVisible?(probe.voiceEnabled?'Ready':'Disabled'):'Hidden'}</strong></div></div>
        <p className="chat-test-current-reply"><strong>Latest reply:</strong> {probe.latestReplyFirstLine||'No assistant reply yet.'}</p>
        <small className="chat-test-url">{probe.href}</small>
        {probe.hasConversationUrl&&<a className="chat-test-open-link" href={probe.conversationUrl} target="_blank" rel="noreferrer">Open this conversation</a>}
      </section>
      <section className="panel chat-test-composer-quick"><div><h3>Composer test</h3><p>Post a labeled demo prompt, submit the current composer text with ChatGPT’s arrow, or clear it.</p></div><pre className="chat-test-composer-preview">{probe.composerText?`${probe.composerText.slice(0,220)}${probe.composerText.length>220?'…':''}`:'Composer is empty.'}</pre><div className="chat-test-composer-buttons"><button type="button" disabled={controlBusy||!probe.composerVisible||!probe.composerEmpty} onClick={()=>void changeComposerText(false)}>Post demo text</button><button type="button" className="secondary-button" disabled={controlBusy||!probe.composerVisible||probe.composerEmpty} onClick={()=>void changeComposerText(true)}>Clear composer</button><button type="button" className="secondary-button" disabled={controlBusy||!probe.composerVisible||probe.composerEmpty||!probe.arrowVisible||!probe.arrowEnabled} onClick={()=>void submitCurrentPrompt()}>Submit prompt</button></div><small className="chat-test-control-note">Submit clicks only the visible, enabled ChatGPT send arrow. It does not replace the composer text or change chat settings.</small>{composerTestStatus&&<p className={composerTestStatus.includes('composer is now empty')?'notice':'error'} role="status">{composerTestStatus}</p>}</section>
      <details className="panel chat-test-details">
        <summary>Controls and diagnostics</summary>
        <p className="chat-test-details-intro">Optional tools for checking ChatGPT controls and inspecting the detected text.</p>
        <section className="chat-test-detail-block"><h4>Mode and effort</h4><p>Select the ChatGPT composer mode and effort for the watched tab.</p><div className="chat-test-controls" role="group" aria-label="Composer mode controls"><button type="button" aria-pressed={probe.composerMode==='CHAT'} disabled={controlBusy||probe.composerMode==='CHAT'} onClick={()=>void setMode('CHAT')}>Chat</button><button type="button" className="secondary-button" aria-pressed={probe.composerMode==='WORK'} disabled={controlBusy||probe.composerMode==='WORK'} onClick={()=>void setMode('WORK')}>Work</button></div><label className="chat-test-effort">Effort: <strong>{(['Low','Medium','High'] as const)[effortDraft]}</strong><input type="range" min="0" max="2" step="1" value={effortDraft} aria-label="ChatGPT effort" disabled={controlBusy} onChange={e=>{effortTouched.current=true;setEffortDraft(Number(e.currentTarget.value));}}/><span className="chat-test-effort-labels"><span>Low</span><span>Medium</span><span>High</span></span></label><button type="button" className="secondary-button" disabled={controlBusy||probe.effort===(['LOW','MEDIUM','HIGH'] as const)[effortDraft]} onClick={()=>void setEffort(effortDraft)}>{controlBusy?'Applying…':'Apply effort'}</button></section>
        {probe.hasConversationUrl&&<section className="chat-test-detail-block"><h4>Chat actions</h4><p>Open the menu to inspect it, or test Archive and Delete on this conversation.</p><div className="chat-test-composer-buttons"><button type="button" className="secondary-button" disabled={controlBusy} onClick={()=>void testChatAction('OPEN')}>Open menu</button><button type="button" className="secondary-button" disabled={controlBusy} onClick={()=>void testChatAction('ARCHIVE')}>Archive</button><button type="button" className="danger-button" disabled={controlBusy} onClick={()=>void testChatAction('DELETE')}>Delete</button></div></section>}
        {chatActionStatus&&<p className="notice" role="status">{chatActionStatus}</p>}
        <section className="chat-test-detail-block"><h4>Detected controls</h4><dl className="chat-test-facts"><div><dt>Page loaded</dt><dd>{probe.pageLoaded?'Yes':'No'}</dd></div><div><dt>Voice</dt><dd>{probe.voiceVisible?(probe.voiceEnabled?'Visible · enabled':'Visible · disabled'):'Not visible'}</dd></div><div><dt>Send arrow</dt><dd>{probe.arrowVisible?(probe.arrowEnabled?'Visible · enabled':'Visible · disabled'):'Not visible'}</dd></div><div><dt>Stop / pause</dt><dd>{probe.stopVisible?(probe.stopEnabled?'Stop enabled':'Stop disabled'):probe.pauseVisible?'Pause visible':'Not visible'}</dd></div><div><dt>Prompt submitted</dt><dd>{submitted?'Detected · composer cleared after a new user message':'Not detected'}</dd></div><div><dt>Reply copied</dt><dd>{probe.latestReplyCopyStatus==='COPIED'?'Copied':probe.latestReplyCopyStatus==='COPY_CLICKED'?'Copy clicked · awaiting confirmation':'Not copied'}</dd></div></dl><p className="chat-test-url">Tab: {probe.href}</p></section>
        <section className="chat-test-detail-block"><h4>Composer text</h4><pre className="chat-test-content">{probe.composerText||'(empty)'}{probe.composerTextTruncated?'\n… text clipped at 5,000 characters':''}</pre></section>
        <section className="chat-test-detail-block"><h4>Observed flow</h4><ol className="chat-test-sequence">{stages.map((stage,index)=>{const reached=sequence[index]?.stage===stage;const help=stage==='voice'||stage==='voice-again'?'Empty composer and enabled voice control':stage==='arrow'?'Typed prompt and enabled arrow':stage==='submitted'?'Composer cleared and user message appeared':'Generation started and stop control appeared';return <li key={`${stage}-${index}`} data-reached={reached}><span>{reached?'✓':index+1}</span><div><strong>{names[stage]}</strong><small>{reached?sequence[index].at:help}</small></div></li>;})}</ol><button type="button" className="secondary-button" disabled={!tabId||controlBusy} onClick={resetSequence}>Reset observed flow</button></section>
      </details>
    </>}
  </section>;
}
