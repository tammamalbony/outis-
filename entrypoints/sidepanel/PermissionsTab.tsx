import {useCallback,useEffect,useState} from 'react';
import {browser} from 'wxt/browser';

const chatgptOrigin='https://chatgpt.com/*';
const githubOrigin='https://api.github.com/*';
type PermissionName='chatgpt'|'github'|'clipboard';
type Props={onError:(message:string)=>void};
export default function PermissionsTab({onError}:Props){
 const [permissions,setPermissions]=useState<Record<PermissionName,boolean|null>>({chatgpt:null,github:null,clipboard:null});
 const [requesting,setRequesting]=useState<PermissionName|null>(null);
 const [notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{try{const [chatgpt,github,clipboard]=await Promise.all([browser.permissions.contains({origins:[chatgptOrigin]}),browser.permissions.contains({origins:[githubOrigin]}),browser.permissions.contains({permissions:['clipboardWrite']})]);setPermissions({chatgpt,github,clipboard});}catch(error){onError(`Could not read extension permissions: ${error instanceof Error?error.message:String(error)}`);}},[onError]);
 useEffect(()=>{void refresh();},[refresh]);
 async function grant(name:PermissionName){setRequesting(name);setNotice('');try{const granted=name==='clipboard'?await browser.permissions.request({permissions:['clipboardWrite']}):await browser.permissions.request({origins:[name==='chatgpt'?chatgptOrigin:githubOrigin]});await refresh();const label=name==='chatgpt'?'ChatGPT':name==='github'?'GitHub API':'Clipboard writing';setNotice(granted?`${label} access is enabled.`:`${label} access was not granted.`);}catch(error){const message=`Permission request failed: ${error instanceof Error?error.message:String(error)}`;setNotice(message);onError(message);}finally{setRequesting(null);}}
 const label=(value:boolean|null)=>value===null?'Checking…':value?'Enabled':'Not enabled';
 return <><div className="tab-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Permissions</h2><p>Grant only the optional access needed for the feature you use. Chrome may show a permission prompt.</p></div><button type="button" className="secondary-button" onClick={()=>void refresh()}>Refresh status</button></div><section className="panel"><h2>Optional access</h2>
 {[['chatgpt','ChatGPT chats','Read status and route prompts only in chats you register with AgentSync.'],['github','GitHub API','Connect the GitHub panel to repository resources using your repository-scoped token.'],['clipboard','Copy to clipboard','Lets AgentSync copy prompts and reviewed context after you choose a Copy button.']] .map(([key,title,description])=>{const name=key as PermissionName;return <div className="setting-row" key={name}><div><strong>{title}</strong><small>{description}</small></div><span className={`setting-status ${permissions[name]?'is-enabled':''}`}>{label(permissions[name])}</span><button type="button" disabled={requesting!==null||permissions[name]===true} onClick={()=>void grant(name)}>{requesting===name?'Requesting…':permissions[name]?'Granted':'Grant access'}</button></div>;})}
 <div className="setting-row"><div><strong>Active tab</strong><small>Chrome grants temporary access when you open AgentSync from the toolbar to capture the active ChatGPT conversation link.</small></div><span className="setting-status is-enabled">Available on invocation</span></div>{notice&&<p role="status" className={notice.includes('failed')?'error':'notice'}>{notice}</p>}</section></>;
}