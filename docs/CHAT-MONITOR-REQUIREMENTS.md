---
repository: tammamalbony/agentsync
baseBranch: develop
reasoningEffort: high
agentsPerTeam: 5
maxConcurrentTeams: 1
executionMode: event-driven
autoMerge: false
---

# Feature 001 — Modern UI and ongoing chat monitor

Refresh the AgentSync side panel with a clear, modern dashboard and add a global list of registered ChatGPT conversations so a user can see their local AgentSync status and open a conversation directly.

## Acceptance criteria

- The side panel uses a polished, responsive layout with readable status badges and accessible controls.
- An **Ongoing chats** view lists registered conversations across feature teams, showing team, agent, local AgentSync state, latest execution phase, and whether the matching ChatGPT tab is open or active.
- Users can filter ongoing chats and completed chats, manually refresh the list, and open a saved conversation through the existing safe tab-navigation adapter.
- Browser tab presence refreshes automatically every 10 seconds by default. The user can choose 5 seconds, 10 seconds, 30 seconds, or manual refresh; the selected interval persists across panel reloads.
- ChatGPT tab visibility remains optional and is requested only after the user chooses to enable it. Without permission, show an explicit unknown/access-off state while keeping saved-chat navigation available.
- The extension reads tab URL and active-tab metadata only. It does not inspect page content, infer generation state, submit prompts, or start agent chats automatically.
- Unit tests cover refresh interval defaults and parsing, chat URL matching, active/open/closed/unknown presence, and the monitor's status mapping. The full verification command and Manifest V3 audit pass.
