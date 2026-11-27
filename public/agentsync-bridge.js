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
  const defaultTimings={pageSettleMs:5000,sessionReadyTimeoutMs:20000,sessionStableMs:3000,composerTextTimeoutMs:4000,sendControlTimeoutMs:5000,submissionTimeoutMs:10000,conversationLinkGraceMs:10000,conversationLinkStableMs:1500,conversationLinkTimeoutMs:30000,tabReadyTimeoutMs:30000,bridgeReadyTimeoutMs:15000,pollIntervalMs:500,assistantStableMs:1500,snapshotDebounceMs:700,chatSnapshotPollMs:5000,setupReplyTimeoutMs:120000,a0ResponseTimeoutMs:180000,githubRequestTimeoutMs:20000};
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
  const stopIcon = button => [...(button.querySelectorAll?.('svg path') || [])].some(path=>normalizeText(path.getAttribute('d'))===stopSquarePath);
  const stopControl = () => visibleButtons().find(button => /stop generating|stop streaming|cancel response/i.test(buttonLabel(button)) || /stop-button/i.test(button.getAttribute('data-testid') || '') || stopIcon(button));
  function startVoiceControl(){
    for(const button of visibleButtons()){
      const ariaLabel=(button.getAttribute('aria-label') || '').trim();
      const voiceMarker=button.getAttribute('data-composer-voice-start') === 'true';
      // ChatGPT builds do not consistently expose the data marker or SVG use
      // reference. The accessible action label is the stable signal users see.
      if(/^start voice(?: mode)?$/i.test(ariaLabel)||voiceMarker)return button;
    }
    for(const use of document.querySelectorAll('button svg use')){
      const href=use.getAttribute('href') || use.getAttributeNS('http://www.w3.org/1999/xlink','href') || use.href?.baseVal || '';
      const button=use.closest('button');
      // The visible composer voice action can have a localized or missing
      // accessible label. Its ChatGPT sprite symbol is a stable fallback.
      if(button&&isVisible(button)&&href.includes('#codex-icon-voice-regular-20'))return button;
    }
    return null;
  }
  function sendControl(input){
    const composerForm=input?.closest?.('form');
    const voice=startVoiceControl();
    return visibleButtons().find(button=>{
      if(button===voice)return false;
      if(button.disabled||button.getAttribute('aria-hidden')==='true'||button.getAttribute('aria-disabled')==='true')return false;
      const label=buttonLabel(button);
      if(/\bstart voice\b/i.test(label))return false;
      const namedSend=button.getAttribute('data-testid')==='send-button'||/\bsend(?:\s+(?:prompt|message))?\b/i.test(label);
      const composerSubmit=Boolean(composerForm&&button.type==='submit'&&composerForm.contains(button));
      return namedSend||composerSubmit;
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
    const staleDraft=normalizeText(composerText(input));
    if(staleDraft){
      setComposerText(input,'');
      if(!await waitForComposerText(input,'',settings.composerTextTimeoutMs,settings))throw new Error('AgentSync could not clear the previous ChatGPT draft. No prompt was submitted.');
    }
    // ChatGPT can retain an old draft across fresh-home tabs and hydrate its
    // composer controls asynchronously. Let the page settle before replacing it.
    await wait(settings.pageSettleMs);
    if(normalizeText(composerText(input)))throw new Error('ChatGPT restored text in the composer while preparing a new chat. No prompt was submitted.');
    if(!startVoiceControl())throw new Error(`ChatGPT voice control did not appear in the empty composer after the ${settings.pageSettleMs} ms page settle. No prompt was submitted.`);
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
      const sessionEvidence=profile?`profile:${profileState}`:registeredConversation?'registered-conversation-with-assistant-reply':'';
      const ready=document.readyState==='complete'&&isVisible(currentComposer)&&!currentComposer.disabled&&currentComposer.getAttribute('aria-disabled')!=='true'&&Boolean(sessionEvidence);
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
      if(normalizeText(composerText(element))===normalizeText(text))return true;
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
      if(currentUsers.length>beforeCount&&currentUsers.slice(beforeCount).some(node=>textOf(node).includes(prompt)))return true;
      const currentComposer=composer();
      const composerEmpty=!normalizeText(composerText(currentComposer));
      const conversationOpened=location.pathname.startsWith('/c/')&&location.href!==priorUrl;
      if(Boolean(stopControl())||(composerEmpty&&conversationOpened))return true;
      await wait(settings.pollIntervalMs);
    }
    return userMessages().slice(beforeCount).some(node=>textOf(node).includes(prompt));
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
    if(freshHome)await settleNewChatComposer(input,settings);
    if(!exactAgentSyncDraft||freshHome)setComposerText(input,message.text);
    if(!await waitForComposerText(input,message.text,settings.composerTextTimeoutMs,settings))throw new Error('AgentSync could not verify the exact prompt in the composer. Nothing was submitted.');
    if(!await waitForSendControl(input,settings))throw new Error('ChatGPT send arrow did not appear for the non-empty composer. No prompt was submitted.');
    const send=sendControl(input);
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
