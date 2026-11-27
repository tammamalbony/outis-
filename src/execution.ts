import type { Agent, Batch, Order, Team } from './core';
import { assertOrderIdentity } from './scheduler.ts';

export type ExecutionPhase = 'QUEUED' | 'HANDOFF_UNCERTAIN' | 'RUNNING_REPORTED' | 'STOPPED_REPORTED' | 'CONFIRMED_LEGACY' | 'CANCELLED';
export function executionPhase(order:Order,agent?:Agent):ExecutionPhase {
  if(order.state==='CANCELLED')return 'CANCELLED';
  if(order.state==='PENDING')return order.handoffAt?'HANDOFF_UNCERTAIN':'QUEUED';
  if(order.stoppedAt)return 'STOPPED_REPORTED';
  if(agent?.id===order.agentId&&agent.teamId===order.teamId&&agent.lastOrderId===order.id&&agent.state==='WORKING')return 'RUNNING_REPORTED';
  return 'CONFIRMED_LEGACY';
}
export function assertHandoffAvailable(order:Order,agent:Agent,team:Team,batch:Batch):void {
  assertOrderIdentity(order,agent,team);
  if(team.batchId!==batch.id)throw new Error('Team/batch mismatch.');
  if(batch.paused)throw new Error('Batch is paused.');
  if(order.handoffAt)throw new Error('Handoff already prepared. Inspect the saved chat and confirm sent or cancel only if definitely unsent.');
}
export function stoppedExecution(order:Order|undefined,agent:Agent):boolean {
  return Boolean(order&&order.id===agent.lastOrderId&&order.agentId===agent.id&&order.teamId===agent.teamId&&order.state==='CONFIRMED'&&!order.stoppedAt);
}
