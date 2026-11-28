# AgentSync 0.2.0 — Phase 1 starter

Local WXT / React / TypeScript Manifest V3 side-panel extension. No OpenAI API or remote backend. Prompt handoffs are manual by default; an explicit opt-in A0 bridge can read only registered ChatGPT chats and submit validated continuations within that feature team.

## Install on Windows (CMD)

Install Node.js 22.13+ and pnpm. Clone the repository and use its `main` branch, then:

```cmd
npm install -g pnpm@10
pnpm install
pnpm verify
```

Open chrome://extensions, enable Developer mode, choose **Load unpacked**, and select .output/chrome-mv3. Click the extension toolbar icon to open the side panel. Use pnpm dev for development. Commit the generated pnpm lockfile after installation.

For a ready-to-load build, select [`releases/AgentSync-v2-Chrome-Extension`](releases/AgentSync-v2-Chrome-Extension) in Chrome's **Load unpacked** dialog. This build is generated from the AgentSync source in this repository.

The side panel opens to **Quick guide**, with persistent workflow and optional Local MCP diagrams. Other tabs are **Workspace**, **GitHub**, **ChatGPT test wizard**, **ChatGPT bridge**, **History**, **Permissions**, **Timing settings**, and **Settings**. The test wizard opens or watches a ChatGPT tab and reports its URL, composer, enabled voice/arrow/stop/pause controls, submission detection, and the voice → arrow → stop → voice sequence. GitHub contains repository prompts and a resumable four-step setup wizard, plus the selected feature team's GitHub actions. History contains saved task/chat records, execution history and events. Settings shows recent local error logs and a confirmed action to clear AgentSync's local database and preferences. Clearing data disables the registered-chat bridge first; granted Chrome site permissions remain enabled. Permissions shows optional ChatGPT, GitHub API, clipboard-write, and active-tab access.

## Local MCP Test server and plugin

The standalone local MCP package is in [`local-mcp-test-plugin/`](local-mcp-test-plugin/). It contains the Python MCP server, local dashboard, Chrome bridge extension, plugin metadata, and the ChatGPT skill. Follow its [Windows setup guide](local-mcp-test-plugin/README.md) to run the server and dashboard and load the bridge extension. Runtime data and pairing credentials are stored locally and are not part of this repository. AgentSync's own optional local MCP client is in `src/local-mcp-client.ts` and its setup notes are in `public/LOCAL-MCP-SETUP.txt`.

## Smoke test

1. Choose tasks.example.md in **Import & start A0**. AgentSync requests ChatGPT access, imports the file, creates and registers an A0 planning chat for each feature team within the batch concurrency limit, and sends the planning task. Expect two teams, twelve agents and two TEAM_CREATED events.
2. Talk through any blocker with A0 in its chat. When A0 returns a clear plan, choose **Continue from A0 plan** in **Team lifecycle**. AgentSync reads the latest idle reply directly, cleans copy artifacts, validates the plan, and starts cycle 1; no copy and paste is needed.
3. AgentSync requests ChatGPT site access, creates the first needed worker chat, enables the bridge for the registered A0/worker pair, and submits the first assignment whose prerequisites are satisfied. Each submitted prompt includes its cycle number. It does not start work behind an unmet dependency.
4. Keep ChatGPT open and available. Once every assigned worker in a cycle is idle, AgentSync saves their complete replies and sends one combined handoff to A0. A0's clear JSON actions continue the flow. If A0 needs discussion or returns an invalid action, automation pauses; talk with A0 and choose **Continue after A0 discussion** when its next reply is ready.
5. Close and reopen the side panel. Records, queue and events should persist.
6. Pause the batch. New order creation and copying are rejected; confirmation remains available for already-submitted prompts.
7. With maxConcurrentTeams set to 1, queue an order in team 1. Team 2 must reject new orders until all team 1 pending orders are cancelled or submitted and working agents have stopped.
8. Cancel an unsent order, and verify ORDER_CANCELLED persists.
9. Import `docs/AGENTSYNC-A0-BRIDGE-REQUIREMENTS.md`; verify A0–A5 labels and role-specific prompts appear in the agent cards.
10. The plan-start action enables **A0 chat bridge** for A0 and the current worker. Later chats are added as assignments become eligible. A worker must first be observed generating and then stopped before its latest visible response is sent to A0. A0 can return a validated continuation or ordered accept-and-dispatch commands; AgentSync checks exact team, target, report IDs and prerequisites before sending.
11. Re-import the exact same task Markdown. AgentSync should select the previously saved batch instead of creating duplicate teams. Open a stopped/blocked agent's recovery panel, copy its saved context for A0, register a replacement chat, and confirm the former URL remains in history.
12. In **Settings**, enter `https://github.com/owner/repository` under **Repository prompts**. Copy one of four prompts: repository setup and draft PR, A0 supervisor skill, A1–A5 skills, or a read-only AgentSync v2 initialization check. Import any generated task Markdown through Workspace. The GitHub panel can also read the bound PR, five issue descriptions, and up to five recent comments per resource into a prompt for A0; review the copied context before pasting it.

