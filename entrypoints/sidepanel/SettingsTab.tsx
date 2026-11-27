import ProjectPreparationPanel from './ProjectPreparationPanel';

type ErrorLogEntry={createdAt:string;message:string;source?:string};
type Props={logs:ErrorLogEntry[];busy:boolean;onClearAll:()=>void;onError:(message:string)=>void};
export default function SettingsTab({logs,busy,onClearAll}:Props){
 return <>
 <div className="tab-heading"><div><p className="eyebrow">PREFERENCES AND DIAGNOSTICS</p><h2>Settings</h2><p>Configure repository prompts, view local errors, and manage saved data.</p></div></div>
 <ProjectPreparationPanel onClipboardGranted={()=>{}}/>
 <section className="panel"><div className="section-heading"><div><h2>Error log</h2><p>Recent AgentSync action errors and saved bridge failures. Local errors are stored in this browser profile; newest 100 are shown.</p></div><span className="setting-status">{logs.length} entries</span></div>{logs.length?logs.map((entry,index)=><details className="event error-log-entry" key={`${entry.createdAt}-${index}`}><summary><div><strong>{entry.message}</strong>{entry.source&&<small>{entry.source}</small>}</div><small>{new Date(entry.createdAt).toLocaleString()}</small></summary><pre>{entry.message}</pre></details>):<p>No errors have been recorded.</p>}</section>
 <section className="panel danger-panel"><h2>Clear all AgentSync data</h2><p>Permanently deletes task batches, team and chat records, execution history, events, reports, saved messages, settings and error logs from this browser profile. This cannot be undone. Granted site permissions will remain enabled.</p><button type="button" className="danger-button" disabled={busy} onClick={onClearAll}>Clear all data</button></section>
 </>;
}
