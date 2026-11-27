import {useState} from 'react';
import type {Agent,Batch,Event,HistoryEntry,Order,Team} from '../../src/core';
import {executionPhase} from '../../src/execution';

type Props={batches:Batch[];teams:Team[];agents:Agent[];orders:Order[];events:Event[];history:HistoryEntry[]};
export default function HistoryTab({batches,teams,agents,orders,events,history}:Props){
  const [teamFilter,setTeamFilter]=useState('all');
  const visibleTeams=teamFilter==='all'?teams:teams.filter(team=>team.id===teamFilter);
  const teamIds=new Set(visibleTeams.map(team=>team.id));
  const visibleHistory=history.filter(entry=>teamIds.has(entry.teamId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const visibleResponses=visibleHistory.filter(entry=>{
    if(entry.kind!=='CHAT_MESSAGE_OBSERVED')return false;
    try{return JSON.parse(entry.detail??'{}').role==='assistant';}catch{return false;}
  });
  const visibleOrders=orders.filter(order=>teamIds.has(order.teamId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const visibleEvents=events.filter(item=>teamIds.has(item.teamId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  function download(){
    const teamRecords=visibleTeams;
    const selectedIds=new Set(teamRecords.map(team=>team.id));
    const batchIds=new Set(teamRecords.map(team=>team.batchId));
    const payload={batches:batches.filter(batch=>batchIds.has(batch.id)),teams:teamRecords,agents:agents.filter(agent=>selectedIds.has(agent.teamId)),orders:visibleOrders,events:visibleEvents,history:visibleHistory};
    const href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=href;link.download=teamFilter==='all'?'agentsync-history.json':`agentsync-${teamRecords[0]?.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')??'team'}-history.json`;link.click();URL.revokeObjectURL(href);
  }
  function downloadResponses(){
    const lines=visibleResponses.map(entry=>{
      let metadata:Record<string,unknown>={};try{metadata=JSON.parse(entry.detail??'{}');}catch{/* Keep response text even if old metadata is malformed. */}
      return JSON.stringify({createdAt:entry.createdAt,team:teams.find(team=>team.id===entry.teamId)?.title??entry.teamId,agent:entry.agentNumber===undefined?'Team':`A${entry.agentNumber}`,chatUrl:entry.chatUrl,executionId:entry.executionId,messageId:metadata.messageId,response:entry.content});
    });
    const href=URL.createObjectURL(new Blob([lines.join('\n')+(lines.length?'\n':'')],{type:'application/x-ndjson'}));
    const link=document.createElement('a');link.href=href;link.download=teamFilter==='all'?'agentsync-chat-responses.jsonl':`agentsync-${teams.find(team=>team.id===teamFilter)?.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')??'team'}-responses.jsonl`;link.click();URL.revokeObjectURL(href);
  }
  return <>
    <div className="tab-heading"><div><p className="eyebrow">SAVED RECORDS</p><h2>History</h2><p>Finished ChatGPT replies are saved locally here and can be downloaded as a response log.</p></div><div className="buttons"><button type="button" onClick={downloadResponses} disabled={!visibleResponses.length}>Download response log</button><button type="button" onClick={download} disabled={!visibleHistory.length&&!visibleOrders.length&&!visibleEvents.length}>Download history</button></div></div>
    <section className="panel history-filter"><label>Show history for<select aria-label="Filter history by team" value={teamFilter} onChange={event=>setTeamFilter(event.target.value)}><option value="all">All feature teams</option>{teams.map(team=><option key={team.id} value={team.id}>{team.title}</option>)}</select></label></section>
    <h2>Saved task and chat history <span className="muted-label">({visibleHistory.length})</span></h2>
    <section className="panel">{visibleHistory.length?visibleHistory.map(entry=><details className="event history-entry" key={entry.id}><summary><strong>{entry.kind.replaceAll('_',' ')}</strong> · {teams.find(team=>team.id===entry.teamId)?.title??'Team'} · {entry.agentNumber===undefined?'Team':`A${entry.agentNumber}`} · {new Date(entry.createdAt).toLocaleString()}</summary>{entry.previousChatUrl&&<p>Previous chat: <a href={entry.previousChatUrl} target="_blank" rel="noreferrer">{entry.previousChatUrl}</a></p>}{entry.chatUrl&&<p>Chat: <a href={entry.chatUrl} target="_blank" rel="noreferrer">{entry.chatUrl}</a></p>}{entry.detail&&<small>{entry.detail}</small>}<pre>{entry.content}</pre></details>):<p>No saved task or chat history for this selection yet.</p>}</section>
    <h2>Execution history <span className="muted-label">({visibleOrders.length})</span></h2>
    <section className="panel">{visibleOrders.length?visibleOrders.map(order=><div className="event" key={order.id}><strong>{order.agentId.split(':').at(-1)} · {executionPhase(order,agents.find(agent=>agent.id===order.agentId))}</strong><small>{teams.find(team=>team.id===order.teamId)?.title??'Team'} · Order {order.id}</small><small>Queued: {new Date(order.createdAt).toLocaleString()}</small>{([['Handoff',order.handoffAt],['Confirmed',order.confirmedAt],['Stopped',order.stoppedAt],['Cancelled',order.cancelledAt]] as const).map(([label,value])=>value&&<small key={label}>{label}: {new Date(value).toLocaleString()}</small>)}</div>):<p>No execution history for this selection yet.</p>}</section>
    <h2>Event log <span className="muted-label">({visibleEvents.length})</span></h2>
    <section className="panel">{visibleEvents.length?visibleEvents.slice(0,200).map(item=><div className="event" key={item.id}><strong>{item.type}</strong><small>{teams.find(team=>team.id===item.teamId)?.title??'Team'} · {new Date(item.createdAt).toLocaleString()} {item.agentId?.split(':').at(-1)}</small>{item.detail&&<small>{item.detail}</small>}</div>):<p>No events for this selection yet.</p>}{visibleEvents.length>200&&<p>Showing the newest 200 events.</p>}</section>
    <p className="history-note">Observed chat messages are saved only while the AgentSync bridge is enabled and observing that registered chat. Messages that were never saved cannot be recovered.</p>
  </>;
}
