# **AgentSync — Final Software Architecture & Specification**

**Version:** 1.0\
**Application type:** Chrome Extension\
**Architecture:** Event-driven, hierarchical multi-agent orchestration\
**AI provider:** Normal ChatGPT conversations\
**Communication layer:** GitHub Issues and Pull Requests\
**Execution model:** Parallel, dependency-aware development

## **1. Project objective**

AgentSync is a Chrome extension that transforms a Markdown file containing development requirements into multiple coordinated AI development teams.

Each feature is implemented by six independent ChatGPT conversations: one supervisor and five specialized development agents.

The extension manages conversations, detects execution events, routes instructions, preserves conversation context and coordinates feature delivery.

All AI reasoning takes place inside ordinary ChatGPT conversations.

# **1**

Supervisor per feature

# **5**

Developers per feature

# **6**

ChatGPT conversations

# **1**

GitHub pull request

# **5**

GitHub issues

# **0**

External AI API requirements

## **2. Requirements**

| Requirement                 | Specification                    |
| --------------------------- | -------------------------------- |
| AI environment              | Normal ChatGPT                   |
| ChatGPT Work                | Not used                         |
| Codex                       | Not used                         |
| OpenAI API                  | Not used                         |
| External backend            | Not required                     |
| Input format                | Markdown                         |
| Reasoning effort            | High by default                  |
| Execution                   | Parallel                         |
| Synchronization             | Event-driven                     |
| Polling intervals           | None for normal orchestration    |
| Conversation persistence    | Saved chat URLs                  |
| Communication               | GitHub                           |
| Dependency resolution       | Supervisor                       |
| Prompt routing              | Chrome extension                 |
| Automatic prompt submission | Intended, pending validation     |
| Automatic merging           | Disabled by default              |
| Human interaction           | Essential questions consolidated |

## **3. High-level system architecture**

**User**

Upload requirements · Configure repository · Start batch

**tasks.md**

Feature 1 · Feature 2 · Feature N

# **AgentSync Extension**

Central orchestration engine

Team Manager

Event Bus

Agent Registry

Order Router

Browser Adapter

GitHub Connector

State Manager

Persistent Storage

**Team 1**

Agent 0

A1

A2

A3

A4

A5

6 chats1 PR · 5 issues

**Team 2**

Agent 0

A1

A2

A3

A4

A5

6 chats1 PR · 5 issues

**Team N**

Agent 0

A1

A2

A3

A4

A5

6 chats1 PR · 5 issues

## **GitHub Repository**

Source code · Feature branches · Pull requests · Agent issues · Shared knowledge

### **Separation of responsibilities**

| Layer            | Responsibility                                 |
| ---------------- | ---------------------------------------------- |
| Chrome extension | Orchestration and message delivery             |
| Agent 0          | Intelligence, planning and decision making     |
| Agents 1–5       | Software implementation                        |
| GitHub           | Source of truth and shared memory              |
| IndexedDB        | Persistent local execution state               |
| User             | Requirements, approvals and critical decisions |

The extension itself does not need artificial intelligence.

## **4. Team architecture**

Every feature has its own isolated team.

## **Agent 0 — Supervisor**

Technical Lead · Feature Owner · Dependency Resolver

**Agent 1 — Software Architect**

Architecture, interfaces, shared types and technical contracts.

**Agent 2 — Backend Engineer**

APIs, database, business logic and authorization.

**Agent 3 — Frontend Engineer**

UI, UX, components, client logic and responsiveness.

**Agent 4 — Integration Engineer**

Service integration, configuration, infrastructure and compatibility.

**Agent 5 — QA & Security Engineer**

Testing, security, performance and code review.

### **Agent responsibilities**

| Agent | Primary deliverables              | Additional authority                     |
| ----- | --------------------------------- | ---------------------------------------- |
| A0    | Feature plan and completed PR     | Delegate, reassign, resolve blockers     |
| A1    | Architecture and shared contracts | Define technical interfaces              |
| A2    | Backend implementation            | Database migrations                      |
| A3    | Frontend implementation           | Client-side architecture                 |
| A4    | Integrated feature                | Integration fixes                        |
| A5    | Verified feature quality          | Identify defects and request corrections |

