import {useCallback,useEffect,useState} from 'react';
import {browser} from 'wxt/browser';

const API='http://127.0.0.1:8765';
const tokenKey='agentsync.localMcp.token.v1';
const itemsKey='agentsync.localMcp.items.v1';
type BridgeItem={id:number;kind:'message'|'data'|'event';name?:string|null;payload:unknown;created_at:string};
type ApiResult={items?:BridgeItem[];token?:string;id?:number;error?:string;server?:{online?:boolean};extension?:{paired?:boolean}};

async function getToken(){const value=await browser.storage.local.get(tokenKey);return value[tokenKey] as string|undefined;}
async function api(path:string,token?:string,options:RequestInit={}):Promise<ApiResult>{
  const headers=new Headers(options.headers);
  if(token)headers.set('Authorization',`Bearer ${token}`);
  if(options.body)headers.set('Content-Type','application/json');
  const response=await fetch(`${API}${path}`,{...options,headers,cache:'no-store'});
  let result:ApiResult={};try{result=await response.json() as ApiResult;}catch{}
  if(!response.ok){if(response.status===401)await browser.storage.local.remove([tokenKey]);throw new Error(result.error||`Local MCP server returned HTTP ${response.status}.`);}
  return result;
}

export default function LocalMcpPanel(){
  const [token,setToken]=useState<string>(),[pairCode,setPairCode]=useState(''),[kind,setKind]=useState<'message'|'data'|'event'>('message'),[name,setName]=useState(''),[payload,setPayload]=useState(''),[items,setItems]=useState<BridgeItem[]>([]),[status,setStatus]=useState('Checking local server…'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    let serverPaired=false;
    try{
      const health=await api('/api/status');
      serverPaired=health.extension?.paired===true;
      const current=token??await getToken();
      if(!current){setStatus(health.server?.online?(serverPaired?'Server paired · this copy has no token':'Server online · not paired'):'Server offline');setError('');return;}
      setToken(current);
      const result=await api('/api/extension/outbox',current);
      const fresh=result.items??[];
      if(fresh.length){
        const prior=(await browser.storage.local.get(itemsKey))[itemsKey] as BridgeItem[]|undefined;
        const merged=Array.from(new Map([...(prior??[]),...fresh].map(item=>[item.id,item])).values()).slice(-100);
        await browser.storage.local.set({[itemsKey]:merged});
        await api('/api/extension/ack',current,{method:'POST',body:JSON.stringify({ids:fresh.map(item=>item.id)})});
        setItems(merged);
      }else if(!items.length){setItems(((await browser.storage.local.get(itemsKey))[itemsKey] as BridgeItem[]|undefined)??[]);}
      setStatus('Connected · checking every 3 seconds');setError('');
    }catch(e){if(e instanceof Error&&/not paired/i.test(e.message)){setToken(undefined);setStatus(serverPaired?'Server paired · this copy’s token was rejected':'Server online · not paired');setError('The server rejected this extension’s saved token. Pair this loaded Chrome copy again with a fresh dashboard code.');}else{setStatus('Connection issue');setError(e instanceof Error?e.message:String(e));}}
  },[token,items.length]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),3000);return()=>window.clearInterval(timer);},[refresh]);
  async function pair(){setBusy(true);setError('');try{const result=await api('/api/extension/pair',undefined,{method:'POST',body:JSON.stringify({code:pairCode.trim()})});if(!result.token)throw new Error('The server did not return a pairing token.');await api('/api/extension/outbox',result.token);await browser.storage.local.set({[tokenKey]:result.token,[itemsKey]:[]});setToken(result.token);setItems([]);setPairCode('');setStatus('Connected · checking every 3 seconds');}catch(e){setStatus('Pairing check failed');setError(e instanceof Error?`The dashboard may have accepted the code, but AgentSync could not verify the extension token: ${e.message}`:String(e));}finally{setBusy(false);}}
  async function send(){setBusy(true);setError('');try{const value=kind==='message'?payload.trim():JSON.parse(payload);if(kind==='message'&&!value)throw new Error('Enter a message first.');if(kind==='event'&&!name.trim())throw new Error('Enter an event name first.');const current=token??await getToken();if(!current)throw new Error('Pair with the server first.');const result=await api('/api/extension/items',current,{method:'POST',body:JSON.stringify({kind,...(kind==='event'?{name:name.trim()}:{}),payload:value})});setStatus(`Sent to server · item ${result.id}`);setPayload('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function unpair(){await browser.storage.local.remove([tokenKey,itemsKey]);setToken(undefined);setItems([]);setStatus('Not paired');setError('');}
  return <section className="panel local-mcp-panel" aria-labelledby="local-mcp-title">
    <div className="agenthead"><div><p className="eyebrow">LOCAL SERVER BRIDGE</p><h2 id="local-mcp-title">ChatGPT ↔ AgentSync</h2></div><span className={`state ${status.startsWith('Connected')||status.startsWith('Paired')||status.startsWith('Sent')?'bridge-on':''}`}>{status}</span></div>
    <p>Connects this extension to the Local MCP Test server at <code>127.0.0.1:8765</code>. ChatGPT tools can place messages, data, and events in the server queue; this panel receives them and can send items back to ChatGPT’s MCP inbox.</p>
    {!token?<div className="local-mcp-pair">{status.includes('this copy has no token')&&<p className="notice">The server is paired, but this loaded extension copy has no saved token. Pair this copy to replace the server’s active pairing.</p>}<label>One-time pairing code<input autoComplete="off" value={pairCode} onChange={event=>setPairCode(event.target.value)} placeholder="Copy the code from the local server dashboard" /></label><button type="button" disabled={busy||!pairCode.trim()} onClick={()=>void pair()}>{busy?'Connecting…':'Pair with local server'}</button><small>Open the Local MCP Test dashboard, show a pairing code, then paste it here. No tunnel or inference API key is used.</small></div>:<>
      <div className="local-mcp-compose"><label>Send to ChatGPT<select value={kind} onChange={event=>setKind(event.target.value as typeof kind)}><option value="message">Message</option><option value="data">Data (JSON)</option><option value="event">Event (JSON)</option></select></label>{kind==='event'&&<label>Event name<input value={name} onChange={event=>setName(event.target.value)} placeholder="e.g. task.completed" /></label>}<label>{kind==='message'?'Message':'Payload (JSON)'}<textarea value={payload} onChange={event=>setPayload(event.target.value)} placeholder={kind==='message'?'Write a message…':'{"key":"value"}'} /></label><div className="buttons"><button type="button" disabled={busy||!payload.trim()} onClick={()=>void send()}>{busy?'Sending…':'Send to server'}</button><button type="button" disabled={busy} onClick={()=>void refresh()}>Check now</button><button type="button" disabled={busy} onClick={()=>void unpair()}>Unpair</button></div></div>
      <h3>Received from ChatGPT <span className="muted-label">{items.length}</span></h3><div className="local-mcp-inbox">{items.length===0?<p>No items yet. Send one from ChatGPT using the Local MCP Test plugin’s send-to-extension tool.</p>:items.slice().reverse().slice(0,12).map(item=><article className="local-mcp-item" key={item.id}><strong>{item.kind==='event'?`Event · ${item.name}`:item.kind==='data'?'Data':'Message'}</strong><small>{new Date(item.created_at).toLocaleString()}</small><pre>{typeof item.payload==='string'?item.payload:JSON.stringify(item.payload,null,2)}</pre></article>)}</div>
    </>}{error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
