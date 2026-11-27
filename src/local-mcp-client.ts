import {browser} from 'wxt/browser';
import type {Agent} from './core';
import type {ChatSnapshot} from './agent-bridge';

const api='http://127.0.0.1:8765';
const tokenKey='agentsync.localMcp.token.v1';
const sentRepliesKey='agentsync.localMcp.sentChatReplies.v1';
const uploads=new Map<string,Promise<{itemId:number;duplicate:boolean}|undefined>>();

export async function storeCompletedChatReply(agent:Agent,snapshot:ChatSnapshot):Promise<{itemId:number;duplicate:boolean}|undefined>{
  if(snapshot.state!=='IDLE'||snapshot.latestRole!=='assistant'||!snapshot.latestMessageId||!snapshot.latestMessage.trim()||!agent.lastOrderId)return undefined;
  const dedupeName=`agentsync.chat-final.v1:${agent.id}:${snapshot.latestMessageId}`;
  const key=`${agent.id}:${snapshot.latestMessageId}`;
  const pending=uploads.get(key);
  if(pending)return pending;
  const operation=(async()=>{
    const stored=await browser.storage.local.get([tokenKey,sentRepliesKey]);
    const token=stored[tokenKey];
    if(typeof token!=='string'||!token)return undefined;
    const sent=(stored[sentRepliesKey]&&typeof stored[sentRepliesKey]==='object'?stored[sentRepliesKey]:{}) as Record<string,string>;
    if(sent[agent.id]===snapshot.latestMessageId)return undefined;
    const response=await fetch(`${api}/api/extension/items`,{
      method:'POST',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({kind:'data',name:dedupeName,payload:{schema:'agentsync.chat-final.v1',messageId:snapshot.latestMessageId,teamId:agent.teamId,agentId:agent.id,agentNumber:agent.number,chatName:agent.chatName??`A${agent.number} · ${agent.role}`,conversationUrl:snapshot.conversationUrl,executionId:agent.lastOrderId,role:snapshot.latestRole,state:snapshot.state,response:snapshot.latestMessage}}),
      signal:AbortSignal.timeout(10_000),
    });
    let result:{id?:number;duplicate?:boolean;error?:string}={};
    try{result=await response.json() as typeof result;}catch{}
    if(!response.ok){
      if(response.status===401)await browser.storage.local.remove(tokenKey);
      throw new Error(result.error||`Local MCP server returned HTTP ${response.status}.`);
    }
    if(typeof result.id!=='number')throw new Error('Local MCP server did not confirm that the reply was stored.');
    await browser.storage.local.set({[sentRepliesKey]:{...sent,[agent.id]:snapshot.latestMessageId}});
    return {itemId:result.id,duplicate:result.duplicate===true};
  })();
  uploads.set(key,operation);
  try{return await operation;}finally{uploads.delete(key);}
}
