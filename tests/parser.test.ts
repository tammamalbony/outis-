import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRequirements } from '../src/parser';
import { makeBatch, initialPrompt } from '../src/core';
const head='---\nrepository: owner/project\n---\n';
describe('Markdown parser',()=>{it('ignores headings inside fenced code',()=>{const {features,config}=parseRequirements(head+'# Feature 1\n```md\n# Fake\n```\n# Feature 2\n');expect(features).toHaveLength(2);expect(config.agentsPerTeam).toBe(5);});it('rejects auto merge',()=>expect(()=>parseRequirements('---\nrepository: owner/project\nautoMerge: true\n---\n# Feature 1')).toThrow());it('rejects missing frontmatter',()=>expect(()=>parseRequirements('# Feature 1')).toThrow());});

it('imports the modern UI and chat monitor requirements file',()=>{
  const source=readFileSync(new URL('../docs/CHAT-MONITOR-REQUIREMENTS.md',import.meta.url),'utf8');
  const parsed=parseRequirements(source);
  expect(parsed.config.repository).toBe('tammamalbony/agentsync');
  expect(parsed.config.baseBranch).toBe('develop');
  expect(parsed.features).toHaveLength(1);
  expect(parsed.features[0].title).toBe('Feature 001 — Modern UI and ongoing chat monitor');
  expect(parsed.features[0].markdown).toContain('every 10 seconds by default');
});

it('imports six uniquely named startup prompts from the A0 bridge task file',()=>{
  const source=readFileSync(new URL('../docs/AGENTSYNC-A0-BRIDGE-REQUIREMENTS.md',import.meta.url),'utf8');
  const parsed=parseRequirements(source);
  expect(parsed.features).toHaveLength(1);
  expect(parsed.features[0].chatStarts?.map(start=>start.agentNumber)).toEqual([0,1,2,3,4,5]);
  expect(new Set(parsed.features[0].chatStarts?.map(start=>start.chatName)).size).toBe(6);
  expect(parsed.features[0].markdown).not.toContain('You are A0, supervisor for Feature 002.');
  const batch=makeBatch('bridge.md',parsed.config,parsed.features);
  expect(batch.agents.map(agent=>agent.chatName)).toEqual(parsed.features[0].chatStarts?.map(start=>start.chatName));
  expect(initialPrompt(batch.teams[0],batch.agents[0])).toContain('You are A0, supervisor for Feature 002.');
  expect(initialPrompt(batch.teams[0],batch.agents[5])).toContain('You are A5, QA & Security Engineer for Feature 002.');
});

it('rejects incomplete, duplicate, or malformed chat starts',()=>{
  const file=readFileSync(new URL('../docs/AGENTSYNC-A0-BRIDGE-REQUIREMENTS.md',import.meta.url),'utf8');
  expect(()=>parseRequirements(file.replace(/### A5 — QA & Security Engineer[\s\S]*/,''))).toThrow(/exactly one prompt/);
  expect(()=>parseRequirements(file.replace('a0-chat-bridge-a1-architect','a0-chat-bridge-a0-supervisor'))).toThrow(/unique within a feature/);
  expect(()=>parseRequirements(file.replace('**Chat name:** `a0-chat-bridge-a0-supervisor`','**Chat name:** `bad/name`'))).toThrow(/valid unique Chat name/);
});
