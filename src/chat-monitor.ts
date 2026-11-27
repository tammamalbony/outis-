import type { Agent, AgentBridgeObservation, Order, Team } from './core.ts';
import { executionPhase, type ExecutionPhase } from './execution.ts';
import { matchesConversation, type TabSnapshot } from './conversation-tabs.ts';

export const CHAT_STATUS_POLL_MS = 5_000;
export const CHAT_OBSERVATION_MAX_AGE_MS = CHAT_STATUS_POLL_MS * 3;
export type ChatPresence = 'ACTIVE' | 'OPEN' | 'CLOSED' | 'UNKNOWN';
export type ChatGPTStatus = 'GENERATING' | 'IDLE' | 'UNKNOWN';

export type ChatMonitorEntry = {
  agent: Agent;
  team?: Team;
  order?: Order;
  phase?: ExecutionPhase;
  presence: ChatPresence;
  chatStatus: ChatGPTStatus;
  chatObservedAt?: string;
};

export function chatPresence(chatUrl: string | undefined, tabs: readonly TabSnapshot[] | null): ChatPresence {
  if (!chatUrl || tabs === null) return 'UNKNOWN';
  const matches = tabs.filter(tab => matchesConversation(tab, chatUrl));
  if (matches.some(tab => tab.active)) return 'ACTIVE';
  return matches.length ? 'OPEN' : 'CLOSED';
}

function latestOrder(agent: Agent, orders: Order[]): Order | undefined {
  return orders
    .filter(order => order.agentId === agent.id && order.teamId === agent.teamId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function buildChatMonitorEntries(
  agents: Agent[],
  teams: Team[],
  orders: Order[],
  tabs: readonly TabSnapshot[] | null,
  observations: readonly AgentBridgeObservation[] = [],
  now = Date.now(),
): ChatMonitorEntry[] {
  const teamsById = new Map(teams.map(team => [team.id, team]));
  const observationsByAgent = new Map(observations.map(observation => [observation.agentId, observation]));
  return agents
    .filter(agent => Boolean(agent.chatUrl))
    .map(agent => {
      const order = latestOrder(agent, orders);
      const observation = observationsByAgent.get(agent.id);
      const observedAt = observation ? Date.parse(observation.observedAt) : NaN;
      const fresh = Number.isFinite(observedAt) && observedAt <= now && now - observedAt <= CHAT_OBSERVATION_MAX_AGE_MS;
      return {
        agent,
        team: teamsById.get(agent.teamId),
        order,
        phase: order ? executionPhase(order, agent) : undefined,
        presence: chatPresence(agent.chatUrl, tabs),
        chatStatus: fresh && observation ? observation.state : 'UNKNOWN',
        chatObservedAt: fresh ? observation?.observedAt : undefined,
      };
    })
    .sort((a, b) => (a.team?.title ?? '').localeCompare(b.team?.title ?? '') || a.agent.number - b.agent.number);
}
