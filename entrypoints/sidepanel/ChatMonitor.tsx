import {useCallback,useEffect,useMemo,useState} from 'react';
import type {Agent,AgentBridgeObservation,Order,Team} from '../../src/core';
import {buildChatMonitorEntries,CHAT_STATUS_POLL_MS} from '../../src/chat-monitor';
import type {TabSnapshot} from '../../src/conversation-tabs';
import {chatAdapter} from '../../src/chat-adapter';

type ChatFilter='ONGOING'|'ALL';
const statusLabel=(value:string)=>value.toLowerCase().replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

export default function ChatMonitor({agents,teams,orders,observations,onOpenChat}:{agents:Agent[];teams:Team[];orders:Order[];observations:AgentBridgeObservation[];onOpenChat:(url:string)=>void}){
  const [filter,setFilter]=useState<ChatFilter>('ONGOING');
  const [tabs,setTabs]=useState<TabSnapshot[]|null>(null);
  const [lastRefresh,setLastRefresh]=useState<Date>();
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const [permissionBusy,setPermissionBusy]=useState(false);

  const refresh=useCallback(async()=>{
    setRefreshing(true);setError('');
    try{setTabs(await chatAdapter.listOpenConversations());setLastRefresh(new Date());}
    catch(e){setTabs(null);setError(e instanceof Error?e.message:String(e));}
    finally{setRefreshing(false);}
  },[]);
  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>void refresh(),CHAT_STATUS_POLL_MS);
    return ()=>window.clearInterval(timer);
  },[refresh]);
  const entries=useMemo(()=>buildChatMonitorEntries(agents,teams,orders,tabs,observations),[agents,teams,orders,tabs,observations]);
  const visible=filter==='ONGOING'?entries.filter(entry=>entry.agent.state!=='COMPLETED'):entries;
  async function enableTabVisibility(){
    setPermissionBusy(true);setError('');
    try{
      if(!await chatAdapter.enableTabReuse())throw new Error('Permission was not granted. Saved chats can still be opened manually.');
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setPermissionBusy(false);}
  }

  return <section className="chat-monitor panel" aria-labelledby="chat-monitor-title">
    <div className="monitor-heading">
      <div><p className="eyebrow">LIVE OVERVIEW</p><h2 id="chat-monitor-title">Ongoing chats</h2><p>ChatGPT generation, AgentSync task status and tab presence</p></div>
      <button className="refresh-button" type="button" onClick={()=>void refresh()} disabled={refreshing} aria-label="Refresh chat status">{refreshing?'Checking…':'Refresh'}</button>
    </div>
    <div className="monitor-toolbar">
      <div className="filter-tabs" role="group" aria-label="Filter conversations">
        <button type="button" aria-pressed={filter==='ONGOING'} onClick={()=>setFilter('ONGOING')}>Ongoing <span>{entries.filter(entry=>entry.agent.state!=='COMPLETED').length}</span></button>
        <button type="button" aria-pressed={filter==='ALL'} onClick={()=>setFilter('ALL')}>All <span>{entries.length}</span></button>
      </div>
      <span className="refresh-setting">Automatic scan · every 5 sec</span>
    </div>
    <div className="monitor-status" aria-live="polite">
      <span className={`connection-dot ${tabs===null?'is-muted':'is-live'}`}/>
      {tabs===null?'ChatGPT tab visibility is off':`Updated ${lastRefresh?.toLocaleTimeString()??'just now'} · next check in 5 sec`}
    </div>
    {tabs===null&&<div className="permission-note"><p>Enable optional ChatGPT tab access to see which saved conversations are open. AgentSync reads tab URLs and active state only.</p><button type="button" onClick={()=>void enableTabVisibility()} disabled={permissionBusy}>{permissionBusy?'Requesting…':'Enable tab visibility'}</button></div>}
    {error&&<p role="alert" className="error">{error}</p>}
    {visible.length===0?<div className="empty-chats"><strong>{entries.length===0?'No saved conversations yet':'No ongoing conversations'}</strong><span>{entries.length===0?'Register a ChatGPT conversation to see it here.':'Completed conversations are available in All.'}</span></div>:<div className="chat-list">
      {visible.map(({agent,team,phase,presence,chatStatus})=><article className="chat-row" key={agent.id}>
        <div className="chat-row-main"><span className="agent-avatar">A{agent.number}</span><div className="chat-title"><strong>{agent.chatName??`${team?.title??'Feature team'} · A${agent.number}`}</strong><span>{team?.title??'Feature team'} · {agent.role}</span></div></div>
        <div className="chat-badges"><span className={`status-badge status-${agent.state.toLowerCase()}`}><i/>Task: {statusLabel(agent.state)}</span><span className={`status-badge chat-status-${chatStatus.toLowerCase()}`}><i/>ChatGPT: {chatStatus==='UNKNOWN'?'Not verified':statusLabel(chatStatus)}</span><span className={`presence-badge presence-${presence.toLowerCase()}`}>{presence==='ACTIVE'?'Active tab':presence==='OPEN'?'Open':presence==='CLOSED'?'Closed':'Access off'}</span></div>
        <div className="chat-row-footer"><span>{phase?statusLabel(phase):'No active execution'}</span><button type="button" onClick={()=>onOpenChat(agent.chatUrl!)}>Open chat <span aria-hidden="true">↗</span></button></div>
      </article>)}
    </div>}
    <p className="monitor-footnote">ChatGPT state comes from the five-second page scan and shows “Not verified” when the bridge is off or the latest scan is stale. Task status tracks AgentSync’s execution record.</p>
  </section>;
}
