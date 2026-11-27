# Release gate — AgentSync 0.1.0

Status: draft / not release-ready. Do not merge or publish an extension package until the verification gates below are satisfied.

## Reproducible verification

- [x] Node 22.17 and pnpm 10 dependencies installed; lockfile available for frozen installs.
- [x] Run `pnpm verify`: 58 standalone tests, 6 parser tests, 6 fake-indexeddb integration scenarios, full typecheck, WXT build and manifest audit passed locally.
- [x] Confirm the produced manifest requests sidePanel, scripting, and activeTab; clipboardWrite and GitHub/ChatGPT host access remain optional.
- [x] Run `pnpm zip` after the full build and inspect `.output/agentsync-0.1.0-chrome.zip` (about 257 kB). Record the final artifact's SHA-256 alongside its release or PR record; ZIP metadata can make checksums differ across packaging runs.

## Chrome smoke test

- [ ] Load .output/chrome-mv3 in a clean Chrome profile.
- [ ] With six disposable registered chats, test bridge enablement, worker JSON-array reports, A0 JSON-array dispatch, strict continuation routing and uncertain-send handling against the current ChatGPT UI.
- [ ] Import two example features and confirm twelve distinct agent records.
- [ ] Register normal ChatGPT conversations, grant optional URL access, confirm tab reuse, and test permission denial.
- [ ] Approve a five-agent plan, confirm prerequisite blocking, manually submit prompts and import reports.
- [ ] Restart Chrome after handoff preparation; reconcile the uncertain order without resubmission.
- [ ] Exercise pause/resume, clipboard failures, inbox delivery, local finalization and duplicate protocol imports.
- [ ] Use a disposable private GitHub repository and restricted token to test provisioning, synchronization, publication, and approved closure. Never use production issues as test fixtures.
- [ ] Confirm the token is not persisted, sent to ChatGPT, or included in logs or exports.

## Local verification instead of GitHub Actions

GitHub Actions is unavailable for the repository owner's account. Automatic PR-triggered workflows are disabled in the feature branch; an optional manual workflow is retained, but is not required for the development process. Run pnpm verify locally and review .verification/report.json and the step logs. The report records the tested commit, clean-worktree flags, step results and manifest permission audit. A passing report with commitEvidence=true is local evidence, not a GitHub check or independently attested CI result. Do not fabricate statuses or bypass required repository checks; if branch rules require unavailable checks, resolve them through authorized repository administration. Review the logs for sensitive content before sharing. The automated GitHub issue-closure gate still requires actual successful observed checks, so use manual review/closure on repositories without checks.

## Product boundaries

Prompt submission is manual by default. The optional A0 bridge can read visible state and submit a validated continuation only for registered chats after explicit enablement. ChatGPT DOM behavior still needs live smoke verification. No usage-limit detection or account-limit circumvention. No automatic merge. Mocked GitHub and IndexedDB tests are not live browser verification. This checklist is not a claim of release readiness.

## Manifest regression gate

The production manifest audit allows `scripting` and `activeTab`, optional `clipboardWrite`, and optional ChatGPT/GitHub host access, while rejecting static content scripts, external connections, web-accessible resources, extra extension entrypoints and unexpected permissions. The latest generated production manifest passed the audit. This is a scoped static check, not a complete security audit.