Agent 0 can dynamically redefine responsibilities according to the feature. Every team contains five development agents, but their scopes do not need to be identical across teams.

## **5. GitHub architecture**

The GitHub structure must remain minimal.

**owner/project**

**feature/authentication**

**PR #100 — Authentication**

\#101 — A1: Architecture

\#102 — A2: Backend

\#103 — A3: Frontend

\#104 — A4: Integration

\#105 — A5: QA & Security

**feature/payments**

**PR #106 — Payment System**

\#107 — A1: Architecture

\#108 — A2: Backend

\#109 — A3: Frontend

\#110 — A4: Integration

\#111 — A5: QA & Security

### **GitHub rules**

- Agent 0 creates or reuses one feature branch.
- Agent 0 creates or reuses one pull request when a valid branch difference exists.
- Agent 0 creates or reuses exactly five assigned issues.
- Every sub-agent contributes to the same feature PR.
- Issue comments contain progress, blockers, dependencies and implementation results.
- PR comments contain supervisor orders and team-level coordination.
- No additional management repositories or coordination issues are required.
- Only Agent 0 accepts completed work and closes the associated issues.

Temporary agent branches may be used for isolation without creating additional pull requests.

## **6. Complete execution lifecycle**

**01 — Import Markdown**

Parse features, requirements and repository configuration.

**02 — Create feature team**

Generate a unique team ID and initialize its supervisor.

**03 — Initialize supervisor chat**

Create Agent 0 conversation with High reasoning effort.

**04 — Initialize GitHub resources**

Supervisor prepares one PR and five assigned issues.

**05 — Create five agent chats**

Assign roles, issue references and feature context.

**06 — Execute in parallel**

Agents implement their assigned scopes.

**07 — Process completion events**

Notify Agent 0 whenever a development agent stops.

**08 — Resolve dependencies**

Supervisor searches GitHub and generates new instructions.

**09 — Resume existing agents**

Extension routes continuation prompts to saved conversations.

**10 — Validate feature**

Review code, acceptance criteria, security and tests.

**11 — Complete feature**

Close five issues and mark the shared PR ready for review.

Steps 7–9 repeat whenever necessary until the feature satisfies its completion criteria.

## **7. Event-driven orchestration**

This is the most important part of AgentSync.

There is **no fixed synchronization timer**. The extension reacts to conversation state changes and incoming orders.

### **System events**

| Event                    | Trigger                                 |
| ------------------------ | --------------------------------------- |
| `TEAM_CREATED`           | New feature imported                    |
| `SUPERVISOR_READY`       | Supervisor publishes team configuration |
| `AGENT_STARTED`          | Agent begins execution                  |
| `AGENT_STOPPED`          | Agent finishes generating               |
| `AGENT_BLOCKED`          | Missing dependency reported             |
| `SUPERVISOR_ORDER_READY` | New continuation order published        |
| `ORDER_DISPATCHED`       | Instruction successfully submitted      |
| `ORDER_FAILED`           | Dispatch unsuccessful                   |
| `AGENT_COMPLETED`        | Supervisor accepts agent deliverables   |
| `TEAM_COMPLETED`         | Feature passes final validation         |
| `USAGE_LIMIT_REACHED`    | ChatGPT reports an account limit        |
| `USER_INPUT_REQUIRED`    | Essential human decision required       |

A stopped conversation does not automatically mean the assigned development task is completed.

## **8. Intelligent dependency resolution**

Agent 0 must actively remove blockers rather than simply relay messages.

### **Example scenario**

**Agent 2 — Backend**

Blocked: Waiting for validation requirements from Agent 5

Blocked

**Extension**

Agent 2 has stopped. Notify Agent 0 immediately.

**Agent 0**

Searches Agent 5's branch, test files, commits and issue comments.

**GitHub**

Required validation rules found in existing test specifications.

New supervisor instruction

Agent 2: The validation requirements are available in the referenced test specifications. Implement the remaining validation rules using those verified requirements. Do not wait for Agent 5 to finish.

**Agent 2 resumes implementation**

