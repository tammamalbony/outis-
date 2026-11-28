import type {Agent,Batch,Event,Team} from '../../src/core';
import GitHubPanel from './GitHubPanel';
import ProjectPreparationPanel from './ProjectPreparationPanel';

type Props={batches:Batch[];teams:Team[];agents:Agent[];events:Event[];selectedTeam?:Team;onSelectTeam:(teamId:string)=>void;onOpenWorkspace:()=>void};
export default function GitHubTab({batches,teams,agents,events,selectedTeam,onSelectTeam,onOpenWorkspace}:Props){
  return <section role="tabpanel" id="panel-github" aria-labelledby="tab-github">
    <div className="tab-heading"><div><p className="eyebrow">REPOSITORY SETUP AND ACTIONS</p><h2>GitHub</h2><p>Check repository setup, resume task progress, and prepare repository prompts.</p></div></div>
    <ProjectPreparationPanel batches={batches} teams={teams} agents={agents} events={events} onOpenWorkspace={onOpenWorkspace}/>
    {teams.length>0&&<section className="panel"><label>Feature team<select value={selectedTeam?.id??''} onChange={event=>onSelectTeam(event.target.value)}>{teams.map(team=><option key={team.id} value={team.id}>{team.title} · {team.repository}</option>)}</select></label></section>}
    {selectedTeam?<GitHubPanel key={'github:'+selectedTeam.id} team={selectedTeam} agents={agents.filter(agent=>agent.teamId===selectedTeam.id)}/>:<section className="panel"><h3>Feature team GitHub actions</h3><p>Import a task file in Workspace to create a feature team. Its GitHub binding, issue/PR actions, and evidence checks will appear here.</p><button type="button" onClick={onOpenWorkspace}>Open Workspace</button></section>}
  </section>;
}
