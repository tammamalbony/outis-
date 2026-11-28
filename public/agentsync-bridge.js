(() => {
  if (globalThis.__agentsyncBridgeInstalled) return;
  globalThis.__agentsyncBridgeInstalled = true;

  let enabled = true;
  let observer;
  let debounceTimer;
  let settleTimer;
  let snapshotTimer;
  let lastSnapshotKey = '';
  let lastAssistantKey = '';
  let assistantStableSince = 0;
  let lastTestReplySignature = '';
  let lastReplyCopyClickedAt = 0;
  let priorComposerValue='';
  let priorUserCount=0;
  let submittedUntil=0;
  const detectedFlow=[];
  const defaultTimings={pageSettleMs:5000,sessionReadyTimeoutMs:20000,sessionStableMs:3000,composerTextTimeoutMs:4000,sendControlTimeoutMs:5000,submissionTimeoutMs:10000,deliveryReconcileTimeoutMs:20000,conversationLinkGraceMs:5000,conversationLinkStableMs:1500,conversationLinkTimeoutMs:30000,tabReadyTimeoutMs:30000,bridgeReadyTimeoutMs:15000,pollIntervalMs:500,assistantStableMs:1500,snapshotDebounceMs:700,chatSnapshotPollMs:5000,setupReplyTimeoutMs:120000,a0ResponseTimeoutMs:180000,githubRequestTimeoutMs:20000};
  let timings={...defaultTimings};
  const deliveries = new Map();
  const delivered = new Set();
  let activeDelivery = '';

  const cleanUrl = () => `${location.origin}${location.pathname}`;
  const hash = (value) => {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
  };
  const textOf = (node) => (node?.innerText || node?.textContent || '').replace(/\s+$/g, '').slice(0, 40_000);
  const fullTextOf=node=>String(node?.innerText||node?.textContent||'').replace(/\s+$/g,'');
  const userMessages = () => [...new Set(document.querySelectorAll('[data-message-author-role="user"], [data-user-message-bubble="true"]'))];
  const composer = () => document.querySelector('[data-testid="prompt-textarea"]')
    || document.querySelector('textarea[placeholder]')
    || document.querySelector('[contenteditable="true"][role="textbox"]');
  const isVisible = element => !!element && (typeof element.getClientRects==='function'
    ? !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    : true);
  const normalizeText = value => String(value || '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const composerText = element => element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement ? element.value : (element?.innerText || element?.textContent || '');
  const profileControl = () => [...document.querySelectorAll('[data-testid="profile-button"],[data-testid*="profile" i],button[aria-label*="profile" i],button[aria-label*="account" i]')].find(isVisible);
  const accountChanged = () => /your account changed[.!]?\s*send your message again/i.test(document.body?.innerText || '');
  const visibleButtons = () => [...document.querySelectorAll('button')].filter(isVisible);
  const buttonLabel = button => `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.getAttribute('data-testid') || ''} ${button.innerText || ''} ${button.textContent || ''}`;
  const latestAssistantMessage = () => [...new Set(document.querySelectorAll('[data-message-author-role="assistant"],[data-dil-response]'))].at(-1);
  function latestAssistantActions(){
    let node=latestAssistantMessage();
    for(let depth=0;node&&depth<5;depth++,node=node.parentElement){
      const buttons=[...node.querySelectorAll('button')];
      if(buttons.some(button=>/\bcopy\b/i.test(buttonLabel(button))||/copy/i.test(button.getAttribute('data-testid')||'')))return {message:latestAssistantMessage(),buttons};
    }
    const message=latestAssistantMessage();
    return {message,buttons:[...(message?.querySelectorAll('button')||[])]};
  }
  const resolveTimings = value => Object.fromEntries(Object.keys(defaultTimings).map(key=>[key,key==='chatSnapshotPollMs'?5000:Number.isSafeInteger(value?.[key])&&value[key]>=0?value[key]:timings[key]]));
  const stopSquarePath='M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z';
  const sendArrowPath='M9.33467 16.6663V4.93978L4.6374 9.63704L4.1667 9.16634L3.69599 8.69661L9.52998 2.86263L9.63447 2.77767C9.8925 2.60753 10.2433 2.63564 10.4704 2.86263L16.3034 8.69661L16.3884 8.80111C16.5588 9.05922 16.5306 9.40982 16.3034 9.63704C16.0762 9.86414 15.7255 9.89242 15.4675 9.722L15.363 9.63704L10.6647 4.9388V16.6663C10.6647 17.0336 10.367 17.3314 9.99971 17.3314C9.63259 17.3312 9.33467 17.0335 9.33467 16.6663ZM4.6374 9.63704C4.3777 9.89674 3.95569 9.89674 3.69599 9.63704C3.43657 9.37744 3.43668 8.95628 3.69599 8.69661L4.6374 9.63704Z';
  const enabledButton=button=>Boolean(button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&!button.parentElement?.closest?.('[aria-disabled="true"]'));
  const stopIcon = button => [...(button.querySelectorAll?.('svg path') || [])].some(path=>normalizeText(path.getAttribute('d'))===stopSquarePath);
  const arrowIcon = button => [...(button.querySelectorAll?.('svg path') || [])].some(path=>normalizeText(path.getAttribute('d'))===sendArrowPath);
  const stopControl = () => visibleButtons().find(button => enabledButton(button)&&(/stop generating|stop streaming|cancel response/i.test(buttonLabel(button)) || /stop-button/i.test(button.getAttribute('data-testid') || '') || stopIcon(button)));
  function voiceButton(enabledOnly=true){
    for(const button of visibleButtons()){
      const ariaLabel=(button.getAttribute('aria-label') || '').trim();
      const voiceMarker=button.getAttribute('data-composer-voice-start') === 'true';
      // ChatGPT builds do not consistently expose the data marker or SVG use
      // reference. The accessible action label is the stable signal users see.
      if((!enabledOnly||enabledButton(button))&&(/^start voice(?: mode)?$/i.test(ariaLabel)||voiceMarker))return button;
    }
    for(const use of document.querySelectorAll('button svg use')){
      const href=use.getAttribute('href') || use.getAttributeNS('http://www.w3.org/1999/xlink','href') || use.href?.baseVal || '';
      const button=use.closest('button');
      // The visible composer voice action can have a localized or missing
      // accessible label. Its ChatGPT sprite symbol is a stable fallback.
      if(button&&isVisible(button)&&(!enabledOnly||enabledButton(button))&&href.includes('#codex-icon-voice-regular-20'))return button;
    }
    return null;
  }
  const startVoiceControl=()=>voiceButton(true);
  function sendControl(input){
    const composerForm=input?.closest?.('form');
    const voice=startVoiceControl();
    return visibleButtons().find(button=>{
      if(button===voice)return false;
      if(!enabledButton(button)||button.getAttribute('aria-hidden')==='true')return false;
      const label=buttonLabel(button);
      if(/\bstart voice\b/i.test(label))return false;
      const namedSend=button.getAttribute('data-testid')==='send-button'||/\bsend(?:\s+(?:prompt|message))?\b/i.test(label);
      const composerSubmit=Boolean(composerForm&&button.type==='submit'&&composerForm.contains(button));
      return namedSend||composerSubmit||arrowIcon(button);
    });
  }
  const wait = milliseconds => new Promise(resolve=>setTimeout(resolve,milliseconds));
  function composerModeControls(){
    const group=[...document.querySelectorAll('[role="group"][aria-label="Composer mode"]')].find(isVisible);
    if(!group)return {chat:null,work:null};
    const buttons=[...group.querySelectorAll('button')].filter(isVisible);
    return {chat:buttons.find(button=>normalizeText(button.innerText||button.textContent)==='Chat')||null,work:buttons.find(button=>normalizeText(button.innerText||button.textContent)==='Work')||null};
  }
  async function setComposerMode(target,timeoutMs,settings){
    const deadline=Date.now()+timeoutMs;
    let switched=false;
    while(Date.now()<deadline){
      const {chat,work}=composerModeControls();
      if(chat&&work){
        const chatSelected=chat.getAttribute('aria-pressed')==='true';
        const workSelected=work.getAttribute('aria-pressed')==='true';
        if(target==='CHAT'&&chatSelected&&!workSelected||target==='WORK'&&workSelected&&!chatSelected)return true;
        const desired=target==='CHAT'?chat:work;
        if(!switched){
          if(!enabledButton(desired))throw new Error(`ChatGPT ${target==='CHAT'?'Chat':'Work'} mode is disabled.`);
          desired.click();
          switched=true;
        }
      }
      await wait(settings.pollIntervalMs);
    }
    throw new Error(`Could not confirm ChatGPT Composer mode is ${target==='CHAT'?'Chat':'Work'}.`);
  }
  async function ensureChatMode(timeoutMs,settings){
    try{return await setComposerMode('CHAT',timeoutMs,settings);}
    catch(error){throw new Error(`${error instanceof Error?error.message:'Could not select Chat mode.'} No prompt was submitted.`);}
  }
  const effortLabel=value=>({0:'LOW',1:'MEDIUM',2:'HIGH'}[Number(value)]||'UNKNOWN');
  function effortLevel(){
    const slider=[...document.querySelectorAll('[role="slider"][aria-valuenow]')].find(isVisible);
    if(slider)return effortLabel(slider.getAttribute('aria-valuenow'));
    const status=[...document.querySelectorAll('[role="status"]')].filter(isVisible).map(textOf).join(' ');
    const modelButton=visibleButtons().find(button=>/select chatgpt model/i.test(buttonLabel(button)));
    const text=`${status} ${modelButton?textOf(modelButton):''}`;
    const match=text.match(/\b(low|medium|high)\b/i);
    return match?match[1].toUpperCase():'UNKNOWN';
  }
  async function setEffortLevel(target,timeoutMs,settings){
    if(!['LOW','MEDIUM','HIGH'].includes(target))throw new Error('Choose Low, Medium, or High effort.');
    const deadline=Date.now()+timeoutMs;
    let menuButton;
    while(Date.now()<deadline){
      menuButton=visibleButtons().find(button=>/select chatgpt model/i.test(buttonLabel(button)));
      if(menuButton&&enabledButton(menuButton))break;
      await wait(settings.pollIntervalMs);
    }
    if(!menuButton||!enabledButton(menuButton))throw new Error('ChatGPT effort control is not available.');
    const targetValue={LOW:0,MEDIUM:1,HIGH:2}[target];
    const menuVisible=()=>[...document.querySelectorAll('[role="menu"]')].some(isVisible);
    if(!menuVisible())menuButton.click();
    try{
      while(Date.now()<deadline){
        const slider=[...document.querySelectorAll('[role="slider"][aria-valuenow]')].find(isVisible);
        const row=[...document.querySelectorAll('[role="menuitem"][aria-label="Power"]')].find(isVisible);
        if(slider&&row){
          const current=Number(slider.getAttribute('aria-valuenow'));
          if(current===targetValue)return target;
          const key=current<targetValue?'ArrowRight':'ArrowLeft';
          row.focus();
          row.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
          row.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true,cancelable:true}));
          await wait(settings.pollIntervalMs);
          const next=[...document.querySelectorAll('[role="slider"][aria-valuenow]')].find(isVisible);
          if(next&&Number(next.getAttribute('aria-valuenow'))===current)throw new Error('ChatGPT did not accept the effort keyboard control.');
          continue;
        }
        await wait(settings.pollIntervalMs);
      }
      throw new Error('ChatGPT effort slider did not become available.');
    }finally{
      if(menuVisible())menuButton.click();
    }
  }
  if(chrome?.storage?.local){
    chrome.storage.local.get('agentsync.timing-settings.v1',value=>{
      if(chrome.runtime.lastError)return;
      timings=resolveTimings(value?.['agentsync.timing-settings.v1']);
      startSnapshotTimer();
      sendSnapshot();
    });
    chrome.storage.onChanged?.addListener((changes,areaName)=>{
      if(areaName!=='local'||!changes['agentsync.timing-settings.v1'])return;
      timings=resolveTimings(changes['agentsync.timing-settings.v1'].newValue);
      startSnapshotTimer();
      sendSnapshot();
    });
  }
  async function settleNewChatComposer(input,settings){
    input=composer()||input;
    const staleDraft=normalizeText(composerText(input));
    if(staleDraft){
      setComposerText(input,'');
      if(!await waitForComposerText(input,'',settings.composerTextTimeoutMs,settings))throw new Error('AgentSync could not clear the previous ChatGPT draft. No prompt was submitted.');
    }
    // ChatGPT can retain an old draft across fresh-home tabs and hydrate its
    // composer controls asynchronously. Let the page settle before replacing it.
    await wait(settings.pageSettleMs);
    await ensureChatMode(settings.sessionReadyTimeoutMs,settings);
    await setEffortLevel('HIGH',settings.sessionReadyTimeoutMs,settings);
    input=await waitForComposerAction('empty',settings.sessionReadyTimeoutMs,settings);
    if(!input)throw new Error('ChatGPT did not show an enabled voice button for the empty new-chat composer. No prompt was submitted.');
    if(normalizeText(composerText(input)))throw new Error('ChatGPT restored text in the composer while preparing a new chat. No prompt was submitted.');
    return input;
  }
  async function waitForComposerAction(expected,timeoutMs,settings){
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      const input=composer();
      const empty=!normalizeText(composerText(input));
      const ready=isVisible(input)&&!input.disabled&&input.getAttribute('aria-disabled')!=='true'
        &&(expected==='empty'?empty&&!stopControl()&&enabledButton(startVoiceControl()):Boolean(!empty&&enabledButton(sendControl(input))));
      if(ready)return input;
      await wait(settings.pollIntervalMs);
    }
    return null;
  }
  async function waitForSendControl(input,settings){
    const timeoutMs=settings.sendControlTimeoutMs;
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      if(sendControl(input))return true;
      await wait(settings.pollIntervalMs);
    }
    return Boolean(sendControl(input));
  }
  function visibleError(){
    const text=[...document.querySelectorAll('[role="alert"],[data-testid*="error" i],[data-testid*="toast" i]')].filter(isVisible).map(element=>element.innerText||element.textContent||'').join(' ').slice(-2000);
    return /something went wrong|error generating|failed to generate|network error|unable to (?:load|send)|message failed/i.test(text);
  }

  function scheduleSettle(delay){
    if(settleTimer)clearTimeout(settleTimer);
    settleTimer=setTimeout(()=>{settleTimer=null;sendSnapshot();},Math.max(0,delay));
  }

  function readSnapshot() {
    // ChatGPT now renders messages with data-user-message-bubble and
    // data-dil-response. Keep the older role attributes as fallbacks because
    // the site can roll markup changes out gradually across conversations.
    const messages = [...new Set(document.querySelectorAll(
      '[data-message-author-role="assistant"], [data-message-author-role="user"], [data-user-message-bubble="true"], [data-dil-response]'
    ))];
    const latest = messages.at(-1);
    const latestMessage = textOf(latest);
    const latestRole = latest?.getAttribute('data-message-author-role')
      || (latest?.hasAttribute('data-user-message-bubble') ? 'user' : null)
      || (latest?.hasAttribute('data-dil-response') ? 'assistant' : null)
      || 'unknown';
    const latestMessageId = latest?.getAttribute('data-dil-message-id')
      || latest?.getAttribute('data-message-id')
      || (latest ? `${latestRole}-${messages.length}-${hash(latestMessage)}` : '');
    const currentComposer=composer();
    const hasComposer=isVisible(currentComposer)&&!currentComposer.disabled&&currentComposer.getAttribute('aria-disabled')!=='true';
    const currentText=hasComposer?normalizeText(composerText(currentComposer)):'';
    const currentUsers=userMessages();
    const voice=voiceButton(false);
    const arrow=visibleButtons().find(button=>arrowIcon(button));
    const stop=visibleButtons().find(button=>stopIcon(button)||/stop generating|stop streaming|cancel response/i.test(buttonLabel(button))||/stop-button/i.test(button.getAttribute('data-testid')||''));
    if(priorComposerValue&& !currentText && currentUsers.length>priorUserCount)submittedUntil=Date.now()+12_000;
    priorComposerValue=currentText;
    priorUserCount=currentUsers.length;
    const generating=Boolean(stop&&enabledButton(stop));
    const assistantText=latestRole==='assistant'?latestMessage:'';
    const assistantKey=assistantText?`${cleanUrl()}|${latestMessageId}|${assistantText}`:'';
    if(assistantKey!==lastAssistantKey){lastAssistantKey=assistantKey;assistantStableSince=assistantKey?Date.now():0;}
    const voiceControl=startVoiceControl();
    const responseStable=Boolean(assistantStableSince&&Date.now()-assistantStableSince>=timings.assistantStableMs);
    const idleCandidate=hasComposer&&!generating&&Boolean(voiceControl)&&!normalizeText(composerText(currentComposer))&&(latestRole!=='assistant'||responseStable);
    if(hasComposer&&!generating&&voiceControl&&!normalizeText(composerText(currentComposer))&&latestRole==='assistant'&&!responseStable){scheduleSettle(timings.assistantStableMs-(Date.now()-assistantStableSince));}
    const state = generating ? 'GENERATING' : idleCandidate ? 'IDLE' : 'UNKNOWN';
    const flow=generating?'GENERATING':currentText&&arrow&&enabledButton(arrow)?'PROMPT_READY':submittedUntil>Date.now()?'SUBMITTED':!currentText&&voice&&enabledButton(voice)?(location.pathname==='/'?'NEW':'IDLE'):'UNKNOWN';
    if(detectedFlow.at(-1)!==flow){detectedFlow.push(flow);if(detectedFlow.length>8)detectedFlow.shift();}
    const {chat,work}=composerModeControls();
    const composerMode=chat?.getAttribute('aria-pressed')==='true'&&work?.getAttribute('aria-pressed')==='false'?'CHAT':work?.getAttribute('aria-pressed')==='true'&&chat?.getAttribute('aria-pressed')==='false'?'WORK':'UNKNOWN';
    const buttonState=currentText&&arrow?'ARROW':stop?'STOP':voice?'VOICE':'NONE';
    return {conversationUrl:cleanUrl(),state,flow,flowTrail:[...detectedFlow],composerState:!hasComposer?'MISSING':currentText?'TEXT':'EMPTY',buttonState,voiceVisible:Boolean(voice),voiceEnabled:enabledButton(voice),arrowVisible:Boolean(arrow),arrowEnabled:enabledButton(arrow),stopVisible:Boolean(stop),stopEnabled:enabledButton(stop),composerMode,effort:effortLevel(),latestRole,latestMessageId,latestMessage,observedAt:new Date().toISOString()};
  }

  function readTestSnapshot(){
    const input=composer();
    const visible=isVisible(input);
    const text=visible?normalizeText(composerText(input)):'';
    const voice=voiceButton(false);
    const stop=visibleButtons().find(button=>/stop generating|stop streaming|cancel response/i.test(buttonLabel(button))||/stop-button/i.test(button.getAttribute('data-testid')||'')||stopIcon(button));
    const arrow=visibleButtons().find(button=>arrowIcon(button));
    const pause=visibleButtons().find(button=>/\bpause(?: generation| response)?\b/i.test(buttonLabel(button)));
    const conversation=/^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname);
    const {chat:chatModeButton,work:workModeButton}=composerModeControls();
    const composerMode=chatModeButton?.getAttribute('aria-pressed')==='true'&&workModeButton?.getAttribute('aria-pressed')==='false'?'CHAT':workModeButton?.getAttribute('aria-pressed')==='true'&&chatModeButton?.getAttribute('aria-pressed')==='false'?'WORK':'UNKNOWN';
    const latestReply=latestAssistantMessage();
    const latestReplyText=textOf(latestReply);
    const replySignature=hash(latestReplyText);
    if(replySignature!==lastTestReplySignature){lastTestReplySignature=replySignature;lastReplyCopyClickedAt=0;}
    const replyFirstLine=latestReplyText.split(/\r?\n/).map(line=>normalizeText(line)).find(Boolean)||'';
    const copyUiConfirmed=Boolean(latestAssistantActions().buttons.some(button=>/\bcopied\b/i.test(buttonLabel(button)))||[...document.querySelectorAll('[role="status"],[role="alert"]')].filter(isVisible).some(element=>/copied to clipboard/i.test(textOf(element))));
    const latestReplyCopyStatus=copyUiConfirmed?'COPIED':lastReplyCopyClickedAt?'COPY_CLICKED':'NOT_COPIED';
    const pageLoaded=document.readyState==='complete';
    let state='WAITING';
    if(!pageLoaded)state='LOADING';
    else if(text&&arrow&&enabledButton(arrow))state='PROMPT_READY';
    else if(stop&&enabledButton(stop))state='WORKING';
    else if(!text&&voice&&enabledButton(voice))state=conversation?'IDLE':'NEW';
    return {href:location.href,hasConversationUrl:conversation,conversationUrl:conversation?cleanUrl():'',pageLoaded,composerVisible:visible,composerText:visible?composerText(input).slice(0,5000):'',composerTextTruncated:visible&&composerText(input).length>5000,composerEmpty:!text,composerLength:text.length,composerMode,effort:effortLevel(),voiceVisible:Boolean(voice),voiceEnabled:enabledButton(voice),arrowVisible:Boolean(arrow),arrowEnabled:enabledButton(arrow),stopVisible:Boolean(stop),stopEnabled:enabledButton(stop),pauseVisible:Boolean(pause),pauseEnabled:enabledButton(pause),userMessageCount:userMessages().length,latestReplyFirstLine:replyFirstLine.slice(0,500),latestReplyCopyStatus,state,observedAt:new Date().toISOString()};
  }

  document.addEventListener('click',event=>{
    const target=event.target;
    const button=target instanceof Element?target.closest('button'):null;
    const latest=latestAssistantActions();
    if(button&&latest.message&&latest.buttons.includes(button)&&(/\bcopy\b/i.test(buttonLabel(button))||/copy/i.test(button.getAttribute('data-testid')||'')))lastReplyCopyClickedAt=Date.now();
  },true);

  function sendSnapshot(force=false,onComplete) {
    if (!enabled || !chrome?.runtime?.id) { onComplete?.({error:'AgentSync bridge is disabled.'}); return; }
    // ChatGPT can briefly route a tab through its home URL while switching
    // conversations. Do not send that transient page as a registered chat.
    if (!/^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname)) { onComplete?.({received:true,ignored:true}); return; }
    const snapshot = readSnapshot();
    const key = JSON.stringify([snapshot.state,snapshot.flow,snapshot.buttonState,snapshot.composerState,snapshot.composerMode,snapshot.effort,snapshot.latestRole,snapshot.latestMessageId]);
    if (!force&&key === lastSnapshotKey) { onComplete?.({received:true,unchanged:true}); return; }
    lastSnapshotKey = key;
    chrome.runtime.sendMessage({type:'AGENTSYNC_CHAT_SNAPSHOT',snapshot}, response => {
      const error=chrome.runtime.lastError;
      if(onComplete)onComplete(error?{error:error.message}:response||{received:true});
    });
  }

  function startSnapshotTimer(){
    if(typeof setInterval!=='function')return;
    if(snapshotTimer)clearInterval(snapshotTimer);
    snapshotTimer=setInterval(()=>sendSnapshot(true),timings.chatSnapshotPollMs);
  }

  function setComposerText(element, text) {
    element.focus();
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, text);
      element.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
      element.dispatchEvent(new Event('change', {bubbles:true}));
      return;
    }
    const selection=window.getSelection();
    const range=document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();selection.addRange(range);
    document.execCommand('delete');
    const insertRange=document.createRange();
    insertRange.selectNodeContents(element);insertRange.collapse(false);
    selection.removeAllRanges();selection.addRange(insertRange);
    const inserted=document.execCommand('insertText',false,text);
    if(!inserted||normalizeText(element.innerText||element.textContent)!==normalizeText(text)){
      element.replaceChildren(document.createTextNode(text));
    }
    element.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
  }

  async function waitForSessionReady(timeoutMs,settings){
    const deadline=Date.now()+timeoutMs;
    let stableSince=0,priorSessionEvidence='';
    while(Date.now()<deadline){
      if(accountChanged())throw new Error('ChatGPT reports the signed-in account changed. Refresh ChatGPT and confirm the intended account before submitting.');
      const currentComposer=composer();
      const profile=profileControl();
      const profileState=profile?`${profile.getAttribute('aria-label')||''}|${profile.getAttribute('data-testid')||''}`:'';
      const registeredConversation=/^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname)
        &&[...document.querySelectorAll('[data-message-author-role="assistant"],[data-dil-response]')].some(isVisible);
      const composerEmpty=!normalizeText(composerText(currentComposer));
      const actionReady=composerEmpty?Boolean(enabledButton(startVoiceControl())&&!stopControl()):Boolean(enabledButton(sendControl(currentComposer)));
      const readyAction=isVisible(currentComposer)&&!currentComposer.disabled&&currentComposer.getAttribute('aria-disabled')!=='true'&&actionReady;
      const sessionEvidence=profile?`profile:${profileState}`:registeredConversation?'registered-conversation-with-assistant-reply':readyAction?'enabled-composer-action':'';
      const ready=document.readyState==='complete'&&readyAction&&Boolean(sessionEvidence);
      if(ready&&sessionEvidence===priorSessionEvidence){
        if(!stableSince)stableSince=Date.now();
        if(Date.now()-stableSince>=settings.sessionStableMs)return currentComposer;
      }else stableSince=0;
      priorSessionEvidence=sessionEvidence;
      await wait(settings.pollIntervalMs);
    }
    throw new Error('ChatGPT did not reach a stable signed-in state. No prompt was submitted; refresh the page and check the account.');
  }
  async function waitForComposerText(element,text,timeoutMs,settings){
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      if(normalizeText(composerText(composer()||element))===normalizeText(text))return true;
      await wait(settings.pollIntervalMs);
    }
    return false;
  }
  function latestUserMessageMatches(marker,expectedText){
    const latest=userMessages().at(-1);
    const actual=fullTextOf(latest);
    const composerEmpty=!normalizeText(composerText(composer()));
    return {matches:Boolean(latest&&actual.includes(marker)&&normalizeText(actual)===normalizeText(expectedText)),composerEmpty,actual};
  }
  async function waitForSubmission(marker,expectedText,beforeCount,settings){
    const timeoutMs=settings.deliveryReconcileTimeoutMs;
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      const evidence=latestUserMessageMatches(marker,expectedText);
      if(userMessages().length>beforeCount&&evidence.matches&&evidence.composerEmpty)return {confirmed:true};
      await wait(settings.pollIntervalMs);
    }
    const evidence=latestUserMessageMatches(marker,expectedText);
    return {confirmed:userMessages().length>beforeCount&&evidence.matches&&evidence.composerEmpty,composerEmpty:evidence.composerEmpty,messageFound:evidence.matches,latestUserMessage:evidence.actual.slice(0,500)};
  }

  async function submitTextOnce(message) {
    const settings=resolveTimings(message.timings);
    if (message.conversationUrl !== cleanUrl()) throw new Error('Target conversation changed before handoff.');
    if(typeof message.dedupeKey!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(message.dedupeKey))throw new Error('Missing or invalid AgentSync delivery ID.');
    const marker=`AgentSync delivery ID: ${message.dedupeKey}`;
    const priorUsers=userMessages();
    if (typeof message.text !== 'string' || !message.text.trim()) throw new Error('AgentSync prompt is empty.');
    if (message.text.length > 250_000) throw new Error(`AgentSync prompt has ${message.text.length.toLocaleString()} characters; the current bridge limit is 250,000.`);
    const priorDelivery=latestUserMessageMatches(marker,message.text);
    if(priorDelivery.matches&&priorDelivery.composerEmpty)return {submitted:true,duplicate:true};
    const before=priorUsers.length;
    const input=await waitForSessionReady(settings.sessionReadyTimeoutMs,settings);
    const existingDraft=normalizeText(composerText(input));
    const exactAgentSyncDraft=existingDraft===normalizeText(message.text)&&existingDraft.includes(marker);
    const freshHome=message.allowFreshChat===true&&location.origin==='https://chatgpt.com'&&location.pathname==='/'&&!location.search&&!location.hash&&userMessages().length===0&&!stopControl()&&!visibleError();
    if(readSnapshot().state!=='IDLE'&&!exactAgentSyncDraft&&!freshHome)throw new Error('Chat is not confirmed idle. Inspect the registered conversation before retrying.');
    if(existingDraft&&!exactAgentSyncDraft&&!freshHome)throw new Error('The ChatGPT composer contains a different unsent draft. Submit or remove it yourself before AgentSync continues.');
    if(exactAgentSyncDraft&&(stopControl()||visibleError()))throw new Error('ChatGPT is generating or showing an error. Wait for it to settle before resuming the saved AgentSync draft.');
    let activeInput=input;
    if(freshHome)activeInput=await settleNewChatComposer(input,settings);
    activeInput=composer()||activeInput;
    if(!exactAgentSyncDraft||freshHome)setComposerText(activeInput,message.text);
    if(!await waitForComposerText(activeInput,message.text,settings.composerTextTimeoutMs,settings))throw new Error('AgentSync could not verify the exact prompt in the composer. Nothing was submitted.');
    if(!await waitForSendControl(activeInput,settings))throw new Error('ChatGPT send arrow did not appear for the non-empty composer. No prompt was submitted.');
    activeInput=composer()||activeInput;
    const send=sendControl(activeInput);
    if (!send) throw new Error('ChatGPT send arrow is unavailable.');
    send.click();
    const confirmation=await waitForSubmission(marker,message.text,before,settings);
    if(confirmation.confirmed){queueMicrotask(sendSnapshot);return {submitted:true};}
    return {submitted:false,uncertain:true,error:`Could not confirm the exact last user message after ${settings.deliveryReconcileTimeoutMs/1000} seconds${confirmation.messageFound&&!confirmation.composerEmpty?'; the composer still contains text':''}. AgentSync will reload once and compare the saved delivery ID; it will not resend automatically.`};
  }

  async function createChat(message) {
    const settings=resolveTimings(message.timings);
    if(location.origin!=='https://chatgpt.com'||location.pathname!=='/'||location.search||location.hash)throw new Error('New-chat setup is limited to a fresh ChatGPT home tab.');
    if(document.querySelector('[data-message-author-role="user"],[data-message-author-role="assistant"]'))throw new Error('ChatGPT tab is not a fresh conversation.');
    if(typeof message.text!=='string'||!message.text.trim()||message.text.length>30_000)throw new Error('Setup prompt is empty or too long.');
    const key=message.dedupeKey;
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(key))throw new Error('Missing or invalid AgentSync delivery ID.');
    const result=await submitText({conversationUrl:cleanUrl(),dedupeKey:key,text:`${message.text}\n\nAgentSync delivery ID: ${key}`,allowFreshChat:true,timings:settings});
    if(result?.uncertain)return {...result,conversationUrl:''};
    const submittedAt=Date.now();
    let candidateUrl='',candidateSince=0;
    const deadline=Date.now()+settings.conversationLinkTimeoutMs;
    while(Date.now()<deadline){
      const match=location.pathname.match(/^\/c\/([A-Za-z0-9-]+)\/?$/);
      const currentUrl=match?`${location.origin}/c/${match[1]}`:'';
      if(currentUrl!==candidateUrl){candidateUrl=currentUrl;candidateSince=currentUrl?Date.now():0;}
      if(currentUrl&&Date.now()-submittedAt>=settings.conversationLinkGraceMs&&Date.now()-candidateSince>=settings.conversationLinkStableMs)return {...result,conversationUrl:currentUrl};
      await wait(settings.pollIntervalMs);
    }
    throw new Error('ChatGPT accepted the setup message but did not expose a stable conversation URL. Inspect the new tab before retrying.');
  }

  function chatActionsButton(){
    const candidates=visibleButtons().filter(button=>button.getAttribute('aria-label')==='Chat actions'&&button.getAttribute('aria-haspopup')==='menu');
    // ChatGPT has shipped both Radix-controlled menus and a header menu with
    // no aria-controls attribute. Message-level native-popover buttons are
    // excluded so the test always targets the conversation header.
    return candidates.find(button=>(button.getAttribute('aria-controls')||'').startsWith('radix-'))
      ||candidates.find(button=>!button.getAttribute('aria-controls')||!button.getAttribute('aria-controls').startsWith('--native-popover-'));
  }
  function visibleChatActionItems(){
    const button=chatActionsButton();
    const controlled=button?.getAttribute('aria-controls');
    const linkedRoot=controlled?document.getElementById(controlled):null;
    const root=linkedRoot?.matches?.('[role="menu"]')?linkedRoot:[...document.querySelectorAll('[role="menu"]')].find(isVisible);
    const scope=root||document;
    return [...scope.querySelectorAll('[role="menuitem"]')].filter(isVisible);
  }
  async function openChatActionsMenu(timeoutMs,settings){
    if(!/^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname))throw new Error('Open a ChatGPT conversation before testing its chat menu.');
    const button=chatActionsButton();
    if(!button||!enabledButton(button))throw new Error('ChatGPT conversation actions button was not detected.');
    if(button.getAttribute('aria-expanded')!=='true'){
      // ChatGPT's Radix dropdown opens on pointerdown; HTMLElement.click() only
      // emits click and leaves the menu closed. Use the same event that its
      // trigger listens for, then verify the rendered menu below.
      button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,ctrlKey:false,pointerId:1,pointerType:'mouse',isPrimary:true}));
    }
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      const labels=visibleChatActionItems().map(item=>normalizeText(textOf(item)));
      if(labels.some(label=>/^Archive\b/i.test(label))&&labels.some(label=>/^Delete\b/i.test(label)))return {menuOpen:true,actions:['Archive','Delete']};
      await wait(settings.pollIntervalMs);
    }
    throw new Error('ChatGPT chat menu did not expose Archive and Delete.');
  }
  async function performChatAction(action,timeoutMs,settings){
    const originalUrl=cleanUrl();
    await openChatActionsMenu(timeoutMs,settings);
    const item=visibleChatActionItems().find(element=>new RegExp(`^${action}\\b`,'i').test(normalizeText(textOf(element))));
    if(!item||item.getAttribute('aria-disabled')==='true')throw new Error(`ChatGPT ${action} action is unavailable.`);
    item.click();
    if(action==='Delete'){
      const dialogDeadline=Date.now()+Math.min(timeoutMs,5000);
      while(Date.now()<dialogDeadline){
        const dialog=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')].find(element=>isVisible(element)&&/delete.{0,50}(?:chat|conversation)|(?:chat|conversation).{0,50}delete/i.test(textOf(element)));
        if(dialog){
          const confirm=[...dialog.querySelectorAll('button,[role="button"]')].find(button=>isVisible(button)&&enabledButton(button)&&/^delete(?: chat| conversation)?$/i.test(normalizeText(textOf(button)||buttonLabel(button))));
          if(confirm){confirm.click();break;}
        }
        await wait(settings.pollIntervalMs);
      }
    }
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      const noticeText=[...document.querySelectorAll('[role="status"],[role="alert"]')].filter(isVisible).map(textOf).join(' ');
      if(location.pathname==='/'||cleanUrl()!==originalUrl||new RegExp(`${action}d? (?:the )?(?:chat|conversation)`,'i').test(noticeText))return {performed:true,action,conversationChanged:cleanUrl()!==originalUrl};
      await wait(settings.pollIntervalMs);
    }
    return {performed:true,action,conversationChanged:false,notice:'Action was clicked; inspect the ChatGPT page to confirm its final state.'};
  }

  function submitText(message) {
    const key=message?.dedupeKey;
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(key))return Promise.reject(new Error('Missing or invalid AgentSync delivery ID.'));
    if(delivered.has(key))return Promise.resolve({submitted:true,duplicate:true});
    if(deliveries.has(key))return deliveries.get(key);
    if(activeDelivery)return Promise.reject(new Error('Another AgentSync prompt is already being submitted in this chat.'));
    activeDelivery=key;
    const operation=submitTextOnce(message).then(result=>{
      if(result?.submitted)delivered.add(key);
      return result;
    }).finally(()=>{
      deliveries.delete(key);
      if(activeDelivery===key)activeDelivery='';
    });
    deliveries.set(key,operation);
    return operation;
  }

  const onMessage=(message,_sender,sendResponse)=>{
    if(message?.type==='AGENTSYNC_BRIDGE_DISABLE'){
      enabled=false;
      globalThis.__agentsyncBridgeInstalled=false;
      observer?.disconnect();
      if(snapshotTimer!==undefined)clearInterval(snapshotTimer);
      snapshotTimer=undefined;
      clearTimeout(debounceTimer);
      clearTimeout(settleTimer);
      chrome.runtime.onMessage.removeListener(onMessage);
      sendResponse({disabled:true});
      return false;
    }
    if(message?.type==='AGENTSYNC_BRIDGE_PING'){
      sendSnapshot(true,result=>sendResponse(result?.error?{ready:false,error:result.error}:{ready:true}));
      return true;
    }
    if(message?.type==='AGENTSYNC_TEST_SNAPSHOT'){
      sendResponse(readTestSnapshot());
      return false;
    }
    if(message?.type==='AGENTSYNC_VERIFY_LAST_USER_MESSAGE'){
      const key=message.dedupeKey,text=message.text;
      if(location.origin!=='https://chatgpt.com'){sendResponse({confirmed:false,error:'Delivery verification is only available on chatgpt.com.'});return false;}
      if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(key)||typeof text!=='string'||text.length>250_000||!text.includes(`AgentSync delivery ID: ${key}`)){
        sendResponse({confirmed:false,error:'The saved delivery ID or expected prompt is invalid.'});return false;
      }
      if(message.conversationUrl&&message.conversationUrl!==cleanUrl()&&!message.allowNewConversation){sendResponse({confirmed:false,error:'The conversation URL changed during delivery verification.'});return false;}
      const evidence=latestUserMessageMatches(`AgentSync delivery ID: ${key}`,text);
      const voiceVisible=Boolean(voiceButton());
      sendResponse({confirmed:evidence.matches&&evidence.composerEmpty,found:evidence.matches,composerEmpty:evidence.composerEmpty,voiceVisible,conversationUrl:cleanUrl(),latestUserMessage:evidence.actual.slice(0,500),reason:evidence.matches&&!evidence.composerEmpty?'The delivery ID is visible, but the composer still contains text.':evidence.matches?'The exact last user message and an empty composer are confirmed.':'The latest user message does not match the saved prompt and delivery ID.'});
      return false;
    }
    if(message?.type==='AGENTSYNC_TEST_STOP_GENERATION'){
      const stop=stopControl();
      if(!stop){sendResponse({stopped:false,reason:'No enabled ChatGPT stop button is visible.'});return false;}
      stop.click();
      sendResponse({stopped:true,reason:'Clicked the visible stop button in the temporary test chat.'});
      return false;
    }
    if(message?.type==='AGENTSYNC_TEST_OPEN_CHAT_MENU'){
      const settings=resolveTimings(message.timings);
      openChatActionsMenu(Math.min(settings.sessionReadyTimeoutMs,5000),settings).then(sendResponse,error=>sendResponse({error:error instanceof Error?error.message:'Could not open ChatGPT chat menu.'}));
      return true;
    }
    if(message?.type==='AGENTSYNC_TEST_SEND_DEMO'){
      const key=message.dedupeKey;
      const text=message.text;
      if(typeof key!=='string'||!/^test_[A-Za-z0-9_-]{1,120}$/.test(key)||typeof text!=='string'||!text.includes(`AgentSync delivery ID: ${key}`)){
        sendResponse({error:'The one-click test prompt is missing its delivery ID.'});
        return false;
      }
      const settings=resolveTimings(message.timings);
      submitText({conversationUrl:cleanUrl(),dedupeKey:key,text,allowFreshChat:true,timings:settings}).then(sendResponse,error=>sendResponse({error:error instanceof Error?error.message:'Test prompt submission failed.'}));
      return true;
    }
    if(message?.type==='AGENTSYNC_TEST_ARCHIVE_CHAT'||message?.type==='AGENTSYNC_TEST_DELETE_CHAT'){
      if(message.type==='AGENTSYNC_TEST_DELETE_CHAT'&&message.confirmDelete!==true){sendResponse({error:'Deletion needs explicit confirmation in the Test Wizard.'});return false;}
      const settings=resolveTimings(message.timings);
      const action=message.type==='AGENTSYNC_TEST_DELETE_CHAT'?'Delete':'Archive';
      performChatAction(action,Math.min(settings.sessionReadyTimeoutMs,5000),settings).then(sendResponse,error=>sendResponse({error:error instanceof Error?error.message:`Could not ${action.toLowerCase()} this chat.`}));
      return true;
    }
    if(message?.type==='AGENTSYNC_ENSURE_CHAT_MODE'){
      const settings=resolveTimings(message.timings);
      ensureChatMode(settings.sessionReadyTimeoutMs,settings).then(()=>sendResponse({confirmed:true}),error=>sendResponse({error:error instanceof Error?error.message:'Could not select Chat mode.'}));
      return true;
    }
    if(message?.type==='AGENTSYNC_SET_COMPOSER_MODE'){
      const settings=resolveTimings(message.timings);
      const target=message.mode==='WORK'?'WORK':message.mode==='CHAT'?'CHAT':null;
      if(!target){sendResponse({error:'Choose Chat or Work mode.'});return false;}
      setComposerMode(target,settings.sessionReadyTimeoutMs,settings).then(()=>sendResponse({confirmed:true,mode:target}),error=>sendResponse({error:error instanceof Error?error.message:'Could not change ChatGPT mode.'}));
      return true;
    }
    if(message?.type==='AGENTSYNC_SET_EFFORT'){
      const settings=resolveTimings(message.timings);
      const target=String(message.effort||'').toUpperCase();
      setEffortLevel(target,settings.sessionReadyTimeoutMs,settings).then(effort=>sendResponse({confirmed:true,effort}),error=>sendResponse({error:error instanceof Error?error.message:'Could not change ChatGPT effort.'}));
      return true;
    }
    if(message?.type==='AGENTSYNC_TEST_SET_COMPOSER_TEXT'||message?.type==='AGENTSYNC_TEST_CLEAR_COMPOSER'){
      const input=composer();
      if(!input||!isVisible(input)||input.disabled||input.getAttribute('aria-disabled')==='true'){
        sendResponse({error:'ChatGPT composer is not ready. No text was changed.'});
        return false;
      }
      const text=message.type==='AGENTSYNC_TEST_CLEAR_COMPOSER'?'':typeof message.text==='string'?message.text:'';
      if(message.type==='AGENTSYNC_TEST_SET_COMPOSER_TEXT'&&(!text.trim()||text.length>2000)){
        sendResponse({error:'Demo text must contain 1 to 2,000 characters.'});
        return false;
      }
      if(message.type==='AGENTSYNC_TEST_SET_COMPOSER_TEXT'&&normalizeText(composerText(input))){
        sendResponse({error:'The composer already has a draft. Clear it before inserting demo text.'});
        return false;
      }
      const settings=resolveTimings(message.timings);
      setComposerText(input,text);
      waitForComposerText(input,text,settings.composerTextTimeoutMs,settings).then(confirmed=>sendResponse(confirmed?{confirmed:true,cleared:!text}:{error:'ChatGPT did not confirm the composer text change.'}));
      return true;
    }
    if(message?.type==='AGENTSYNC_CREATE_CHAT'){
      createChat(message).then(sendResponse,error=>sendResponse({error:error instanceof Error?error.message:'Chat setup failed.'}));
      return true;
    }
    if(message?.type!=='AGENTSYNC_DELIVER_A0_UPDATE'&&message?.type!=='AGENTSYNC_SEND_CONTINUATION'&&message?.type!=='AGENTSYNC_SEND_ORDER')return false;
    submitText(message).then(sendResponse,error=>sendResponse({error:error instanceof Error?error.message:'Bridge submission failed.'}));
    return true;
  };

  chrome.runtime.onMessage.addListener(onMessage);
  const scheduleSnapshot=()=>{
    clearTimeout(debounceTimer);
    debounceTimer=setTimeout(sendSnapshot,timings.snapshotDebounceMs);
  };
  observer=new MutationObserver(scheduleSnapshot);
  if(document.documentElement)observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','disabled','data-testid']});
  startSnapshotTimer();
  sendSnapshot();
})();