Agent 5 continues its own work without interruption.

### **Supervisor resolution priorities**

| Priority | Resolution strategy                                    |
| -------- | ------------------------------------------------------ |
| 1        | Search existing repository code                        |
| 2        | Inspect active branches and commits                    |
| 3        | Inspect PR changes                                     |
| 4        | Read issues and comments                               |
| 5        | Inspect documentation and shared contracts             |
| 6        | Establish a safe provisional contract when appropriate |
| 7        | Reassign independent work                              |
| 8        | Request data from another agent                        |
| 9        | Request essential human input                          |

Agent 0 must distinguish verified information from proposed assumptions.

## **9. Chrome browser interaction architecture**

The browser adapter is responsible for communicating with normal ChatGPT conversations.

1\. Receive supervisor order

2\. Resolve team and agent identity

3\. Retrieve saved conversation URL

4\. Locate or open browser tab

5\. Verify correct conversation

6\. Check that generation has stopped

7\. Locate visible prompt composer

8\. Verify High reasoning effort

9\. Prepare continuation prompt

10\. Submit through permitted interaction

11\. Verify generation has started

12\. Observe generation completion

### **Browser adapter interface**

```
interface ChatGPTAdapter {
  createConversation(): Promise<ConversationRef>;

  openConversation(url: string): Promise<void>;

  verifyConversation(
    conversationId: string
  ): Promise<boolean>;

  getConversationState(): Promise<ChatState>;

  setReasoningEffort(
    effort: ReasoningEffort
  ): Promise<void>;

  preparePrompt(prompt: string): Promise<void>;

  submitPrompt(): Promise<DispatchResult>;

  observeStateChanges(
    handler: ChatEventHandler
  ): () => void;
}
```

This interface isolates all ChatGPT browser-specific behavior from the orchestration engine.

Chrome content scripts and `MutationObserver` are candidate technologies for detecting visible page-state changes.

**Important:** Automatic submission into arbitrary existing chats is not a documented ChatGPT API. The browser adapter must be validated for reliability and permitted use, with a user-confirmed submission fallback.

## **10. Agent state machine**

Additional exceptional states:

`PAUSED`, `FAILED`, `USAGE_LIMITED`, `AWAITING_USER`, `OFFLINE`, `CANCELLED`.

## **11. Communication protocol**

GitHub serves as the durable communication channel. Structured JSON messages can be embedded in issue and PR comments.

### **Agent status report**

```
{
  "type": "AGENT_STATUS",
  "teamId": "team-001",
  "agentId": 2,
  "issueNumber": 102,
  "pullRequestNumber": 100,
  "status": "BLOCKED",
  "completed": [
    "Authentication endpoints",
    "Database migrations"
  ],
  "remaining": [
    "Permission validation"
  ],
  "dependencies": [
    {
      "agentId": 5,
      "artifact": "VALIDATION_REQUIREMENTS",
      "status": "MISSING"
    }
  ],
  "commits": [],
  "modifiedFiles": [],
  "testResults": {},
  "questions": []
}
```

### **Extension notification to supervisor**

```
{
  "type": "AGENT_STOPPED",
  "eventId": "evt-00028",
  "teamId": "team-001",
  "agentId": 2,
  "targetAgentId": 0,
  "issueNumber": 102,
  "pullRequestNumber": 100,
  "actionRequired": true
}
```

### **Supervisor dispatch order**

```
{
  "type": "DISPATCH_ORDER",
  "orderId": "ord-00032",
  "teamId": "team-001",
  "sourceAgentId": 0,
  "targetAgentId": 2,
  "action": "RESUME",
  "priority": "HIGH",
  "reason": "Dependency resolved through GitHub",
  "prompt": "Review the referenced validation requirements and complete your implementation.",
  "references": [
    {
      "branch": "feature/authentication",
      "path": "tests/auth/validation.spec.ts"
    }
  ],
  "expectedResult": "Permission validation completed"
}
```

### **Dispatch acknowledgment**

```
{
  "type": "ORDER_ACKNOWLEDGED",
  "orderId": "ord-00032",
  "teamId": "team-001",
  "agentId": 2,
  "status": "SUBMITTED",
  "conversationId": "registered-chat-id"
}
```

