import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";

type PersonaGroup = { persona: AgentPersona; agents: ManagedAgent[] };

export function buildUnifiedGroups(
  personas: AgentPersona[],
  agents: ManagedAgent[],
) {
  const byPersonaId = new Map<string, ManagedAgent[]>();
  const ungrouped: ManagedAgent[] = [];

  for (const agent of agents) {
    if (!agent.personaId) {
      ungrouped.push(agent);
    } else {
      const list = byPersonaId.get(agent.personaId) ?? [];
      list.push(agent);
      byPersonaId.set(agent.personaId, list);
    }
  }

  const matched = new Set<string>();
  const groups: PersonaGroup[] = personas.map((persona) => {
    matched.add(persona.id);
    return { persona, agents: byPersonaId.get(persona.id) ?? [] };
  });

  const unknown: ManagedAgent[] = [];
  for (const [id, list] of byPersonaId) {
    if (!matched.has(id)) unknown.push(...list);
  }

  return { groups, ungrouped, unknown };
}

export function pickProfileAgent(
  agents: ManagedAgent[],
  personaDisplayName?: string,
) {
  const placeholderName = personaDisplayName?.trim().toLocaleLowerCase();
  return [...agents].sort((left, right) => {
    const activeDiff =
      Number(isManagedAgentActive(right)) - Number(isManagedAgentActive(left));
    if (activeDiff !== 0) return activeDiff;

    // A persona can have both its starter placeholder (for example Bumble)
    // and a real configured runtime (for example Maria). Prefer the configured
    // identity so the unified card does not hide the agent operators recognise.
    if (placeholderName) {
      const leftIsPlaceholder =
        left.name.trim().toLocaleLowerCase() === placeholderName;
      const rightIsPlaceholder =
        right.name.trim().toLocaleLowerCase() === placeholderName;
      const placeholderDiff =
        Number(leftIsPlaceholder) - Number(rightIsPlaceholder);
      if (placeholderDiff !== 0) return placeholderDiff;
    }

    return left.name.localeCompare(right.name);
  })[0];
}
