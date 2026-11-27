import {useEffect,useState} from 'react';
import {DEFAULT_TIMING_SETTINGS,validateTimingSettings,type TimingSettings} from '../../src/timing-settings';
import {loadTimingSettings,saveTimingSettings} from '../../src/extension-settings';

type Props={busy:boolean};
const timingFields:{key:keyof TimingSettings;label:string;unit:string}[]=[
{key:'pageSettleMs',label:'Wait after ChatGPT loads before preparing a new chat',unit:'ms'},
{key:'sessionReadyTimeoutMs',label:'Maximum wait for ChatGPT to be ready',unit:'ms'},
{key:'sessionStableMs',label:'How long ChatGPT must stay ready',unit:'ms'},
{key:'composerTextTimeoutMs',label:'Maximum wait for prompt text to appear',unit:'ms'},
{key:'sendControlTimeoutMs',label:'Maximum wait for the send arrow',unit:'ms'},
{key:'submissionTimeoutMs',label:'Maximum wait to confirm a prompt was sent',unit:'ms'},
{key:'conversationLinkGraceMs',label:'Wait after the first message before saving a new chat link',unit:'ms'},
{key:'conversationLinkStableMs',label:'How long the new chat link must stay unchanged',unit:'ms'},
{key:'conversationLinkTimeoutMs',label:'Maximum wait for a new chat link',unit:'ms'},
{key:'tabReadyTimeoutMs',label:'Maximum wait for a new ChatGPT tab to load',unit:'ms'},
{key:'bridgeReadyTimeoutMs',label:'Maximum wait for a registered chat to connect',unit:'ms'},
{key:'pollIntervalMs',label:'How often AgentSync checks for updates',unit:'ms'},
{key:'assistantStableMs',label:'How long a finished reply must stay unchanged',unit:'ms'},
{key:'snapshotDebounceMs',label:'Pause before saving a chat update',unit:'ms'},
{key:'setupReplyTimeoutMs',label:'Maximum wait for a setup chat reply',unit:'ms'},
{key:'a0ResponseTimeoutMs',label:'Maximum wait for A0 to finish a planning reply',unit:'ms'},
{key:'githubRequestTimeoutMs',label:'Maximum wait for a GitHub response',unit:'ms'}];
const toDraft=(settings:TimingSettings)=>Object.fromEntries(Object.entries(settings).map(([key,value])=>[key,String(value)])) as Record<keyof TimingSettings,string>;
export default function TimingSettingsTab({busy}:Props){
 const [draft,setDraft]=useState(()=>toDraft(DEFAULT_TIMING_SETTINGS));const [error,setError]=useState('');const [notice,setNotice]=useState('');
 useEffect(()=>{void loadTimingSettings().then(settings=>setDraft(toDraft(settings))).catch(e=>setError(e instanceof Error?e.message:String(e)));},[]);
 async function save(){setError('');setNotice('');try{const next=validateTimingSettings(Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,Number(value)])));await saveTimingSettings(next);setDraft(toDraft(next));setNotice('Timing settings saved. They apply to the next AgentSync action.');}catch(e){setError(e instanceof Error?e.message:String(e));}}
 return <><div className="tab-heading"><div><p className="eyebrow">WORKFLOW CONTROLS</p><h2>Timing settings</h2><p>Set how long AgentSync waits for ChatGPT, replies, tabs, and connection checks. Values are stored on this device.</p></div></div><section className="panel"><div className="setting-row"><span><strong>Ongoing chat status</strong><small>ChatGPT tab and generation status checks. Live generation state requires the A0 chat bridge.</small></span><span className="setting-status is-enabled">5 seconds</span></div>{timingFields.map(field=><label className="setting-row" key={field.key}><span><strong>{field.label}</strong><small>{field.unit}</small></span><input type="number" min={0} step={1} value={draft[field.key]} onChange={e=>setDraft({...draft,[field.key]:e.target.value})}/></label>)}{error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}<button type="button" disabled={busy} onClick={()=>void save()}>Save timing settings</button></section><aside className="timing-future-note"><strong>Future update</strong><p>Record timing choices and observed execution durations in history so a later update can adapt dispatch timing to actual task duration and worker availability. Adaptive timing is not enabled yet.</p></aside></>;
}