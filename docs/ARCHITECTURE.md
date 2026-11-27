# AgentSync — implementation baseline

This is a condensed implementation note, not the full original architecture specification.

- Local-only Chrome MV3 extension; WXT, TypeScript, React and IndexedDB.
- One feature maps to one supervisor and five specialist agents, one feature branch, one pull request and five issues.
- Ordinary ChatGPT conversations remain the intended reasoning environment; no OpenAI API, Codex or remote agent backend.
- Conversation identities persist as validated URLs. Prompt handoff uses explicit user confirmation pending reliable, permitted integration validation.
- GitHub is the durable code and communication layer. Structured reports and supervisor orders must be validated against registered teams and repository scope.
- Event-driven local orchestration, persistent queues and execution locks; no fixed normal synchronization timer.
- GitHub events require a supported synchronization mechanism; local extension cannot receive GitHub webhooks directly. Manual synchronization is the fallback.
- Human review before merging; no limit circumvention, automatic extraction of chat outputs, or credentials in prompts.
- Phase 1 is the local foundation. Browser integration, GitHub connector, orchestration, concurrency and production readiness follow.

## Phase 1 ownership

A1 core contracts; A2 parser and persistence; A3 side panel; A4 browser and WXT; A5 tests and security. A0 coordinates integration and accepts completion after evidence is reviewed.