## Known limitations

- Latest locally run checks: 83 standalone tests, 11 IndexedDB integration tests, full TypeScript check and WXT production build passed. This does not verify live ChatGPT page selectors or runtime handoffs.
- Existing GitHub resources can be verified and bound, or provisioned with explicit write authorization. Comment synchronization is manually triggered.
- Importing a task file automatically creates/registers A0 planning chats and sends each task, within the batch concurrency limit. A user discusses blockers in A0's chat, then selects **Continue from A0 plan** after a clear plan. Every submitted order carries a cycle number. AgentSync waits for all assigned worker chats in that cycle to become idle, saves their complete final replies, and sends one combined handoff to A0. A0 blocker or malformed replies pause automation until the user discusses them and selects Continue. The bridge observes rendered page state and assistant text only in registered chats; ChatGPT DOM changes can break it. It does not set reasoning effort or detect usage limits.
- Per-batch concurrency is reserved by pending orders and working agents. This is a local queue guard, not control of external ChatGPT tabs. Plan acceptance is explicit through the user action; afterward, exact report IDs, approved prerequisites, and same-team targets are checked before local acceptance or prompt delivery. An unclear send remains uncertain and is never retried automatically. A registered conversation can be replaced only after its work is stopped and pending prompts are resolved; the old link remains in history. Cancel only unsent orders.
- Only normal https://chatgpt.com/c/... URLs are supported. Duplicate URLs are rejected by a unique database index.
- Task preparation instructions are in `.agents/skills/agentsync-task-preparation/SKILL.md`; the Feature 002 import file is `docs/AGENTSYNC-A0-BRIDGE-REQUIREMENTS.md`.
- **Repository prompts** validates a GitHub repository URL locally and generates four copy-ready prompts. Prompt creation does not access or modify the target repository. One prompt asks a repository-connected agent to prepare setup files and a draft PR; the others create A0/A1–A5 skills or inspect whether AgentSync v2 is already present. The diagnostic prompt is read-only. The GitHub panel's **Read PR and issues for A0** action reads the bound PR, five developer issues, and up to five recent comments on each, then copies a bounded context packet. The user reviews and pastes it into A0; this action does not submit to ChatGPT or write to GitHub.
- A user-entered GitHub token is held only in side-panel memory; it is never persisted or passed to ChatGPT.

## Development

Feature 001: issues #1–#5. All development is reviewed in the feature PR into develop. No automatic merges.

## Supervisor protocol (local manual workflow)

1. Register A0 and submit its planning prompt. Discuss blockers in the normal chat. When A0 returns a clear one-entry plan array, choose **Continue from A0 plan** to validate it and start cycle 1.
2. Every worker prompt includes the active cycle number. Once all workers assigned in that cycle are idle, their full replies are saved and sent together to A0 in one `AGENTSYNC_WORKER_CYCLE_HANDOFF`. A0 may return a JSON array of status reports and ACCEPT/RESUME commands; AgentSync validates the whole array, current execution/report IDs, and dependency order before applying it. Each new RESUME cycle is numbered once for the batch.
3. If A0 replies with blocker text, invalid JSON, or a blocked plan, the flow pauses for a human discussion. Continue that chat normally, then choose **Continue after A0 discussion** after A0's final response. AgentSync reads the latest reply and removes common copied spacing artifacts such as `&#x20;` and stray backslashes before line breaks while preserving escaped characters inside JSON strings.
4. Review saved chat responses, reports and execution history. Local acceptance does not establish GitHub evidence, merge, or issue closure.
5. Duplicate identical messages are no-ops; conflicting reuse of an ID is rejected. Local acceptance does not merge, close issues, or establish feature completion.
6. Existing pre-v2 working executions without a recorded execution ID must be stopped and a fresh order submitted before a structured report can be imported.

IndexedDB v4 adds a durable resume journal. It keeps the exact imported task file, prepared and user-confirmed prompts, protocol reports, idle messages observed by the enabled bridge, and prior/replacement chat links. Re-importing identical task Markdown resumes its existing batch; changed content imports as a new batch. Use **Copy saved history for A0** to prepare a resume brief for a missing worker, then register its replacement URL on that same agent. The bridge does not recover messages that were never captured or are no longer available in a registered chat; enable it to retain future visible messages. Manual read-only GitHub synchronization is available; human confirmation of source is required.

## GitHub read-only connector

