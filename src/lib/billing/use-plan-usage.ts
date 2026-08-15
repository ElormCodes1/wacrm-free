'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { planBreaches, type LimitBreach } from '@/lib/billing/limits';

/**
 * This company's plan and what it is using, for the customer's own eyes.
 *
 * Reads my_plan_usage(), which takes no argument and resolves the account
 * from the session — so there is nothing here a browser could tamper with
 * to ask about somebody else.
 *
 * Returns null while loading AND when the company is on no plan at all.
 * Those collapse deliberately: in both cases there is no ceiling to be
 * over, so every caller's question ("should I show an upgrade prompt?")
 * has the same answer, and no caller has to remember to handle a third
 * state.
 */
export interface PlanUsage {
  planName: string | null;
  amountMinor: number | null;
  currency: string | null;
  interval: 'month' | 'year' | null;
  allowApi: boolean;
  numbers: number;
  members: number;
  storageBytes: number;
  broadcastSends30d: number;
  maxNumbers: number | null;
  maxMembers: number | null;
  maxStorageMb: number | null;
  maxBroadcastSends30d: number | null;
  breaches: LimitBreach[];
}

export function usePlanUsage(): { usage: PlanUsage | null; loading: boolean } {
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc('my_plan_usage');
        if (cancelled) return;
        if (error || !data) {
          setUsage(null);
          return;
        }

        const d = data as Record<string, unknown>;
        const num = (k: string) => Number(d[k] ?? 0);
        const nullable = (k: string) =>
          d[k] === null || d[k] === undefined ? null : Number(d[k]);

        const built: PlanUsage = {
          planName: (d.plan_name as string) ?? null,
          amountMinor: nullable('amount_minor'),
          currency: (d.currency as string) ?? null,
          interval: (d.interval as 'month' | 'year') ?? null,
          allowApi: d.allow_api !== false,
          numbers: num('numbers'),
          members: num('members'),
          storageBytes: num('storage_bytes'),
          broadcastSends30d: num('broadcast_sends_30d'),
          maxNumbers: nullable('max_numbers'),
          maxMembers: nullable('max_members'),
          maxStorageMb: nullable('max_storage_mb'),
          maxBroadcastSends30d: nullable('max_broadcast_sends_30d'),
          breaches: [],
        };

        built.breaches = planBreaches({
          numbers: built.numbers,
          members: built.members,
          storageBytes: built.storageBytes,
          broadcastSends30d: built.broadcastSends30d,
          maxNumbers: built.maxNumbers,
          maxMembers: built.maxMembers,
          maxStorageMb: built.maxStorageMb,
          maxBroadcastSends30d: built.maxBroadcastSends30d,
          planName: built.planName,
        });

        setUsage(built.planName ? built : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { usage, loading };
}

/**
 * Is this company at or past a specific ceiling?
 *
 * "At" counts, not just "past". The prompt has to appear BEFORE they try
 * to add the thing they cannot have — telling somebody they are over a
 * limit after the fact is a complaint, not an offer.
 */
export function atLimit(
  usage: PlanUsage | null,
  kind: 'numbers' | 'members'
): boolean {
  if (!usage) return false;
  if (kind === 'numbers') {
    return usage.maxNumbers !== null && usage.numbers >= usage.maxNumbers;
  }
  return usage.maxMembers !== null && usage.members >= usage.maxMembers;
}
