import {useEffect,useState} from 'react';
import type {Agent,Team} from '../../src/core';
import {chatAdapter} from '../../src/chat-adapter';

export default function A0BridgePanel({teams,agents}:{teams:Team[];agents:Agent[]}){
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  useEffect(()=>{let active=true;const refresh=()=>{void chatAdapter.isA0BridgeEnabled().then(value=>{if(active)setEnabled(value);}).catch(e=>{if(active)setError(String(e));});};refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer);};},[]);
  const eligibleTeams=teams.filter(team=>{
    const members=agents.filter(agent=>agent.teamId===team.id);
    return members.some(agent=>agent.number===0&&Boolean(agent.chatUrl));
  });
  const eligibleAgents=eligibleTeams.flatMap(team=>agents.filter(agent=>agent.teamId===team.id&&agent.chatUrl));
  const registered=eligibleTeams.length>0;
  async function enable(){
    setBusy(true);setError('');setNotice('');
    try{
      const count=await chatAdapter.enableA0Bridge(eligibleAgents.map(agent=>agent.chatUrl!));
      setEnabled(true);setNotice(`Bridge enabled for ${count} registered chats across ${eligibleTeams.length} complete feature teams. Refresh after registering more chats.`);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function disable(){
    setBusy(true);setError('');setNotice('');
    try{await chatAdapter.disableA0Bridge();setEnabled(false);setNotice('A0 bridge disabled. Existing ChatGPT site permission remains available for saved-tab navigation until revoked in Chrome settings.');}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <section className="panel bridge-panel" aria-labelledby="a0-bridge-title">
    <div className="agenthead"><h2 id="a0-bridge-title">A0 chat bridge</h2><span className={`state ${enabled?'bridge-on':''}`}>{enabled?'Enabled':'Off'}</span></div>
    <p>When enabled, AgentSync reads status and the latest visible response only from registered AgentSync chats. It sends stopped-worker updates to A0 and applies A0’s validated, dependency-checked orders to the named registered chat. New developer chats are added when their assignments become eligible.</p>
    <p className="bridge-boundary">This grants ChatGPT page access and lets AgentSync create and submit prompts in registered task chats. ChatGPT’s page layout can change; unclear status, sender, target, or submission leaves the task untouched or marked uncertain. GitHub actions never run through this bridge.</p>
    {!registered&&<p className="notice">Import a task file to create and register A0 automatically. Developer chats are added as approved assignments become eligible.</p>}
    <div className="buttons">
      {enabled?<><button type="button" disabled={busy} onClick={()=>void enable()}>{busy?'Refreshing…':'Refresh registered chats'}</button><button type="button" disabled={busy} onClick={()=>void disable()}>{busy?'Disabling…':'Disable bridge'}</button></>:<button type="button" disabled={busy||!registered} onClick={()=>void enable()}>{busy?'Requesting access…':'Enable A0 bridge'}</button>}
    </div>
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
  </section>;
}
