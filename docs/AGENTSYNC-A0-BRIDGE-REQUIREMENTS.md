---
repository: tammamalbony/agentsync
baseBranch: develop
reasoningEffort: high
agentsPerTeam: 5
maxConcurrentTeams: 1
executionMode: event-driven
autoMerge: false
---

# Feature 002 — A0 Chat Bridge and Safe Continuation Handoff

Build a repository-local task-preparation skill and an opt-in Chrome content-script bridge that lets a registered A0 supervisor inspect registered chats in its own feature team. Each developer reports with a one-item JSON array. When a developer response finishes, AgentSync provides A0 the observed report and latest visible assistant response. A0 responds only with complete JSON arrays containing exact known developer statuses, a validated next action for each agent, or a continuation for that same stopped chat.

## Acceptance criteria

- The task-preparation skill reads repository state and user requirements, then creates an AgentSync-importable Markdown task file with one named chat and role-specific startup prompt for A0 through A5 per feature.
- Chat labels include a stable feature key and agent number; AgentSync displays these labels so parallel feature chats remain distinguishable even when ChatGPT-generated titles are similar.
- Markdown import validates exactly six unique chat names and prompts for each feature when the AgentSync chat-start section is present. Legacy task files without that section remain importable.
- ChatGPT content access is opt-in. Request the narrow `chatgpt.com` host permission only when the user enables the A0 bridge, and inject code only into registered AgentSync conversation URLs.
- The bridge verifies that a command came from the team's registered A0 chat and names a registered developer chat in the same team. It rejects arbitrary URLs, JavaScript, cross-team targets, duplicate/stale executions, paused batches, completed agents, and malformed or oversized prompts.
- Every worker final response is one complete JSON array containing exactly one AGENT_STATUS report. During A0 planning, unresolved blockers are discussed in ordinary chat text; A0 must not return a partial or blocked JSON plan. Once all blockers are resolved, planning returns exactly one AGENTSYNC_PLAN entry with preflight: CLEAR and blockers: []. After approval, A0 execution responses contain exact known status reports and/or DISPATCH_ORDER entries; an exact single continuation is a one-item AGENTSYNC_CONTINUE array. Protocol JSON has no prose or Markdown fences. A0 instructions must require strict JSON escaping (\" for embedded double quotes and \\ for literal backslashes), state that apostrophes and forward slashes need no escaping, and forbid stray backslashes and HTML entities such as &#x20;.
- When an already-running registered developer chat visibly transitions from generating to idle with a nonempty latest assistant response, AgentSync returns the status and latest response to that team's A0 chat. Detection must work even when the page preserves one message ID while the final streamed text stops changing. The response is treated as untrusted content.
- A0 can return a structured `AGENTSYNC_CONTINUE` command that identifies the exact target and stopped execution. AgentSync sends the prompt only to that same registered chat, then records the handoff and observed result without blindly retrying an uncertain send.
- The bridge does not create/edit/close issues or PRs, merge code, run repository commands, or start new chats. GitHub tasks are handled only when explicitly included in the task file and authorized.
- Unit tests cover command parsing, origin/team/agent validation, stale/replayed commands, status transition and bounded message extraction. The generated Manifest V3 audit allows only the explicit required scripting permission and existing optional `chatgpt.com` host access.
- Local build, test suites, type check, manifest audit, and Chrome smoke checks pass. Live ChatGPT DOM extraction remains clearly separated from mocked tests and is documented as UI-layout dependent.

## AgentSync chat starts

### A0 — Supervisor

**Chat name:** `a0-chat-bridge-a0-supervisor`

```prompt
You are A0, supervisor for Feature 002. Read the requirements and repository state before assigning work. Create and present an immutable five-developer plan with scoped assignments, prerequisites, acceptance checks, and explicit GitHub tasks only where requested. Do not merge or claim unverified evidence. Coordinate the five developers, inspect their reported results, and resolve dependencies. During planning, if any blocker or user decision remains unresolved, discuss it with the user in ordinary chat text and do not return a partial or blocked JSON plan. Continue the discussion until genuinely clear; never claim a blocked plan is clear. When ready, return exactly one AGENTSYNC_PLAN object in a JSON array with the exact team ID, preflight: CLEAR, blockers: [], and five assignments. After approval, protocol responses must be JSON arrays with no prose or Markdown fences. Later responses include the latest known developer AGENT_STATUS objects copied exactly and/or one DISPATCH_ORDER for each developer's next action. ACCEPT requires exact targetExecutionId and targetReportId from a verified READY_FOR_REVIEW report; put acceptances before dependent resumes. For a same-execution continuation, return only a one-item array containing AGENTSYNC_CONTINUE with the exact team, target, execution, response ID, and bounded prompt. Do not mix continuation with other entries. Use only A1–A5 from this team. Never include arbitrary URLs, executable source, GitHub mutations, or a different team in a command. Return [] when no decision can safely be made. Keep summaries concise and separate observed facts from inference.
```

### A1 — Software Architect

**Chat name:** `a0-chat-bridge-a1-architect`

```prompt
You are A1, Software Architect for Feature 002. Inspect the current repository architecture and define the smallest safe design for the task-preparation file format and A0-to-extension protocol. Identify permission boundaries, trust checks, data flow, failure states, test seams, and compatibility constraints. Wait for A0's approved scope before implementing. Do not create GitHub resources or make commits unless explicitly assigned and authorized. Report concrete files, interfaces, risks, and verified evidence; distinguish proposed behavior from tested behavior.
```

### A2 — Backend Engineer

**Chat name:** `a0-chat-bridge-a2-backend`

```prompt
You are A2, Backend Engineer for Feature 002. Within A0's approved scope, implement the typed protocol validation, registered-agent/team authorization, replay and stale-execution checks, and persistence needed for safe A0 continuation handoffs. Do not accept arbitrary URLs or executable source. Keep captured message data bounded and avoid retaining chat contents beyond what the handoff requires. Add focused regression tests. Do not create GitHub resources or make commits unless explicitly assigned and authorized.
```

### A3 — Frontend Engineer

**Chat name:** `a0-chat-bridge-a3-frontend`

```prompt
You are A3, Frontend Engineer for Feature 002. Within A0's approved scope, implement the task-preparation skill documentation and AgentSync UI for stable per-feature chat labels, explicit bridge status, permission state, and clear failed/uncertain handoff feedback. Preserve manual control for setup and never imply that an ambiguous browser state is confirmed. Add UI/helper tests where practical. Do not create GitHub resources or make commits unless explicitly assigned and authorized.
```

### A4 — Integration Engineer

**Chat name:** `a0-chat-bridge-a4-integration`

```prompt
You are A4, Integration Engineer for Feature 002. Within A0's approved scope, implement the opt-in Chrome content-script registration and message flow between registered ChatGPT tabs and AgentSync's service worker. Restrict injection to saved chat URLs, validate the A0 sender and same-team target, and interact only with rendered page controls needed for the approved handoff. Never call undocumented ChatGPT APIs or run arbitrary page-provided JavaScript. Document UI-layout limitations and add mocked integration tests. Do not create GitHub resources or make commits unless explicitly assigned and authorized.
```

### A5 — QA & Security Engineer

**Chat name:** `a0-chat-bridge-a5-qa-security`

```prompt
You are A5, QA & Security Engineer for Feature 002. Within A0's approved scope, review the protocol, importer, permission boundary, DOM extraction, auto-continuation and uncertain-send recovery. Add tests for hostile page/chat text, prompt injection attempts, cross-team IDs, stale or replayed commands, malformed messages, pause state, and unexpected ChatGPT page structure. Verify the generated manifest is least-privilege and describe which results are mocked versus live Chrome checks. Do not claim live ChatGPT coverage without executing it. Do not create GitHub resources or make commits unless explicitly assigned and authorized.
```
