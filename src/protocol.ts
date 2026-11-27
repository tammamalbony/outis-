import type { Agent, Team } from './core';
import {normalizeCopiedJson} from './json-cleanup.ts';
export type Dependency = { agentId: number; artifact: string; status: 'MISSING' | 'AVAILABLE' };
export type AgentStatus = { type: 'AGENT_STATUS'; messageId: string; teamId: string; agentId: number; executionId: string; status: 'BLOCKED' | 'IN_PROGRESS' | 'READY_FOR_REVIEW'; completed: string[]; remaining: string[]; dependencies: Dependency[] };
export type DispatchOrder = { type: 'DISPATCH_ORDER'; orderId: string; teamId: string; sourceAgentId: 0; targetAgentId: number; action: 'RESUME' | 'ACCEPT'; prompt: string; expectedResult: string; targetExecutionId?: string; targetReportId?: string };
export type ProtocolMessage = AgentStatus | DispatchOrder;
export type StoredMessage = { id: string; teamId: string; message: ProtocolMessage; createdAt: string };
export type Notification = { id: string; teamId: string; agentId: number; type: 'AGENT_STOPPED' | 'AGENT_STATUS'; detail: string; createdAt: string; state: 'PENDING' | 'ACKNOWLEDGED' };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}
function str(value: unknown, name: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid ' + name + '.');
  return value.trim();
}
function agentId(value: unknown, min = 1): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 5) throw new Error('Invalid agent ID.');
  return value;
}
function list(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid ' + name + '.');
  return value.map(v => str(v, name));
}
function token(value: unknown): string {
  const s = str(value, 'message identifier', 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new Error('Invalid message identifier.');
  return s;
}
export function parseMessage(raw: string): ProtocolMessage {
  if (raw.length > 100000) throw new Error('Message exceeds size limit.');
  const v = object(JSON.parse(raw));
  const teamId = token(v.teamId);
  if (v.type === 'AGENT_STATUS') {
    const source = agentId(v.agentId);
    const status = v.status;
    if (status !== 'BLOCKED' && status !== 'IN_PROGRESS' && status !== 'READY_FOR_REVIEW') throw new Error('Invalid report status.');
    if (!Array.isArray(v.dependencies) || v.dependencies.length > 50) throw new Error('Invalid dependencies.');
    const dependencies: Dependency[] = v.dependencies.map(item => {
      const d = object(item); const provider = agentId(d.agentId);
      if (provider === source || (d.status !== 'MISSING' && d.status !== 'AVAILABLE')) throw new Error('Invalid dependency.');
      return {agentId: provider, artifact: str(d.artifact, 'artifact', 500), status: d.status};
    });
    const remaining = list(v.remaining, 'remaining');
    if (status === 'READY_FOR_REVIEW' && (remaining.length || dependencies.some(d => d.status === 'MISSING'))) throw new Error('Review requires no remaining work or missing dependencies.');
    return {type:'AGENT_STATUS', messageId:token(v.messageId), teamId, agentId:source, executionId:token(v.executionId), status, completed:list(v.completed,'completed'), remaining, dependencies};
  }
  if (v.type === 'DISPATCH_ORDER') {
    if (v.sourceAgentId !== 0 || (v.action !== 'RESUME' && v.action !== 'ACCEPT')) throw new Error('Invalid supervisor order.');
    return {type:'DISPATCH_ORDER', orderId:token(v.orderId), teamId, sourceAgentId:0, targetAgentId:agentId(v.targetAgentId), action:v.action, prompt:str(v.prompt,'prompt',20000), expectedResult:str(v.expectedResult,'expectedResult'), ...(v.action==='ACCEPT'?{targetExecutionId:token(v.targetExecutionId),targetReportId:token(v.targetReportId)}:{})};
  }
  throw new Error('Unsupported message type.');
}
export function parseMessageBatch(raw:string):ProtocolMessage[]{
  if(raw.length>100000)throw new Error('Message array exceeds size limit.');
  const value:unknown=JSON.parse(normalizeCopiedJson(raw));
  if(!Array.isArray(value)||value.length>10)throw new Error('Paste one JSON array with no more than ten protocol messages.');
  const messages=value.map(item=>parseMessage(JSON.stringify(item)));
  const keys=messages.map(messageKey);
  if(new Set(keys).size!==keys.length)throw new Error('A JSON array cannot repeat a message identifier.');
  const agents=messages.map(message=>message.type==='AGENT_STATUS'?message.agentId:message.targetAgentId);
  if(new Set(agents).size!==agents.length)throw new Error('A JSON array can include only one status or next action per developer.');
  return messages;
}
export function messageKey(m: ProtocolMessage): string {
  return JSON.stringify([m.teamId,m.type,m.type === 'AGENT_STATUS' ? m.messageId : m.orderId]);
}
export function checkReplay(existing: StoredMessage | undefined, incoming: ProtocolMessage): boolean {
  if (!existing) return false;
  if (JSON.stringify(existing.message) !== JSON.stringify(incoming)) throw new Error('Message ID already used with different content.');
  return true;
}
export function assertSource(m: ProtocolMessage, team: Team, source: Agent): void {
  const n = m.type === 'AGENT_STATUS' ? m.agentId : m.sourceAgentId;
  if (m.teamId !== team.id || source.teamId !== team.id || source.number !== n || !source.chatUrl) throw new Error('Message source or team mismatch.');
}
export function assertReport(m: AgentStatus, agent: Agent): void {
  if (agent.lastOrderId !== m.executionId || agent.lastReportId || !['STOPPED','BLOCKED'].includes(agent.state)) throw new Error('Report must belong to the latest stopped, unreported execution.');
}
export function dependencyCycle(reports: AgentStatus[]): number[] | null {
  const graph = new Map(reports.map(r => [r.agentId, r.dependencies.filter(d => d.status === 'MISSING').map(d => d.agentId)]));
  const visiting: number[] = [], done = new Set<number>();
  function visit(n: number): number[] | null {
    const i = visiting.indexOf(n);
    if (i >= 0) return [...visiting.slice(i),n];
    if (done.has(n)) return null;
    visiting.push(n);
    for (const next of graph.get(n) ?? []) { const cycle = visit(next); if (cycle) return cycle; }
    visiting.pop(); done.add(n); return null;
  }
  for (const n of graph.keys()) { const cycle = visit(n); if (cycle) return cycle; }
  return null;
}
export function assertAcceptance(target: Agent, report: AgentStatus | undefined, hasPending: boolean): void {
  if (!target.chatUrl || target.state !== 'STOPPED' || hasPending || !report || report.agentId !== target.number || report.teamId !== target.teamId || report.executionId !== target.lastOrderId || report.messageId !== target.lastReportId || report.status !== 'READY_FOR_REVIEW') throw new Error('Acceptance requires the latest ready-for-review report and no pending order.');
}
