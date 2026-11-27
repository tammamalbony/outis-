import {useCallback,useEffect,useState} from 'react';
import {browser} from 'wxt/browser';
import ProjectPreparationPanel from './ProjectPreparationPanel';
import {DEFAULT_TIMING_SETTINGS,validateTimingSettings,type TimingSettings} from '../../src/timing-settings';
import {loadTimingSettings,saveTimingSettings} from '../../src/extension-settings';

const chatgptOrigin='https://chatgpt.com/*';
const githubOrigin='https://api.github.com/*';
type PermissionName='chatgpt'|'github'|'clipboard';
type ErrorLogEntry={createdAt:string;message:string;source?:string};
type Props={logs:ErrorLogEntry[];busy:boolean;onClearAll:()=>void;onError:(message:string)=>void};
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
  {key:'githubRequestTimeoutMs',label:'Maximum wait for a GitHub response',unit:'ms'},
];
const timingDraftFrom=(settings:TimingSettings)=>Object.fromEntries(Object.entries(settings).map(([key,value])=>[key,String(value)])) as Record<keyof TimingSettings,string>;
export default function SettingsTab({logs,busy,onClearAll,onError}:Props){
  const [permissions,setPermissions]=useState<Record<PermissionName,boolean|null>>({chatgpt:null,github:null,clipboard:null});
  const [requesting,setRequesting]=useState<PermissionName|null>(null);
  const [notice,setNotice]=useState('');
  const [timingDraft,setTimingDraft]=useState(()=>timingDraftFrom(DEFAULT_TIMING_SETTINGS));
  const [timingError,setTimingError]=useState('');
  const [timingNotice,setTimingNotice]=useState('');
  const refresh=useCallback(async()=>{
    try{
      const [chatgpt,github,clipboard]=await Promise.all([browser.permissions.contains({origins:[chatgptOrigin]}),browser.permissions.contains({origins:[githubOrigin]}),browser.permissions.contains({permissions:['clipboardWrite']})]);
      setPermissions({chatgpt,github,clipboard});
    }catch(error){onError(`Could not read extension permissions: ${error instanceof Error?error.message:String(error)}`);}
  },[onError]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{void loadTimingSettings().then(settings=>{setTimingDraft(timingDraftFrom(settings));}).catch(error=>setTimingError(error instanceof Error?error.message:String(error)));},[]);
  async function saveTimings(){
    setTimingError('');setTimingNotice('');
    try{
      const next=validateTimingSettings(Object.fromEntries(Object.entries(timingDraft).map(([key,value])=>[key,Number(value)])));
      await saveTimingSettings(next);setTimingDraft(timingDraftFrom(next));setTimingNotice('Timing settings saved. They apply to the next AgentSync action.');
    }catch(error){setTimingError(error instanceof Error?error.message:String(error));}
  }
  async function grant(name:PermissionName){
    setRequesting(name);setNotice('');
    try{
      const granted=name==='clipboard'
        ?await browser.permissions.request({permissions:['clipboardWrite']})
        :await browser.permissions.request({origins:[name==='chatgpt'?chatgptOrigin:githubOrigin]});
      await refresh();
      const label=name==='chatgpt'?'ChatGPT':name==='github'?'GitHub API':'Clipboard writing';
      setNotice(granted?`${label} access is enabled.`:`${label} access was not granted.`);
    }catch(error){const message=`Permission request failed: ${error instanceof Error?error.message:String(error)}`;setNotice(message);onError(message);}
    finally{setRequesting(null);}
  }
  const permissionLabel=(value:boolean|null)=>value===null?'Checking…':value?'Enabled':'Not enabled';
  return <>
    <div className="tab-heading"><div><p className="eyebrow">PREFERENCES AND DIAGNOSTICS</p><h2>Settings</h2><p>Manage AgentSync’s optional site access and local records.</p></div><button type="button" className="secondary-button" onClick={()=>void refresh()}>Refresh status</button></div>
    <section className="panel"><h2>Site permissions</h2><p>Grant only the access needed for the feature you use. Chrome may show a permission prompt.</p>
      <div className="setting-row"><div><strong>ChatGPT chats</strong><small>Read status and route prompts only in chats you register with AgentSync.</small></div><span className={`setting-status ${permissions.chatgpt?'is-enabled':''}`}>{permissionLabel(permissions.chatgpt)}</span><button type="button" disabled={requesting!==null||permissions.chatgpt===true} onClick={()=>void grant('chatgpt')}>{requesting==='chatgpt'?'Requesting…':permissions.chatgpt?'Granted':'Grant access'}</button></div>
      <div className="setting-row"><div><strong>GitHub API</strong><small>Connect the GitHub panel to repository resources using your repository-scoped token.</small></div><span className={`setting-status ${permissions.github?'is-enabled':''}`}>{permissionLabel(permissions.github)}</span><button type="button" disabled={requesting!==null||permissions.github===true} onClick={()=>void grant('github')}>{requesting==='github'?'Requesting…':permissions.github?'Granted':'Grant access'}</button></div>
      <div className="setting-row"><div><strong>Copy to clipboard</strong><small>Lets AgentSync copy prompts and reviewed context after you choose a Copy button.</small></div><span className={`setting-status ${permissions.clipboard?'is-enabled':''}`}>{permissionLabel(permissions.clipboard)}</span><button type="button" disabled={requesting!==null||permissions.clipboard===true} onClick={()=>void grant('clipboard')}>{requesting==='clipboard'?'Requesting…':permissions.clipboard?'Granted':'Grant access'}</button></div>
      <div className="setting-row"><div><strong>Active tab</strong><small>Chrome grants temporary access when you open AgentSync from the toolbar. Use it to capture the active ChatGPT conversation link.</small></div><span className="setting-status is-enabled">Available on invocation</span></div>
      {notice&&<p role="status" className={notice.includes('failed')?'error':'notice'}>{notice}</p>}
    </section>
    <section className="panel"><h2>Automation timing</h2><p>Adjust how long AgentSync waits for ChatGPT, new conversation links, replies and connection checks. Values are saved on this device; chat status checks update immediately.</p>
      <div className="setting-row"><span><strong>Ongoing chat status</strong><small>ChatGPT tab and generation status are checked every five seconds. Live generation state requires the A0 chat bridge to be enabled.</small></span><span className="setting-status is-enabled">5 seconds</span></div>
      {timingFields.map(field=><label className="setting-row" key={field.key}><span><strong>{field.label}</strong><small>{field.unit}</small></span><input type="number" min={0} step={1} value={timingDraft[field.key]} onChange={event=>setTimingDraft({...timingDraft,[field.key]:event.target.value})}/></label>)}
      {timingError&&<p role="alert" className="error">{timingError}</p>}{timingNotice&&<p role="status" className="notice">{timingNotice}</p>}<button type="button" disabled={busy} onClick={()=>void saveTimings()}>Save timing settings</button>
    </section>
    <ProjectPreparationPanel onClipboardGranted={()=>void refresh()}/>
    <section className="panel"><div className="section-heading"><div><h2>Error log</h2><p>Recent AgentSync action errors and saved bridge failures. Local errors are stored in this browser profile; newest 100 are shown.</p></div><span className="setting-status">{logs.length} entries</span></div>
      {logs.length?logs.map((entry,index)=><details className="event error-log-entry" key={`${entry.createdAt}-${index}`}><summary><div><strong>{entry.message}</strong>{entry.source&&<small>{entry.source}</small>}</div><small>{new Date(entry.createdAt).toLocaleString()}</small></summary><pre>{entry.message}</pre></details>):<p>No errors have been recorded.</p>}
    </section>
    <section className="panel danger-panel"><h2>Clear all AgentSync data</h2><p>Permanently deletes task batches, team and chat records, execution history, events, reports, saved messages, settings and error logs from this browser profile. This cannot be undone. Granted site permissions will remain enabled.</p><button type="button" className="danger-button" disabled={busy||requesting!==null} onClick={onClearAll}>Clear all data</button></section>
  </>;
}
