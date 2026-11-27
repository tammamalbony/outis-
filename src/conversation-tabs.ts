import { conversationUrl } from './core.ts';
export type TabSnapshot = { id?: number; windowId?: number; url?: string; pendingUrl?: string; active?: boolean; incognito?: boolean };
export type TabPort = {
  list(): Promise<TabSnapshot[]>;
  get(id:number): Promise<TabSnapshot>;
  activate(id:number): Promise<TabSnapshot>;
  focusWindow(id:number): Promise<unknown>;
  create(url:string): Promise<TabSnapshot>;
};
export type OpenResult = 'REUSED' | 'OPENED_NEW';
export function matchesConversation(tab:TabSnapshot,expected:string):boolean {
  if(tab.incognito||tab.id===undefined||tab.pendingUrl||!tab.url)return false;
  try{return conversationUrl(tab.url)===conversationUrl(expected);}catch{return false;}
}
export function chooseConversationTab(tabs:TabSnapshot[],url:string):TabSnapshot|undefined {
  const expected=conversationUrl(url);
  return tabs.filter(t=>matchesConversation(t,expected)).sort((a,b)=>Number(Boolean(b.active))-Number(Boolean(a.active))||a.id!-b.id!)[0];
}
export async function openConversation(port:TabPort,url:string,canInspect:boolean):Promise<OpenResult>{
  const expected=conversationUrl(url);
  if(!canInspect){await port.create(expected);return 'OPENED_NEW';}
  const chosen=chooseConversationTab(await port.list(),expected);
  if(!chosen){await port.create(expected);return 'OPENED_NEW';}
  const current=await port.get(chosen.id!);
  if(!matchesConversation(current,expected)||current.id!==chosen.id)throw new Error('Saved chat tab changed. Retry and verify the conversation manually.');
  const activated=await port.activate(chosen.id!);
  if(!matchesConversation(activated,expected)||activated.id!==chosen.id||activated.windowId===undefined)throw new Error('Chat identity changed while opening. Verify the conversation manually.');
  await port.focusWindow(activated.windowId);
  const final=await port.get(chosen.id!);
  if(!matchesConversation(final,expected)||final.id!==chosen.id)throw new Error('Chat identity changed while focusing. Verify the conversation manually.');
  return 'REUSED';
}
export function activeConversation(tab:TabSnapshot|undefined):string {
  if(!tab||!tab.active||tab.incognito||tab.pendingUrl||!tab.url)throw new Error('Select a loaded, normal ChatGPT conversation tab first.');
  return conversationUrl(tab.url);
}
