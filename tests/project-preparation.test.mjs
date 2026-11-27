import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGitHubRepository,buildSkillCreationPrompt,buildTaskFileSetupPrompt,buildRepositorySetupPrompt,buildA0SkillPrompt,buildAgentSkillsPrompt,buildAgentSyncCheckPrompt} from '../src/project-preparation.ts';

test('normalizes common GitHub repository links to the importer owner/repository form',()=>{
  assert.equal(normalizeGitHubRepository(' https://github.com/owner/repository.git/ '),'owner/repository');
  assert.equal(normalizeGitHubRepository('owner/repository'),'owner/repository');
});

test('rejects non-GitHub URLs, credentials, extra path segments and empty input',()=>{
  for(const value of ['', 'https://github.com.evil.test/owner/repo', 'http://github.com/owner/repo', 'https://user:pass@github.com/owner/repo', 'https://github.com/owner/repo/tree/main', 'owner'])assert.throws(()=>normalizeGitHubRepository(value));
});

test('skill creation prompt specifies the strict AgentSync file contract and blocker handling',()=>{
  const prompt=buildSkillCreationPrompt('https://github.com/owner/repo','Build a shared dashboard.');
  assert.match(prompt,/agentsync-repository-intake/);
  assert.match(prompt,/repository: owner\/repository/);
  assert.match(prompt,/A0 — Supervisor through ### A5 — QA & Security Engineer/);
  assert.match(prompt,/one finite batch/);
  assert.match(prompt,/written Recommended option/);
  assert.match(prompt,/Build a shared dashboard\./);
  assert.match(prompt,/five developer issues/);
});

test('task setup prompt asks for repository inspection and a ready-to-import file without inventing GitHub resources',()=>{
  const prompt=buildTaskFileSetupPrompt('owner/repo');
  assert.match(prompt,/https:\/\/github.com\/owner\/repo/);
  assert.match(prompt,/current instructions, task\/handoff documents/);
  assert.match(prompt,/exactly these six role headings/);
  assert.match(prompt,/Do not invent issue\/PR numbers or links/);
  assert.match(prompt,/create the draft PR after the feature branch contains a commit/);
});

test('prompts ask for a bounded batch when user work is not supplied',()=>{
  const prompt=buildTaskFileSetupPrompt('owner/repo');
  assert.match(prompt,/one finite batch of necessary questions/);
  assert.match(prompt,/open-ended question chain/);
});
test('four Settings prompts cover repository setup, A0, agents and read-only initialization check',()=>{
  const setup=buildRepositorySetupPrompt('owner/repo');
  const a0=buildA0SkillPrompt('owner/repo');
  const agents=buildAgentSkillsPrompt('owner/repo');
  const check=buildAgentSyncCheckPrompt('owner/repo');
  assert.match(setup,/draft pull request/);
  assert.match(a0,/only one complete valid JSON array/);
  assert.match(agents,/agentsync-a5-qa-security-engineer/);
  assert.match(agents,/exactly one AGENT_STATUS object/);
  assert.match(check,/Read-only check/);
  assert.match(check,/initialized \(boolean or null\)/);
});