All commands must be validated against registered teams, agent identities and permitted repositories. Orders require unique IDs to prevent duplicate execution.

## **12. Local data architecture**

**Batch**

1

id, filename, configuration, status

1:N

**Team**

id, batchId, feature, repository, branch, PR, status

1:6

**Agent**

id, teamId, role, chatUrl, tabId, issueNumber, state

1:N

**Events**

State changes

**Orders**

Instructions

**Dependencies**

Required outputs

### **IndexedDB stores**

| Store          | Purpose                              |
| -------------- | ------------------------------------ |
| `batches`      | Imported Markdown batches            |
| `teams`        | Feature teams                        |
| `agents`       | Agent identity and conversation URLs |
| `events`       | Persistent event queue               |
| `orders`       | Supervisor instruction queue         |
| `dependencies` | Dependency tracking                  |
| `executions`   | Dispatch and execution history       |
| `settings`     | Extension configuration              |
| `logs`         | Diagnostic and audit records         |

Authentication credentials should be handled separately using a secure, least-privilege authorization mechanism.

## **13. Technology stack**

| Layer                     | Technology                         |
| ------------------------- | ---------------------------------- |
| Browser platform          | Chrome Manifest V3                 |
| Extension framework       | WXT                                |
| Language                  | TypeScript                         |
| UI                        | React                              |
| Styling                   | Tailwind CSS                       |
| UI components             | shadcn/ui                          |
| State management          | Zustand                            |
| Database                  | IndexedDB + Dexie.js               |
| Schema validation         | Zod                                |
| Markdown parser           | Remark                             |
| Frontmatter parser        | gray-matter                        |
| GitHub client             | Octokit                            |
| Browser communication     | Chrome Runtime Messaging           |
| Browser tab management    | Chrome Tabs API                    |
| Browser state observation | Content scripts / MutationObserver |
| Unit testing              | Vitest                             |
| Integration testing       | Playwright                         |
| Package management        | pnpm                               |
| Build                     | Vite / WXT                         |

## **14. Project directory structure**

```
agentsync/
├── package.json
├── pnpm-lock.yaml
├── wxt.config.ts
├── tsconfig.json
├── README.md
│
├── entrypoints/
│   ├── background.ts
│   ├── chatgpt.content.ts
│   ├── github.content.ts
│   │
│   ├── sidepanel/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.html
│   │
│   ├── popup/
│   └── options/
│
├── src/
│   ├── core/
│   │   ├── orchestrator.ts
│   │   ├── batch-manager.ts
│   │   ├── team-manager.ts
│   │   ├── agent-manager.ts
│   │   ├── event-bus.ts
│   │   ├── event-queue.ts
│   │   ├── order-queue.ts
│   │   ├── order-router.ts
│   │   ├── execution-lock.ts
│   │   └── recovery-manager.ts
│   │
│   ├── adapters/
│   │   ├── chatgpt/
│   │   │   ├── chatgpt.adapter.ts
│   │   │   ├── conversation-manager.ts
│   │   │   ├── composer.ts
│   │   │   ├── effort-selector.ts
│   │   │   ├── generation-observer.ts
│   │   │   └── page-state.ts
│   │   │
│   │   ├── github/
│   │   │   ├── github.adapter.ts
│   │   │   ├── repository.service.ts
│   │   │   ├── issue.service.ts
│   │   │   ├── pull-request.service.ts
│   │   │   └── command.service.ts
│   │   │
│   │   └── chrome/
│   │       ├── tabs.service.ts
│   │       ├── messaging.service.ts
│   │       └── storage.service.ts
│   │
│   ├── prompts/
│   │   ├── supervisor.md
│   │   ├── architect.md
│   │   ├── backend.md
│   │   ├── frontend.md
│   │   ├── integration.md
│   │   ├── qa-security.md
│   │   ├── continuation.md
│   │   ├── agent-stopped.md
│   │   └── prompt-builder.ts
│   │
│   ├── protocols/
│   │   ├── event.schema.ts
│   │   ├── order.schema.ts
│   │   ├── status.schema.ts
│   │   └── message-parser.ts
│   │
│   ├── database/
│   │   ├── database.ts
│   │   ├── migrations.ts
│   │   └── repositories/
│   │
│   ├── parsers/
│   │   ├── markdown-parser.ts
│   │   ├── feature-parser.ts
│   │   └── config-parser.ts
│   │
│   ├── components/
│   │   ├── dashboard/
│   │   ├── teams/
│   │   ├── agents/
│   │   ├── events/
│   │   ├── orders/
│   │   ├── settings/
│   │   └── ui/
│   │
│   ├── stores/
│   ├── types/
│   ├── utils/
│   └── constants/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
└── docs/
    ├── ARCHITECTURE.md
    ├── AGENT_PROTOCOL.md
    ├── GITHUB_PROTOCOL.md
    ├── BROWSER_ADAPTER.md
    └── DEVELOPMENT.md
```