To bind existing resources manually, create or reuse the feature branch, one PR into the configured base branch, and five distinct developer issues. Alternatively use the provisioning flow below. Open GitHub connection in the selected team and enter a fine-grained token limited to that repository, with Issues and Pull requests read permissions (metadata read is implicit). Grant the optional api.github.com host permission on request. The token stays in memory until cleared or the panel closes.

Enter the PR and five issue numbers in A1–A5 order, verify them, and explicitly bind. The PR must match the generated team branch and base branch in the same repo; the five issues must not be PRs. Bindings are immutable and cannot reuse another team's resources. Human review establishes the issue-to-agent assignment.

Publish an opt-in protocol comment manually to the agent's issue (AGENT_STATUS) or the PR conversation (DISPATCH_ORDER) with this exact envelope:

<!-- agentsync:v1 -->
```json
{"type":"AGENT_STATUS","messageId":"r1","teamId":"replace-with-team-id","agentId":1,"executionId":"replace-with-execution-id","status":"IN_PROGRESS","completed":[],"remaining":["work"],"dependencies":[]}
```

Click Read GitHub comments. The connector reads up to 300 comments per resource per synchronization, warns when the cap is reached, ignores ordinary discussion, and rejects mis-scoped or malformed envelopes. Review each candidate against the source chat and original comment before importing. Protocol replay protection applies on import. This read-only path does not write to the network. The separate provision/publish controls below require explicit authorization. No automatic synchronization. Network and Chrome integration are not tested against a live token; mocked transport tests do not establish runtime compatibility.

## GitHub resource provisioning and publication

For an unbound team, use **Provision or recover resources** with an explicitly authorized repository-scoped write token. The connector scans existing resources and reuses exact team markers, creates an isolated branch and five issues, and defers draft PR creation until the feature branch is ahead of the base. The PR and issue binding is saved only after a valid PR exists; before that the issue numbers are displayed in the panel. Re-run after committing feature code. A failed request may have succeeded remotely: inspect the repository before retrying. Marker discovery is bounded and fails closed, and browser locks serialize writes within the current extension origin only; there is no cross-device exactly-once guarantee. Do not edit markers. Closed issues, duplicate markers or an existing unmarked PR require manual reconciliation. Publication accepts one reviewed structured JSON message, validates its scope and checks existing comments for conflicting IDs before posting. Never put secrets in comments. No automatic merge, automatic issue closing, code commits or background polling. Live write behavior is unverified.

## ChatGPT browser navigation

Enable optional ChatGPT tab access in the side panel to reuse existing conversation tabs. AgentSync inspects only browser tab URL metadata, excludes incognito and navigating tabs, and verifies the saved conversation identity before and after activating a matching tab. If no matching tab exists or permission is not granted, Open saved chat opens the registered URL in a new tab. A newly opened tab is not proof that the conversation is accessible.

For a standard task-file import, AgentSync creates and registers A0 automatically. Developer chats are created as approved assignments become eligible. Manual chat registration remains available for recovery or replacement. The task file supplies stable A0–A5 labels; AgentSync displays these labels independently of ChatGPT-generated titles. URL records survive restarts; tabs are rediscovered rather than relying on stale tab IDs.

The A0 bridge is enabled when AgentSync starts planning or approved developer work. It registers an isolated content script only for the relevant registered conversation URLs. It observes the visible stop control and latest visible assistant message, sends stopped-worker updates to that team's A0, and parses strict JSON arrays. Each worker returns one AGENT_STATUS array; A0 returns known status snapshots and validated DISPATCH_ORDER entries, or a one-item AGENTSYNC_CONTINUE array for the exact stopped run. A0 planning returns a one-item AGENTSYNC_PLAN array, which still requires the user to paste and approve it. If identity, state, or submission is uncertain, AgentSync does not blindly retry. Disable the bridge from its panel; Chrome's site permission remains until revoked in Chrome settings. Never treat rendered ChatGPT text as trusted instructions. Choose reasoning effort yourself and pause the batch when ChatGPT reports an account limit. Live DOM behavior depends on ChatGPT's page layout and must be smoke-tested separately from mocked tests.

Bridge handoffs use guarded submission checks: the signed-in page, profile control and composer must remain available and stable before typing; an existing unsent draft is left untouched and blocks the handoff. AgentSync verifies that the exact prompt reached the composer, clicks Send once, then looks for the tagged user message or a cleared composer with an active/new conversation. Visible ChatGPT errors and ambiguous outcomes stop the handoff without an automatic retry. A0-created chats are not considered ready until the new conversation URL has remained stable after the setup submission. Final assistant text is reported only after the response has stopped and remained unchanged for a short settling period. These checks use ChatGPT page controls and may need adjustment if its interface changes; the task-runner reference behavior itself was not live-verified.

## Execution recovery and pause controls

