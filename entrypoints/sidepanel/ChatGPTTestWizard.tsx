import {useEffect,useRef,useState} from 'react';
import {browser} from 'wxt/browser';
import {chatAdapter} from '../../src/chat-adapter';

type Probe={href:string;hasConversationUrl:boolean;conversationUrl:string;pageLoaded:boolean;composerVisible:boolean;composerEmpty:boolean;composerLength:number;voiceVisible:boolean;voiceEnabled:boolean;arrowVisible:boolean;arrowEnabled:boolean;stopVisible:boolean;stopEnabled:boolean;pauseVisible:boolean;pauseEnabled:boolean;userMessageCount:number;state:'LOADING'|'NEW'|'IDLE'|'WORKING'|'PROMPT_READY'|'WAITING';observedAt:string};
type Milestone='voice'|'arrow'|'stop'|'voice-again';
const stages:Milestone[]=['voice','arrow','stop','voice-again'];
const names:Record<Milestone,string>={voice:'Voice ready',arrow:'Arrow ready',stop:'Stop detected', 'voice-again':'Voice returned'};
const explanations:Record<Probe['state'],string>={
  LOADING:'The ChatGPT document is still loading. The wizard is waiting for its composer controls.',
  NEW:'The URL is chatgpt.com with no /c/ conversation, and the empty composer has an enabled voice button. This is a ready new chat.',
  IDLE:'The URL contains a /c/ conversation, and the empty composer has an enabled voice button. This is a ready idle chat.',
  WORKING:'The stop control is enabled. ChatGPT is generating a response.',
  PROMPT_READY:'The composer contains text and its enabled arrow is visible. The prompt is ready to submit, even if another status icon is present.',
  WAITING:'The page has not reached a recognized ready state. Check the composer and wait for its action button to become enabled.'
};
export default function ChatGPTTestWizard(){
  const [tabId,setTabId]=useState<number>(),[probe,setProbe]=useState<Probe>(),[error,setError]=useState(''),[sequence,setSequence]=useState<{stage:Milestone;at:string}[]>([]),[baseline,setBaseline]=useState<number>(),[busy,setBusy]=useState(false);
  const nextStage=useRef(0);
  async function watchTab(id:number){
    setBusy(true);setError('');setTabId(undefined);setProbe(undefined);setSequence([]);setBaseline(undefined);nextStage.current=0;
    try{
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access was not granted.');
      const tab=await browser.tabs.get(id);
      if(!tab.url?.startsWith('https://chatgpt.com/'))throw new Error('Choose a ChatGPT tab at chatgpt.com.');
      setTabId(id);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  async function openNew(){
    setBusy(true);setError('');setProbe(undefined);setSequence([]);setBaseline(undefined);nextStage.current=0;
    try{
      if(!await chatAdapter.ensureChatAccess())throw new Error('ChatGPT site access was not granted.');
      const tab=await browser.tabs.create({url:'https://chatgpt.com/',active:true});
      if(tab.id===undefined)throw new Error('Chrome did not return the new ChatGPT tab.');
      setTabId(tab.id);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  useEffect(()=>{
    if(tabId===undefined)return;
    let stopped=false,timer:number|undefined;
    const poll=async()=>{
      try{
        const tab=await browser.tabs.get(tabId);
        if(!tab.url?.startsWith('https://chatgpt.com/'))throw new Error('The watched tab left chatgpt.com.');
        if(tab.status==='complete'){
          await browser.scripting.executeScript({target:{tabId},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
          const value=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_TEST_SNAPSHOT'}) as Probe|undefined;
          if(value&&!stopped){
            setProbe(value);setBaseline(old=>old??value.userMessageCount);setError('');
            const next=stages[nextStage.current];
            const reached=next==='voice'||next==='voice-again'?(value.state==='NEW'||value.state==='IDLE'):next==='arrow'?value.state==='PROMPT_READY':value.state==='WORKING';
            if(reached){setSequence(old=>[...old,{stage:next,at:new Date().toLocaleTimeString()}]);nextStage.current+=1;}
          }
        }
      }catch(e){if(!stopped)setError(e instanceof Error?e.message:String(e));}
      if(!stopped)timer=window.setTimeout(()=>void poll(),600);
    };
    void poll();return()=>{stopped=true;if(timer!==undefined)clearTimeout(timer);};
  },[tabId]);
  function resetSequence(){nextStage.current=0;setSequence([]);setBaseline(probe?.userMessageCount);}
  const submitted=Boolean(probe&&baseline!==undefined&&probe.userMessageCount>baseline&&probe.composerEmpty);
  const complete=sequence.length===4&&sequence[3]?.stage==='voice-again';
  return <section className="chat-test-wizard" role="tabpanel" id="panel-chatgpt" aria-labelledby="tab-chatgpt">
    <div className="panel chat-test-intro"><p className="eyebrow">CHATGPT DIAGNOSTICS</p><h2>Test wizard</h2><p>Open a new ChatGPT tab, type a short test prompt there, and submit it manually. This panel watches the visible controls and records the voice → arrow → stop → voice sequence.</p>
      <div className="buttons"><button type="button" disabled={busy} onClick={()=>void openNew()}>{busy?'Opening…':'Open new chat'}</button><button type="button" className="secondary-button" disabled={busy} onClick={async()=>{const [tab]=await browser.tabs.query({active:true,currentWindow:true});if(tab?.id!==undefined)void watchTab(tab.id);else setError('No active browser tab was found.');}}>Watch active tab</button><button type="button" className="secondary-button" disabled={!tabId} onClick={resetSequence}>Reset sequence</button></div>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    {!probe?<section className="panel"><strong>Waiting for ChatGPT</strong><p>Open a new chat or watch an active ChatGPT tab. The wizard needs permission to inspect the tab’s composer buttons and URL.</p></section>:<>
      <section className="panel"><div className="chat-test-state"><span className={`chat-state-dot state-${probe.state.toLowerCase()}`}/><div><p className="eyebrow">CURRENT STATE</p><h3>{probe.state.replace('_',' ')}</h3></div></div><p>{explanations[probe.state]}</p><dl className="chat-test-facts">
        <div><dt>Page loaded</dt><dd>{probe.pageLoaded?'Yes':'No'}</dd></div><div><dt>Conversation URL</dt><dd>{probe.hasConversationUrl?'Yes':'No — new-chat URL'}{probe.hasConversationUrl&&<a href={probe.conversationUrl} target="_blank" rel="noreferrer">Open conversation</a>}</dd></div>
        <div><dt>Composer</dt><dd>{!probe.composerVisible?'Not found':probe.composerEmpty?'Empty':`Has text (${probe.composerLength} characters)`}</dd></div>
        <div><dt>Voice button</dt><dd>{probe.voiceVisible?probe.voiceEnabled?'Visible · enabled':'Visible · disabled':'Not visible'}</dd></div><div><dt>Arrow button</dt><dd>{probe.arrowVisible?probe.arrowEnabled?'Visible · enabled':'Visible · disabled':'Not visible'}</dd></div>
        <div><dt>Stop button</dt><dd>{probe.stopVisible?probe.stopEnabled?'Visible · enabled':'Visible · disabled':'Not visible'}</dd></div><div><dt>Pause button</dt><dd>{probe.pauseVisible?probe.pauseEnabled?'Visible':'Visible · disabled':'Not visible'}</dd></div>
        <div><dt>Prompt submitted</dt><dd>{submitted?'Detected — composer cleared after a new user message':'Not detected'}</dd></div>
      </dl><small className="chat-test-url">Tab URL: {probe.href}</small></section>
      <section className="panel"><h3>State sequence</h3><ol className="chat-test-sequence">{stages.map((stage,index)=>{const reached=sequence[index]?.stage===stage;return <li key={`${stage}-${index}`} data-reached={reached}><span>{reached?'✓':index+1}</span><div><strong>{names[stage]}</strong><small>{reached?sequence[index].at:index===0?'Empty composer and enabled voice control':index===1?'Type a prompt; enabled arrow appears':'Submit the prompt; stop appears, then voice returns'}</small></div></li>;})}</ol>{complete&&<p className="notice">Test passed: the prompt was submitted, generation stopped, and the chat returned to idle.</p>}</section>
    </>}
  </section>;
}
