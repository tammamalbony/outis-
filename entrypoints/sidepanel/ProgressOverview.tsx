import type {Agent,Team} from '../../src/core';

const segments=[
  {key:'COMPLETED',label:'Accepted',color:'var(--success)'},
  {key:'WORKING',label:'Working',color:'var(--orange)'},
  {key:'BLOCKED',label:'Blocked',color:'var(--danger)'},
  {key:'STOPPED',label:'Stopped',color:'var(--cyan)'},
  {key:'READY',label:'Ready',color:'var(--violet)'},
  {key:'UNREGISTERED',label:'Not started',color:'var(--muted-chart)'},
] as const;

export default function ProgressOverview({teams,agents}:{teams:Team[];agents:Agent[]}){
  const finalized=teams.filter(team=>Boolean(team.finalizedAt)).length;
  const completion=teams.length?Math.round(finalized/teams.length*100):0;
  const developers=agents.filter(agent=>agent.number>0);
  const accepted=developers.filter(agent=>agent.state==='COMPLETED').length;
  const statusCounts=segments.map(segment=>({...segment,count:agents.filter(agent=>agent.state===segment.key).length}));
  const total=agents.length;

  return <section className="progress-overview" aria-labelledby="progress-title">
    <div className="progress-heading"><div><p className="eyebrow">WORK SNAPSHOT</p><h2 id="progress-title">Progress overview</h2></div><span className="snapshot-badge">Local task data</span></div>
    <div className="progress-grid">
      <article className="progress-card completion-card">
        <div className="completion-ring" role="img" aria-label={`${completion}% of feature teams finalized locally`} style={{'--progress':`${completion}%`} as React.CSSProperties}>
          <div><strong>{completion}%</strong><span>finalized</span></div>
        </div>
        <div className="completion-copy"><strong>Feature completion</strong><span>{finalized} of {teams.length} teams finalized</span><small>Finalized locally after AgentSync checks; this does not indicate a merged pull request.</small></div>
      </article>
      <article className="progress-card accepted-card">
        <div className="accepted-number"><strong>{accepted}</strong><span>accepted</span></div>
        <div className="accepted-copy"><strong>Developer work</strong><span>{developers.length?`${accepted} of ${developers.length} developer tasks accepted locally`:'Import a task file to begin tracking work.'}</span></div>
        <div className="accepted-track" role="img" aria-label={`${accepted} of ${developers.length} developer tasks accepted`}><span style={{width:`${developers.length?accepted/developers.length*100:0}%`}}/></div>
      </article>
      <article className="progress-card status-card">
        <div className="status-card-heading"><strong>Agent status</strong><span>{total} total</span></div>
        <div className="status-bars" role="img" aria-label="Agent task counts by current local status">
          {statusCounts.map(item=><div className="status-bar-row" key={item.key}>
            <span>{item.label}</span><div className="status-bar-track"><i style={{width:`${total?item.count/total*100:0}%`,background:item.color}}/></div><b>{item.count}</b>
          </div>)}
        </div>
      </article>
    </div>
  </section>;
}
