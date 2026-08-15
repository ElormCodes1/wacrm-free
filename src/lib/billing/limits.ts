/**
 * Whether a company has outgrown what its plan says it includes.
 *
 * Advisory, everywhere. Nothing in the app blocks a number being paired
 * or a member being invited because of this — a hard gate fires exactly
 * when a customer is trying to expand, which turns a sales conversation
 * into an error message. The point of computing it is that somebody can
 * see it and have the conversation.
 *
 * NULL means unlimited, not zero. A plan with no ceiling can never be
 * over it.
 */

export interface PlanUsage {
  numbers: number;
  members: number;
  maxNumbers: number | null;
  maxMembers: number | null;
  /** Null when the company is not on a plan at all — nothing to compare. */
  planName: string | null;
}

export interface LimitBreach {
  kind: 'numbers' | 'members';
  used: number;
  allowed: number;
  /** Ready to show: "4 numbers on a plan that includes 1". */
  text: string;
}

export function planBreaches(usage: PlanUsage): LimitBreach[] {
  // No plan means no promise to exceed. Those companies are already
  // reported separately as "not on a plan".
  if (!usage.planName) return [];

  const out: LimitBreach[] = [];

  if (usage.maxNumbers !== null && usage.numbers > usage.maxNumbers) {
    out.push({
      kind: 'numbers',
      used: usage.numbers,
      allowed: usage.maxNumbers,
      text: `${usage.numbers} WhatsApp ${usage.numbers === 1 ? 'number' : 'numbers'} on a plan that includes ${usage.maxNumbers}`,
    });
  }

  if (usage.maxMembers !== null && usage.members > usage.maxMembers) {
    out.push({
      kind: 'members',
      used: usage.members,
      allowed: usage.maxMembers,
      text: `${usage.members} team ${usage.members === 1 ? 'member' : 'members'} on a plan that includes ${usage.maxMembers}`,
    });
  }

  return out;
}
