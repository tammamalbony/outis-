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
  const defaultTimings={pageSettleMs:5000,sessionReadyTimeoutMs:20000,sessionStableMs:3000,composerTextTimeoutMs:4000,sendControlTimeoutMs:5000,submissionTimeoutMs:10000,conversationLinkGraceMs:5000,conversationLinkStableMs:1500,conversationLinkTimeoutMs:30000,tabReadyTimeoutMs:30000,bridgeReadyTimeoutMs:15000,pollIntervalMs:500,assistantStableMs:1500,snapshotDebounceMs:700,chatSnapshotPollMs:5000,setupReplyTimeoutMs:120000,a0ResponseTimeoutMs:180000,githubRequestTimeoutMs:20000};
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
    const generating=Boolean(stopControl());
    const assistantText=latestRole==='assistant'?latestMessage:'';
    const assistantKey=assistantText?`${cleanUrl()}|${latestMessageId}|${assistantText}`:'';
    if(assistantKey!==lastAssistantKey){lastAssistantKey=assistantKey;assistantStableSince=assistantKey?Date.now():0;}
    const voiceControl=startVoiceControl();
    const responseStable=Boolean(assistantStableSince&&Date.now()-assistantStableSince>=timings.assistantStableMs);
    const idleCandidate=hasComposer&&!generating&&Boolean(voiceControl)&&!normalizeText(composerText(currentComposer))&&(latestRole!=='assistant'||responseStable);
    if(hasComposer&&!generating&&voiceControl&&!normalizeText(composerText(currentComposer))&&latestRole==='assistant'&&!responseStable){scheduleSettle(timings.assistantStableMs-(Date.now()-assistantStableSince));}
    const state = generating ? 'GENERATING' : idleCandidate ? 'IDLE' : 'UNKNOWN';
    return {conversationUrl: cleanUrl(), state, latestRole, latestMessageId, latestMessage, observedAt: new Date().toISOString()};
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
    const pageLoaded=document.readyState==='complete';
    let state='WAITING';
    if(!pageLoaded)state='LOADING';
    else if(text&&arrow&&enabledButton(arrow))state='PROMPT_READY';
    else if(stop&&enabledButton(stop))state='WORKING';
    else if(!text&&voice&&enabledButton(voice))state=conversation?'IDLE':'NEW';
    return {href:location.href,hasConversationUrl:conversation,conversationUrl:conversation?cleanUrl():'',pageLoaded,composerVisible:visible,composerEmpty:!text,composerLength:text.length,voiceVisible:Boolean(voice),voiceEnabled:enabledButton(voice),arrowVisible:Boolean(arrow),arrowEnabled:enabledButton(arrow),stopVisible:Boolean(stop),stopEnabled:enabledButton(stop),pauseVisible:Boolean(pause),pauseEnabled:enabledButton(pause),userMessageCount:userMessages().length,state,observedAt:new Date().toISOString()};
  }

  function sendSnapshot(force=false,onComplete) {
    if (!enabled || !chrome?.runtime?.id) { onComplete?.({error:'AgentSync bridge is disabled.'}); return; }
    // ChatGPT can briefly route a tab through its home URL while switching
    // conversations. Do not send that transient page as a registered chat.
    if (!/^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname)) { onComplete?.({received:true,ignored:true}); return; }
    const snapshot = readSnapshot();
    const key = JSON.stringify([snapshot.state, snapshot.latestRole, snapshot.latestMessageId]);
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
  async function waitForSubmission(prompt,beforeCount,priorUrl,settings){
    const timeoutMs=settings.submissionTimeoutMs;
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      if(accountChanged())throw new Error('ChatGPT reports the signed-in account changed. Submission is uncertain; AgentSync will not retry automatically.');
      if(visibleError())throw new Error('ChatGPT displayed an error while submitting. AgentSync will not retry automatically.');
      const currentUsers=userMessages();
      const currentComposer=composer();
      const composerEmpty=!normalizeText(composerText(currentComposer));
      const conversationOpened=location.pathname.startsWith('/c/')&&location.href!==priorUrl;
      const posted=currentUsers.length>beforeCount&&currentUsers.slice(beforeCount).some(node=>textOf(node).includes(prompt));
      if(composerEmpty&&(posted||Boolean(stopControl())||conversationOpened))return true;
      await wait(settings.pollIntervalMs);
    }
    const currentComposer=composer();
    return !normalizeText(composerText(currentComposer))&&userMessages().slice(beforeCount).some(node=>textOf(node).includes(prompt));
  }

  async function submitTextOnce(message) {
    const settings=resolveTimings(message.timings);
    if (message.conversationUrl !== cleanUrl()) throw new Error('Target conversation changed before handoff.');
    if(typeof message.dedupeKey!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(message.dedupeKey))throw new Error('Missing or invalid AgentSync delivery ID.');
    const marker=`AgentSync delivery ID: ${message.dedupeKey}`;
    const priorUsers=userMessages();
    if(priorUsers.some(node=>textOf(node).includes(marker)))return {submitted:true,duplicate:true};
    const before=priorUsers.length;
    if (typeof message.text !== 'string' || !message.text.trim()) throw new Error('AgentSync prompt is empty.');
    if (message.text.length > 250_000) throw new Error(`AgentSync prompt has ${message.text.length.toLocaleString()} characters; the current bridge limit is 250,000.`);
    const input=await waitForSessionReady(settings.sessionReadyTimeoutMs,settings);
    const existingDraft=normalizeText(composerText(input));
    const exactAgentSyncDraft=existingDraft===normalizeText(message.text)&&existingDraft.includes(marker);
    const freshHome=message.allowFreshChat===true&&location.origin==='https://chatgpt.com'&&location.pathname==='/'&&!location.search&&!location.hash&&userMessages().length===0&&!stopControl()&&!visibleError();
    if(readSnapshot().state!=='IDLE'&&!exactAgentSyncDraft&&!freshHome)throw new Error('Chat is not confirmed idle. Inspect the registered conversation before retrying.');
    if(existingDraft&&!exactAgentSyncDraft&&!freshHome)throw new Error('The ChatGPT composer contains a different unsent draft. Submit or remove it yourself before AgentSync continues.');
    if(exactAgentSyncDraft&&(stopControl()||visibleError()))throw new Error('ChatGPT is generating or showing an error. Wait for it to settle before resuming the saved AgentSync draft.');
    const priorUrl=location.href;
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
    if(await waitForSubmission(marker,before,priorUrl,settings)){queueMicrotask(sendSnapshot);return {submitted:true};}
    throw new Error('Submission result is uncertain; AgentSync will not retry automatically.');
  }

  async function createChat(message) {
    const settings=resolveTimings(message.timings);
    if(location.origin!=='https://chatgpt.com'||location.pathname!=='/'||location.search||location.hash)throw new Error('New-chat setup is limited to a fresh ChatGPT home tab.');
    if(document.querySelector('[data-message-author-role="user"],[data-message-author-role="assistant"]'))throw new Error('ChatGPT tab is not a fresh conversation.');
    if(typeof message.text!=='string'||!message.text.trim()||message.text.length>30_000)throw new Error('Setup prompt is empty or too long.');
    const key=message.dedupeKey;
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(key))throw new Error('Missing or invalid AgentSync delivery ID.');
    const result=await submitText({conversationUrl:cleanUrl(),dedupeKey:key,text:`${message.text}\n\nAgentSync delivery ID: ${key}`,allowFreshChat:true,timings:settings});
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