## **15. Markdown input format**

```
---
repository: owner/project
baseBranch: develop
reasoningEffort: high
agentsPerTeam: 5
maxConcurrentTeams: 1
executionMode: event-driven
autoMerge: false
---

# Feature 001 — Authentication

Implement a complete authentication system.

## Requirements

- JWT authentication
- Refresh token management
- Role-based authorization
- Login and registration screens
- Unit and integration tests

## Acceptance criteria

- Users can register and log in.
- Protected routes enforce permissions.
- All relevant tests pass.

---

# Feature 002 — Payment System

Implement a complete payment system.

## Requirements

- Payment provider integration
- Payment history
- Refund management
- Webhook processing
- Security validation

---

# Feature 003 — Delivery Tracking

Implement real-time delivery tracking.

## Requirements

- Driver location updates
- Customer tracking interface
- Delivery status management
- Map integration
```

AgentSync creates an independent six-conversation team for each feature.

## **16. Final dashboard prototype**

# **AgentSync**

Multi-Agent Development Platform

Active

**owner/project**

develop

Teams

# **3**

Agents

# **18**

Pull requests

# **3**

&#x20;Import tasks Pause

Feature teamTeam 001 — Authentication

**Authentication**

PR #100

78% estimated completion

AgentsEventsOrdersGitHub

**A0 — Supervisor**

Resolving dependency

**A1 — Architect**

Completed

**A2 — Backend**

Blocked

**A3 — Frontend**

Working

**A4 — Integration**

Working

**A5 — QA & Security**

Reviewing

Event-driven mode · No polling interval

This is an interactive UI prototype using demonstration data, not an installed Chrome extension.

## **17. Batch configuration and resource calculator**

## **Batch resource planner**

Number of features

## **10**

Concurrent teams

**1**

Reasoning effort

MediumHighExtra High

Total conversations

# **60**

Supervisors

# **10**

Development agents

# **50**

GitHub issues

# **50**

Pull requests

# **10**

Concurrent conversations

# **6**

&#x20;Copy configuration JSON

## **18. Concurrency and reliability**

| Mechanism                     | Purpose                                          |
| ----------------------------- | ------------------------------------------------ |
| Team isolation                | Prevent commands crossing between teams          |
| Agent execution lock          | Prevent simultaneous prompts to one conversation |
| Supervisor execution lock     | Prevent overlapping supervisor requests          |
| Event batching                | Consolidate simultaneous agent events            |
| Order deduplication           | Prevent repeated instructions                    |
| Persistent queues             | Recover after Chrome restart                     |
| File ownership                | Prevent conflicting implementation changes       |
| Serialized Git integration    | Prevent conflicting pushes                       |
| Dependency tracking           | Prevent unnecessary waiting                      |
| Circular dependency detection | Detect coordination deadlocks                    |
| Retry limits                  | Prevent infinite execution loops                 |
| Human escalation              | Consolidate essential questions                  |
| Emergency stop                | Halt new dispatches                              |
| Usage-limit handling          | Respect account restrictions                     |

Chrome Manifest V3 background workers are not permanently running processes. Queues and state must therefore be persisted rather than relying on in-memory variables.

## **19. ChatGPT usage limits**

