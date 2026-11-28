import { browser } from 'wxt/browser';
import { chooseConversationTab,matchesConversation,openConversation,activeConversation,type TabPort } from './conversation-tabs';
import {bridgeMatchPatterns} from './agent-bridge-registration';
import {conversationUrl} from './core';
import {loadTimingSettings} from './extension-settings';
const origin='https://chatgpt.com/*';
const bridgeScriptId='agentsync-registered-chat-bridge-v1';
const pageStatusScriptId='agentsync-chatgpt-page-status-v1';
const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
export type ChatStatusSnapshot={href:string;hasConversationUrl:boolean;conversationUrl:string;pageLoaded:boolean;composerVisible:boolean;composerText:string;composerTextTruncated:boolean;composerMode:'CHAT'|'WORK'|'UNKNOWN';effort:'LOW'|'MEDIUM'|'HIGH'|'UNKNOWN';composerEmpty:boolean;composerLength:number;voiceVisible:boolean;voiceEnabled:boolean;arrowVisible:boolean;arrowEnabled:boolean;stopVisible:boolean;stopEnabled:boolean;pauseVisible:boolean;pauseEnabled:boolean;userMessageCount:number;latestUserMessage:string;latestUserMessageTruncated:boolean;latestReplyText:string;latestReplyTruncated:boolean;latestReplyFirstLine:string;latestReplyCopyStatus:'NOT_COPIED'|'COPY_CLICKED'|'COPIED';state:'LOADING'|'NEW'|'IDLE'|'WORKING'|'PROMPT_READY'|'SUBMITTED'|'WAITING';observedAt:string};
type BridgeActionResult={confirmed?:boolean;clicked?:boolean;error?:string};
async function sendChatPageMessage<T>(tabId:number,type:string,payload:Record<string,unknown>={}):Promise<T|undefined>{
  const tab=await browser.tabs.get(tabId);
  if(!tab.url?.startsWith('https://chatgpt.com/'))throw new Error('This action is only available on chatgpt.com.');
  await browser.scripting.executeScript({target:{tabId},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
  return browser.tabs.sendMessage(tabId,{type,...payload}) as Promise<T|undefined>;
}
async function reconcileAfterReload(tabId:number,expectedUrl:string,dedupeKey:string,text:string,allowNewConversation=false){
  const deliveryReconcileTimeoutMs=(await loadTimingSettings()).deliveryReconcileTimeoutMs;
  const allowed=(tab:{url?:string})=>{
    if(allowNewConversation)return tab.url==='https://chatgpt.com/'||tab.url==='https://chatgpt.com'||/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+\/?$/.test(tab.url??'');
    return Boolean(tab.url&&matchesConversation(tab,expectedUrl));
  };
  let tab=await browser.tabs.get(tabId);
  if(!allowed(tab))return {confirmed:false,conversationUrl:'',reason:'The ChatGPT tab no longer matches the requested conversation.'};
  await browser.tabs.reload(tabId);
  const deadline=Date.now()+deliveryReconcileTimeoutMs;
  let reason='The last user message was not available after reloading ChatGPT.';
  while(Date.now()<deadline){
    tab=await browser.tabs.get(tabId);
    if(tab.pendingUrl||!tab.url||tab.status!=='complete'){await wait(500);continue;}
    if(!allowed(tab))return {confirmed:false,conversationUrl:'',reason:'The ChatGPT tab changed to a different page during verification.'};
    try{
      await browser.scripting.executeScript({target:{tabId},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
      const proof=await browser.tabs.sendMessage(tabId,{type:'AGENTSYNC_VERIFY_LAST_USER_MESSAGE',conversationUrl:expectedUrl,dedupeKey,text,allowNewConversation}) as {confirmed?:boolean;reason?:string;conversationUrl?:string}|undefined;
      if(proof?.confirmed===true)return {confirmed:true,conversationUrl:proof.conversationUrl??tab.url??'',reason:proof.reason??'Exact last user message and empty composer confirmed after reload.'};
      reason=proof?.reason??reason;
    }catch{/* Wait for the reloaded ChatGPT page and bridge to become available. */}
    await wait(500);
  }
  return {confirmed:false,conversationUrl:'',reason:`${reason} No prompt was resent.`};
}
const port:TabPort={
  list:()=>browser.tabs.query({url:'https://chatgpt.com/c/*'}),
  get:id=>browser.tabs.get(id),
  activate:async id=>{
    const tab=await browser.tabs.update(id,{active:true});
    if(!tab)throw new Error('Chat tab disappeared.');
    return tab;
  },
  focusWindow:id=>browser.windows.update(id,{focused:true}),
  create:url=>browser.tabs.create({url}),
};
async function ensurePageStatusRail(){
  if(!await browser.permissions.contains({origins:[origin]}))return false;
  const registered=await browser.scripting.getRegisteredContentScripts({ids:[pageStatusScriptId]});
  if(!registered.length)await browser.scripting.registerContentScripts([{id:pageStatusScriptId,matches:['https://chatgpt.com/*'],js:['agentsync-page-status.js'],runAt:'document_idle',persistAcrossSessions:true,world:'ISOLATED'}]);
  const tabs=await browser.tabs.query({url:'https://chatgpt.com/*'});
  for(const tab of tabs)if(tab.id!==undefined)try{await browser.scripting.executeScript({target:{tabId:tab.id},files:['agentsync-page-status.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);}catch{/* Chrome pages may be mid-navigation; the registered script runs when they next load. */}
  return true;
}
export const chatAdapter = {
  async openNew(){return browser.tabs.create({url:'https://chatgpt.com/'});},
  async readStatusSnapshot(tabId:number){
    const snapshot=await sendChatPageMessage<ChatStatusSnapshot>(tabId,'AGENTSYNC_TEST_SNAPSHOT');
    if(!snapshot)throw new Error('ChatGPT did not return a status snapshot.');
    return snapshot;
  },
  async setComposerMode(tabId:number,mode:'CHAT'|'WORK'){
    return sendChatPageMessage<BridgeActionResult>(tabId,'AGENTSYNC_SET_COMPOSER_MODE',{mode});
  },
  async ensureChatMode(tabId:number){
    return sendChatPageMessage<BridgeActionResult>(tabId,'AGENTSYNC_ENSURE_CHAT_MODE');
  },
  async setEffort(tabId:number,effort:'LOW'|'MEDIUM'|'HIGH'){
    return sendChatPageMessage<BridgeActionResult>(tabId,'AGENTSYNC_SET_EFFORT',{effort});
  },
  async clearComposer(tabId:number){
    return sendChatPageMessage<BridgeActionResult>(tabId,'AGENTSYNC_TEST_CLEAR_COMPOSER');
  },
  async setComposerText(tabId:number,text:string){
    return sendChatPageMessage<BridgeActionResult>(tabId,'AGENTSYNC_TEST_SET_COMPOSER_TEXT',{text});
  },
  async clickSendArrow(tabId:number){
    return sendChatPageMessage<BridgeActionResult>(tabId,'AGENTSYNC_TEST_CLICK_SEND_ARROW');
  },
  async listOpenConversations(){
    if(!await browser.permissions.contains({origins:[origin]}))return null;
    return port.list();
  },
  async openExisting(url:string){
    const granted=await browser.permissions.contains({origins:[origin]});
    return openConversation(port,url,granted);
  },
  async enableTabReuse(){return browser.permissions.request({origins:[origin]});},
  async ensureChatAccess(){
    const granted=await browser.permissions.contains({origins:[origin]})||await browser.permissions.request({origins:[origin]});
    if(granted)await ensurePageStatusRail();
    return granted;
  },
  async ensurePageStatusRail(){return ensurePageStatusRail();},
  async reconcileSubmission(tabId:number,expectedUrl:string,dedupeKey:string,text:string,allowNewConversation=false){
    return reconcileAfterReload(tabId,expectedUrl,dedupeKey,text,allowNewConversation);
  },
  async startApprovedTeam(teamId:string){
    const result=await browser.runtime.sendMessage({type:'AGENTSYNC_START_APPROVED_TEAM',teamId}) as {started?:boolean;error?:string}|undefined;
    if(result?.error)throw new Error(result.error);
    if(result?.started!==true)throw new Error('AgentSync could not confirm the plan start. Inspect the team state before retrying.');
  },
  async continueA0Workflow(teamId:string){
    const result=await browser.runtime.sendMessage({type:'AGENTSYNC_CONTINUE_A0_WORKFLOW',teamId}) as {continued?:boolean;error?:string}|undefined;
    if(result?.error)throw new Error(result.error);
    if(result?.continued!==true)throw new Error('AgentSync could not confirm the A0 response was processed. Check the team state before retrying.');
  },
  async startA0PlanningBatch(batchId:string){
    const result=await browser.runtime.sendMessage({type:'AGENTSYNC_START_A0_PLANNING_BATCH',batchId}) as {started?:boolean;error?:string}|undefined;
    if(result?.error)throw new Error(result.error);
    if(result?.started!==true)throw new Error('AgentSync could not confirm A0 planning startup. Check the team state before retrying.');
  },
  async enableA0Bridge(chatUrls:readonly string[]){
    const matches=bridgeMatchPatterns(chatUrls);
    if(!await browser.permissions.contains({origins:[origin]})&&!await browser.permissions.request({origins:[origin]}))throw new Error('ChatGPT site access was not granted.');
    await ensurePageStatusRail();
    await chatAdapter.disableA0Bridge(chatUrls);
    await browser.scripting.registerContentScripts([{id:bridgeScriptId,matches,js:['agentsync-bridge.js'],runAt:'document_idle',persistAcrossSessions:true,world:'ISOLATED'}]);
    const tabs=await browser.tabs.query({url:'https://chatgpt.com/c/*'});
    const registered=new Set(chatUrls.map(conversationUrl));
    const failures:string[]=[];
    for(const tab of tabs){
      let url='';try{url=tab.url?conversationUrl(tab.url):'';}catch{/* Ignore non-conversation tabs. */}
      if(tab.id===undefined||!registered.has(url))continue;
      try{
        await browser.scripting.executeScript({target:{tabId:tab.id},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
        const ping=await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_BRIDGE_PING'}) as {ready?:boolean;error?:string}|undefined;
        if(ping?.ready!==true)failures.push(`${url}: ${ping?.error??'bridge did not acknowledge the snapshot'}`);
      }catch(error){failures.push(`${url}: ${error instanceof Error?error.message:String(error)}`);}
    }
    if(failures.length)throw new Error(`The bridge was registered, but AgentSync could not confirm ${failures.length} open chat tab(s): ${failures.slice(0,3).join('; ')}`);
    return matches.length;
  },
  async ensureRegisteredChatTabs(chatUrls:readonly string[]){
    if(!await browser.permissions.contains({origins:[origin]})&&!await browser.permissions.request({origins:[origin]}))throw new Error('ChatGPT site access was not granted.');
    await ensurePageStatusRail();
    const timings=await loadTimingSettings();
    const open=await browser.tabs.query({url:'https://chatgpt.com/c/*'});
    for(const rawUrl of [...new Set(chatUrls.map(conversationUrl))]){
      let tab=chooseConversationTab(open,rawUrl);
      if(!tab){
        tab=await browser.tabs.create({url:rawUrl,active:false});
      }
      if(tab.id===undefined)throw new Error(`Could not open registered chat ${rawUrl}.`);
      const deadline=Date.now()+timings.tabReadyTimeoutMs;
      while(Date.now()<deadline){
        const current=await browser.tabs.get(tab.id);
        if(current.pendingUrl||!current.url){await new Promise(resolve=>setTimeout(resolve,timings.pollIntervalMs));continue;}
        if(!matchesConversation(current,rawUrl))throw new Error(`Registered chat changed while opening: ${rawUrl}.`);
        if(current.status==='complete')break;
        await new Promise(resolve=>setTimeout(resolve,timings.pollIntervalMs));
      }
      const ready=await browser.tabs.get(tab.id);
      if(!matchesConversation(ready,rawUrl)||ready.status!=='complete')throw new Error(`Registered chat did not finish loading before the ${timings.tabReadyTimeoutMs} ms timeout: ${rawUrl}.`);
    }
  },
  async disableA0Bridge(chatUrls:readonly string[]=[]){
    const registered=await browser.scripting.getRegisteredContentScripts({ids:[bridgeScriptId]});
    const matches=[...new Set([...registered.flatMap(script=>script.matches??[]),...(chatUrls.length?bridgeMatchPatterns(chatUrls):[])])];
    if(matches.length){
      const tabs=await browser.tabs.query({url:matches});
      for(const tab of tabs)if(tab.id!==undefined)try{await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_BRIDGE_DISABLE'});}catch{/* No active AgentSync bridge in this tab. */}
    }
    if(registered.length){
      await browser.scripting.unregisterContentScripts({ids:[bridgeScriptId]});
    }
  },
  async isA0BridgeEnabled(){return (await browser.scripting.getRegisteredContentScripts({ids:[bridgeScriptId]})).length>0;},
  async retryPendingOrder(orderId:string){
    const result=await browser.runtime.sendMessage({type:'AGENTSYNC_RETRY_PENDING_ORDER',orderId}) as {sent?:boolean;error?:string}|undefined;
    if(result?.error)throw new Error(result.error);
    if(result?.sent!==true)throw new Error('AgentSync could not confirm the pending prompt send. Inspect the saved chat before retrying.');
  },
  async sendBridgeMessage(url:string,message:{type:string;conversationUrl:string;text?:string;dedupeKey:string},{activate=false}:{activate?:boolean}={}){
    const expected=conversationUrl(url);
    if(message.conversationUrl!==expected)throw new Error('Bridge message target does not match its registered chat.');
    if(!await browser.permissions.contains({origins:[origin]}))throw new Error('ChatGPT site access is not enabled.');
    let tab=chooseConversationTab(await port.list(),expected);
    if(!tab){tab=await port.create(expected);}
    if(tab.id===undefined)throw new Error('Could not open the registered chat tab.');
    if(activate){
      const current=await port.get(tab.id);
      if(!matchesConversation(current,expected))throw new Error('Registered chat tab changed before continuation.');
      const focused=await port.activate(tab.id);
      if(!matchesConversation(focused,expected)||focused.windowId===undefined)throw new Error('Could not verify the registered chat before continuation.');
      await port.focusWindow(focused.windowId);
    }
    const timings=await loadTimingSettings();
    const deadline=Date.now()+timings.bridgeReadyTimeoutMs;
    let lastError='ChatGPT bridge did not become ready.';
    while(Date.now()<deadline){
      const current=await port.get(tab.id);
      if(current.pendingUrl||!current.url){await new Promise(resolve=>setTimeout(resolve,timings.pollIntervalMs));continue;}
      if(!matchesConversation(current,expected))throw new Error('Registered chat tab changed while preparing the bridge.');
      try{
        const response=await browser.tabs.sendMessage(tab.id,{...message,timings}) as {submitted?:boolean;uncertain?:boolean;error?:string;conversationUrl?:string}|undefined;
        if(response?.uncertain&&message.text){
          const reconciled=await reconcileAfterReload(tab.id,expected,message.dedupeKey,message.text);
          if(reconciled.confirmed)return {...response,submitted:true,duplicate:true,recovered:true,conversationUrl:reconciled.conversationUrl};
          return {...response,error:`${response.error??'Submission could not be confirmed.'} After one reload: ${reconciled.reason}`};
        }
        return response;
      }
      catch(error){
        lastError=error instanceof Error?error.message:String(error);
        try{await browser.scripting.executeScript({target:{tabId:tab.id},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);}catch{/* The tab may still be navigating; retry briefly. */}
      }
      await new Promise(resolve=>setTimeout(resolve,timings.pollIntervalMs));
    }
    throw new Error(lastError);
  },
  async createNewChat(prompt:string,dedupeKey:string){
    if(!await browser.permissions.contains({origins:[origin]}))throw new Error('Grant ChatGPT site access before starting the approved plan.');
    const tab=await browser.tabs.create({url:'https://chatgpt.com/'});
    if(tab.id===undefined)throw new Error('Could not open a new ChatGPT tab.');
    const timings=await loadTimingSettings();
    const deadline=Date.now()+timings.tabReadyTimeoutMs;
    let lastError='ChatGPT setup page did not become ready.';
    while(Date.now()<deadline){
      const current=await browser.tabs.get(tab.id);
      if(current.pendingUrl||!current.url||current.status!=='complete'){await new Promise(resolve=>setTimeout(resolve,timings.pollIntervalMs));continue;}
      if(current.url!=='https://chatgpt.com/'&&current.url!=='https://chatgpt.com')throw new Error('New ChatGPT tab navigated away before setup.');
      try{
        await browser.scripting.executeScript({target:{tabId:tab.id},files:['agentsync-bridge.js']} as unknown as Parameters<typeof browser.scripting.executeScript>[0]);
        const result=await browser.tabs.sendMessage(tab.id,{type:'AGENTSYNC_CREATE_CHAT',text:prompt,dedupeKey,timings}) as {submitted?:boolean;uncertain?:boolean;conversationUrl?:string;error?:string}|undefined;
        if(result?.error){lastError=result.error;if(/composer is unavailable|not visibly idle/i.test(lastError)){await new Promise(resolve=>setTimeout(resolve,timings.pollIntervalMs));continue;}throw new Error(lastError);}
        if(result?.uncertain&&result.error){
          const recovered=await reconcileAfterReload(tab.id,'https://chatgpt.com/',dedupeKey,`${prompt}\n\nAgentSync delivery ID: ${dedupeKey}`,true);
          if(!recovered.confirmed)throw new Error(`${result.error} After one reload: ${recovered.reason}`);
          const recoveredUrl=conversationUrl(recovered.conversationUrl);
          const recoveredTab=await browser.tabs.get(tab.id);
          if(!matchesConversation(recoveredTab,recoveredUrl))throw new Error('The exact setup prompt was found after reload, but the conversation URL could not be confirmed. Inspect ChatGPT; no setup prompt was resent.');
          return recoveredUrl;
        }
        if(result?.submitted!==true||!result.conversationUrl)throw new Error('ChatGPT setup submission is uncertain; no setup prompt was resent. Inspect the last user message before retrying.');
        const url=conversationUrl(result.conversationUrl);
        const latest=await browser.tabs.get(tab.id);
        if(!matchesConversation(latest,url))throw new Error('New conversation URL did not match the created tab.');
        return url;
      }catch(error){
        if(error instanceof Error&&/Receiving end does not exist|Could not establish connection/i.test(error.message)){lastError=error.message;await new Promise(resolve=>setTimeout(resolve,timings.pollIntervalMs));continue;}
        throw error;
      }
    }
    throw new Error(lastError);
  },
  async activeChatUrl(){
    if(!await browser.permissions.contains({origins:[origin]}))throw new Error('Enable chat tab access first.');
    const [tab]=await browser.tabs.query({active:true,currentWindow:true});
    return activeConversation(tab);
  },
  async copyPrompt(prompt:string){if(!await browser.permissions.contains({permissions:['clipboardWrite']}))throw new Error('Grant clipboard writing in Settings before copying prompts.');await navigator.clipboard.writeText(prompt);},
};
