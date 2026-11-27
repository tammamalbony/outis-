import type { Agent, Batch, Order, Team } from './core';

// A reservation begins when an order enters the local queue, not when the
// human confirms it. This keeps two feature teams from both acquiring a slot.
export function activeTeamIds(teams: Team[], agents: Agent[], orders: Order[]): Set<string> {
  const valid = new Set(teams.map(t => t.id));
  return new Set([
    ...agents.filter(a => a.state === 'WORKING').map(a => a.teamId),
    ...orders.filter(o => o.state === 'PENDING').map(o => o.teamId),
  ].filter(id => valid.has(id)));
}

export function assertTeamCapacity(batch: Batch, target: Team, teams: Team[], agents: Agent[], orders: Order[]): void {
  if (target.batchId !== batch.id || !teams.some(t => t.id === target.id && t.batchId === batch.id)) throw new Error('Team/batch mismatch.');
  if (batch.paused) throw new Error('Batch is paused.');
  const active = activeTeamIds(teams.filter(t => t.batchId === batch.id), agents, orders);
  if (!active.has(target.id) && active.size >= batch.config.maxConcurrentTeams) throw new Error('Concurrent team limit reached. Finish or cancel a pending order in an active team first.');
}

export function assertOrderIdentity(order: Order, agent: Agent, team: Team): void {
  if (order.agentId !== agent.id || order.teamId !== agent.teamId || order.teamId !== team.id) throw new Error('Order identity mismatch.');
  if (order.state !== 'PENDING') throw new Error('Order is not pending.');
  if (!agent.chatUrl || !['READY', 'STOPPED', 'BLOCKED'].includes(agent.state)) throw new Error('Agent is not available.');
}