AgentSync itself does not consume OpenAI API tokens. The ChatGPT conversations performing the development work consume the applicable subscription allowance.

Starting in December 2026, OpenAI has announced a shared token-based usage allowance across ChatGPT and Codex for Plus, Pro and Business plans. Advanced reasoning consumes this allowance, while Instant chat remains excluded.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://help.openai.com\&sz=32)

OpenAI Help Center



| Operation                      | AI usage        |
| ------------------------------ | --------------- |
| Import Markdown                | No              |
| Create local team records      | No              |
| Navigate between conversations | No              |
| Process events                 | No              |
| Route supervisor orders        | No              |
| GitHub API operations          | No OpenAI usage |
| Supervisor reasoning           | Yes             |
| Development agent reasoning    | Yes             |
| Continuation responses         | Yes             |

AgentSync must never attempt to bypass account usage limits. OpenAI's terms also restrict automated extraction of service output, which is why the architecture uses GitHub status reports instead of scraping generated chat responses.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://openai.com\&sz=32)

OpenAI+1



## **20. Development roadmap**

**1**

Phase 1

**Core Chrome extension**\
Manifest V3, side panel, Markdown importer, IndexedDB, team registry and settings.

**2**

Phase 2

**ChatGPT browser adapter**\
Conversation navigation, composer discovery, effort selection, state observation and validated submission workflow.

**3**

Phase 3

**GitHub communication**\
Authentication, issue reports, PR commands, structured messages and order retrieval.

**4**

Phase 4

**Multi-agent orchestration**\
Supervisor prompts, team creation, event routing, agent state machines and dependency resolution.

**5**

Phase 5

**Parallel feature teams**\
Multiple independent teams, execution locks, concurrency management and recovery.

**6**

Phase 6

**Production readiness**\
Security, automated tests, audit logs, exports, error handling and extension packaging.

## **21. Definition of done**

A feature is considered completed only when:

- All five agent scopes have been implemented.
- All required commits are included in the shared PR.
- All acceptance criteria are satisfied.
- All required tests and builds pass.
- Integration conflicts are resolved.
- Critical security findings are resolved.
- No essential dependencies remain blocked.
- Agent 0 has reviewed and accepted the implementation.
- All five GitHub issues are closed.
- The single feature PR is ready for human review.
- All six conversation URLs and execution records are preserved.

## **22. Final architectural decisions**

| Decision              | Selected approach                  |
| --------------------- | ---------------------------------- |
| Architecture pattern  | Hierarchical multi-agent system    |
| Orchestration pattern | Event-driven                       |
| Intelligence          | ChatGPT conversations              |
| Control plane         | Chrome extension                   |
| Communication bus     | GitHub comments                    |
| Shared memory         | GitHub repository                  |
| Persistence           | IndexedDB                          |
| Team size             | Six agents                         |
| Supervisor ownership  | One feature per supervisor         |
| GitHub footprint      | One PR and five issues per feature |
| Prompt delivery       | Browser adapter                    |
| Agent continuation    | Existing conversations             |
| Deployment            | Local Chrome extension             |
| External AI backend   | None                               |

### **Outstanding implementation validations**

The architecture is complete as a proposal, but the software has not yet been implemented or tested. Three important requirements remain to be validated:

1. Reliable and permitted automatic message submission and generation-completion detection in ordinary ChatGPT conversations.
2. Event-driven receipt of GitHub commands without polling or a remote webhook receiver. A local-only extension cannot receive GitHub webhooks directly, so a user-mediated synchronization mechanism or optional event relay may be necessary.
3. Whether the connected GitHub tools provide sufficient repository write, execution and testing capabilities in normal ChatGPT chats. GitHub access alone does not guarantee a complete coding environment.

The default role assignments, one concurrent feature team, serialized code integration and human-approved merging are recommended architectural decisions.

# **AgentSync**

Event-Driven Multi-Agent Development Orchestrator

## **1 Feature = 1 Team**

# **6**

Chats

# **5**

Issues

# **1**

Pull request

ChatGPT provides the intelligence. GitHub provides the shared knowledge. AgentSync provides the coordination.