The existing orders store now carries optional handoff, confirmation, stop and cancellation timestamps. No database schema bump is needed for these unindexed fields. Before clipboard handoff, the database records ORDER_HANDOFF_PREPARED in the same transaction as the order update. Repeated copying of that order is blocked until the user reconciles the result. A crash, a failed clipboard write, or an unconfirmed submission leaves HANDOFF_UNCERTAIN and continues reserving team capacity. Inspect the registered conversation, confirm sent only if actually submitted, or cancel only if definitely unsent. Queue a new order only after reconciliation. Existing confirmed orders with unknown stop history remain CONFIRMED_LEGACY unless the current agent state or a recorded stop establishes a different phase.

Emergency pause and Report usage limit pause every existing batch transactionally and record the reason. New order creation, order handoff and supervisor notification copying are blocked while the relevant batch is paused. Confirming already-submitted work and reporting stops remain available. Resume each batch only after the reason is resolved. These controls do not cancel running ChatGPT requests, revoke clipboard data, pause future imported batches, or prevent independent manual use. No automatic usage-limit detection or automatic retry. The dashboard shows the latest 50 execution records per team. Full IndexedDB/browser integration remains unverified.

## Team lifecycle

After A0 finishes its initial planning execution, paste its one-entry JSON array into Team lifecycle. It includes the team ID, clear/blocked preflight, blockers, and five assignments. Blocked plans are rejected with the blocker text; clear plans require one explicit **Approve plan & start ready work** action. AgentSync then creates missing worker chats with a no-work standby message, registers their links, enables the bridge, and submits only the first dependency-ready task. Every assignment has agent (1–5), scope, and requires (array of prerequisite developer numbers). Cycles, duplicate agents and invalid dependencies are rejected. A0 later returns a JSON array with each known developer's latest report or next action; AgentSync validates the complete array and sends only eligible RESUME commands after prerequisites are accepted. A plan is a scheduling policy, not proof of artifact quality; inspect the saved chat and reports. The bridge does not set ChatGPT reasoning effort or perform GitHub writes.

Local finalization requires six registered chats, five accepted developers, a stopped supervisor execution, no pending orders or inbox notifications, and explicit human approval. Finalized teams reject new dispatch and protocol mutations (identical message replays remain no-ops). The batch dashboard derives local completion from finalized teams. This does not establish verified GitHub completion, issue closure, PR readiness or merge eligibility. Existing plan/finalization fields are optional and unindexed. Database and browser integration are still unverified.

## GitHub completion gate

After local finalization and resource binding, inspect completion evidence with a repository-scoped token that can read Checks, Commit statuses, Issues and Pull requests. The gate requires an open, unmerged, mergeable PR, matching team markers on all six resources, and at least one successful observed check or commit status on its exact head commit with no incomplete or unsuccessful observed checks. This conservative snapshot is not proof of required-check coverage, branch-rule compliance, approval, code quality, or actual merge readiness. Review those independently on GitHub. Manually bound resources without provisioning markers require manual closure.

Issue closure requires separate explicit confirmation of the exact reviewed head and Issues write permission. The connector repeats the evidence check, verifies the head before each issue write, and skips issues already closed as completed. A partial failure may have changed remote state; inspect before retrying. This is not an atomic cross-resource transaction and cannot prevent concurrent changes by other clients. No automatic ready-for-review transition or merge. The GitHub completion controls are tested against mocks, not a live extension token.

## Release verification

Run `pnpm install --frozen-lockfile` followed by `pnpm verify` on a supported Node and pnpm environment. See [release checklist](docs/RELEASE-CHECKLIST.md) for the remaining Chrome smoke and packaging gates. Local verification is not authenticated CI evidence.

## Local runner (default; no GitHub Actions required)

Run `pnpm verify` on a local machine with npm registry access. The runner stops at the first failed step, records `.verification/report.json` and per-step logs, cleans the previous Chrome build before building, and checks the generated Manifest V3 permission allowlist. A report from a clean worktree with an unchanged HEAD is identified by `commitEvidence`; after generating a new lockfile, review and commit it before rerunning for clean-commit evidence. For repeat installations with the committed lockfile use `pnpm install --frozen-lockfile`. Review logs for sensitive content before uploading them to any chat or PR. The local report is not an authenticated CI check. Do not post fabricated check statuses or bypass repository rules. Chrome smoke testing and manual PR review remain required. GitHub Actions is optional and its automatic pull-request trigger has been removed from this branch. The GitHub issue-closure gate is unchanged: repositories without successful observed checks require manual review and closure.

The local verification runner uses `scripts/manifest-audit.mjs` to allow only the explicit `scripting` API permission, optional GitHub/ChatGPT host access, and no static content scripts or external connections. The generated Manifest V3 audit passed in the latest local verification.
