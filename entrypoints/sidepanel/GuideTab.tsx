type Props={onOpenWorkspace:()=>void;onOpenGitHub:()=>void};

const steps=[
  {title:'Import a task file',body:'In Workspace, choose a Markdown task file and select Import & start A0. AgentSync creates or resumes the batch and opens its planning chat.'},
  {title:'Work through the plan with A0',body:'Read A0’s plan in ChatGPT. Discuss unclear work or blockers there. Return to AgentSync when the plan is ready for your approval.'},
  {title:'Approve and start the cycle',body:'Review the plan in Team lifecycle and explicitly continue from A0’s plan. AgentSync dispatches only assignments whose dependencies are ready.'},
  {title:'Let the workers finish',body:'A1–A5 complete their assigned work in ChatGPT. AgentSync waits until every assigned worker in the cycle is idle, saves their replies, and sends one combined handoff to A0.'},
  {title:'Review and choose what happens next',body:'A0 reviews the results. Continue with the next cycle, discuss a blocker, or review and finalize the team. Finalizing here records local status; it does not merge a GitHub pull request.'},
];

export default function GuideTab({onOpenWorkspace,onOpenGitHub}:Props){
  return <section className="guide-page" aria-labelledby="guide-title">
    <header className="guide-header">
      <p className="eyebrow">YOUR QUICK GUIDE</p>
      <h2 id="guide-title">What to do next</h2>
      <p>AgentSync organizes the work. A0 plans and reviews it. A1–A5 do the assigned work in their ChatGPT chats.</p>
      <div className="buttons"><button type="button" onClick={onOpenGitHub}>Check a repository</button><button type="button" onClick={onOpenWorkspace}>Open Workspace</button></div>
      <p>Use GitHub first to check or initialize the repository. Then import a task file in Workspace.</p>
    </header>

    <section className="panel guide-panel" aria-labelledby="guide-workflow-title">
      <div className="guide-section-heading"><span className="guide-kicker">MAIN WORKFLOW</span><h3 id="guide-workflow-title">From task to reviewed result</h3></div>
      <ol className="guide-flow">{steps.map((step,index)=><li className="guide-step" key={step.title}>
        <span className="guide-step-number" aria-hidden="true">{index+1}</span>
        <div><h4>{step.title}</h4><p>{step.body}</p></div>
      </li>)}</ol>
    </section>

    <section className="guide-pair" aria-label="Who does what">
      <article className="panel guide-role"><span className="guide-role-badge">A0</span><div><h3>Supervisor</h3><p>Plans the work, receives worker reports, and recommends the next action.</p></div></article>
      <article className="panel guide-role"><span className="guide-role-badge">A1–A5</span><div><h3>Developers</h3><p>Handle assigned tasks in separate ChatGPT conversations, following dependencies.</p></div></article>
    </section>

    <section className="panel guide-panel" aria-labelledby="guide-mcp-title">
      <div className="guide-section-heading"><span className="guide-kicker">OPTIONAL · SEPARATE FROM THE MAIN WORKFLOW</span><h3 id="guide-mcp-title">Local MCP message path</h3></div>
      <p className="guide-intro">Use this only when you want to exchange messages, JSON data, or events with the separate Local MCP Test server and its paired Chrome bridge.</p>
      <div className="guide-route"><span>ChatGPT</span><i aria-hidden="true">→</i><span>MCP plugin</span><i aria-hidden="true">→</i><span>Local server</span><i aria-hidden="true">→</i><span>Paired Chrome bridge</span></div>
      <p className="guide-route-caption">To Chrome: the server queues the item for the paired extension.</p>
      <div className="guide-route guide-route-return"><span>Chrome bridge</span><i aria-hidden="true">→</i><span>Local server</span><i aria-hidden="true">→</i><span>ChatGPT inbox tool</span><i aria-hidden="true">→</i><span>ChatGPT reads it</span></div>
      <p className="guide-route-caption">Back to ChatGPT: the chat reads queued items when it calls the inbox tool. Local stdio does not wake an idle chat.</p>
      <p className="guide-note"><strong>Automatic Work event delivery</strong> needs a Streamable HTTP connection through Secure MCP Tunnel. Ordinary local message exchange does not need the tunnel.</p>
    </section>

    <p className="guide-footnote">Your task history, prompts, reports, events, and chat links are stored locally by AgentSync. The standard workflow does not use an OpenAI API or a remote AgentSync backend.</p>
  </section>;
}
