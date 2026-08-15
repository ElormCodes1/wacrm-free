import 'server-only';

import { privilegedClient } from '@/lib/supabase/privileged';

/**
 * Billing, from the operator side.
 *
 * Reads go through the SQL functions in 071 so the console asks one
 * question per page rather than assembling an answer from a dozen
 * requests. Writes are here rather than scattered through route handlers
 * because "what can change about a customer's billing" should be a list
 * you can read in one sitting.
 *
 * Nothing here checks that the caller is an operator — the routes do that
 * before calling in, and repeating it would imply these are reachable
 * without it.
 */

export type BillingState =
  | 'unbilled'
  | 'no_period'
  | 'trialing'
  | 'current'
  | 'due_soon'
  | 'overdue'
  | 'canceled';

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  highlight: boolean;
  /** Advisory ceilings. Null = unlimited. */
  maxNumbers: number | null;
  maxMembers: number | null;
  amountMinor: number;
  currency: string;
  interval: 'month' | 'year';
  isActive: boolean;
  /** How many companies are on it — a plan in use must not be deleted. */
  subscribers?: number;
}

export interface MoneyByCurrency {
  currency: string;
  amountMinor: number;
  companies?: number;
}

export interface BillingOverview {
  /** Per currency, never summed: there is no exchange rate in this system. */
  mrr: MoneyByCurrency[];
  collected30d: MoneyByCurrency[];
  overdue: number;
  dueSoon: number;
  trialing: number;
  unbilled: number;
  canceled: number;
}

export interface Payment {
  id: string;
  amountMinor: number;
  currency: string;
  paidAt: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  recordedByName: string | null;
  provider: string | null;
}

export interface CompanyBilling {
  planId: string | null;
  planName: string | null;
  planInterval: 'month' | 'year' | null;
  status: 'trialing' | 'active' | 'canceled' | null;
  state: BillingState;
  amountMinor: number | null;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  trialEndsAt: string | null;
  notes: string | null;
  maxNumbers: number | null;
  maxMembers: number | null;
  maxStorageMb: number | null;
  maxBroadcastSends30d: number | null;
  allowApi: boolean;
  payments: Payment[];
  paidTotal: MoneyByCurrency[];
}

// ---------------------------------------------------------------- reads

export async function listPlans(includeRetired = false): Promise<Plan[]> {
  const db = privilegedClient('operator');
  let q = db
    .from('billing_plans')
    .select('id, name, description, amount_minor, currency, interval, is_active, highlight, max_numbers, max_members')
    .order('amount_minor', { ascending: true });
  if (!includeRetired) q = q.eq('is_active', true);

  const { data } = await q;
  const rows = (data ?? []) as Record<string, unknown>[];

  // One extra query for all of them rather than one per plan.
  const { data: subs } = await db.from('account_billing').select('plan_id');
  const counts = new Map<string, number>();
  for (const s of (subs ?? []) as Record<string, unknown>[]) {
    const id = s.plan_id as string | null;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    highlight: r.highlight === true,
    maxNumbers: r.max_numbers === null || r.max_numbers === undefined ? null : Number(r.max_numbers),
    maxMembers: r.max_members === null || r.max_members === undefined ? null : Number(r.max_members),
    amountMinor: Number(r.amount_minor ?? 0),
    currency: r.currency as string,
    interval: (r.interval as 'month' | 'year') ?? 'month',
    isActive: r.is_active !== false,
    subscribers: counts.get(r.id as string) ?? 0,
  }));
}

export async function billingOverview(): Promise<BillingOverview> {
  const db = privilegedClient('operator');
  const { data } = await db.rpc('operator_billing_overview');
  const d = (data ?? {}) as Record<string, unknown>;

  const money = (key: string): MoneyByCurrency[] =>
    ((d[key] ?? []) as Record<string, unknown>[]).map((m) => ({
      currency: m.currency as string,
      amountMinor: Number(m.amount_minor ?? 0),
      companies: m.companies === undefined ? undefined : Number(m.companies),
    }));

  return {
    mrr: money('mrr'),
    collected30d: money('collected_30d'),
    overdue: Number(d.overdue ?? 0),
    dueSoon: Number(d.due_soon ?? 0),
    trialing: Number(d.trialing ?? 0),
    unbilled: Number(d.unbilled ?? 0),
    canceled: Number(d.canceled ?? 0),
  };
}

export async function getCompanyBilling(accountId: string): Promise<CompanyBilling> {
  const db = privilegedClient('operator');
  const { data } = await db.rpc('operator_company_billing', { target: accountId });
  const d = (data ?? {}) as Record<string, unknown>;
  const b = (d.billing ?? null) as Record<string, unknown> | null;

  return {
    planId: (b?.plan_id as string) ?? null,
    planName: (b?.plan_name as string) ?? null,
    planInterval: (b?.plan_interval as 'month' | 'year') ?? null,
    status: (b?.status as 'trialing' | 'active' | 'canceled') ?? null,
    state: ((b?.state as BillingState) ?? 'unbilled') as BillingState,
    amountMinor: b?.amount_minor === undefined || b?.amount_minor === null
      ? null
      : Number(b.amount_minor),
    currency: (b?.currency as string) ?? null,
    periodStart: (b?.period_start as string) ?? null,
    periodEnd: (b?.period_end as string) ?? null,
    trialEndsAt: (b?.trial_ends_at as string) ?? null,
    notes: (b?.notes as string) ?? null,
    maxNumbers:
      b?.max_numbers === undefined || b?.max_numbers === null ? null : Number(b.max_numbers),
    maxMembers:
      b?.max_members === undefined || b?.max_members === null ? null : Number(b.max_members),
    maxStorageMb:
      b?.max_storage_mb === undefined || b?.max_storage_mb === null
        ? null
        : Number(b.max_storage_mb),
    maxBroadcastSends30d:
      b?.max_broadcast_sends_30d === undefined || b?.max_broadcast_sends_30d === null
        ? null
        : Number(b.max_broadcast_sends_30d),
    allowApi: b?.allow_api !== false,
    payments: ((d.payments ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      amountMinor: Number(p.amount_minor ?? 0),
      currency: p.currency as string,
      paidAt: p.paid_at as string,
      method: (p.method as string) ?? null,
      reference: (p.reference as string) ?? null,
      note: (p.note as string) ?? null,
      recordedByName: (p.recorded_by_name as string) ?? null,
      provider: (p.provider as string) ?? null,
    })),
    paidTotal: ((d.paid_total ?? []) as Record<string, unknown>[]).map((m) => ({
      currency: m.currency as string,
      amountMinor: Number(m.amount_minor ?? 0),
    })),
  };
}

// ---------------------------------------------------------------- writes

export async function createPlan(input: {
  name: string;
  amountMinor: number;
  currency: string;
  interval: 'month' | 'year';
  description?: string | null;
  maxNumbers?: number | null;
  maxMembers?: number | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = privilegedClient('operator');
  const { data, error } = await db
    .from('billing_plans')
    .insert({
      name: input.name.trim(),
      amount_minor: input.amountMinor,
      currency: input.currency,
      interval: input.interval,
      description: input.description ?? null,
      max_numbers: input.maxNumbers ?? null,
      max_members: input.maxMembers ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // 23505 is the unique index on lower(name).
    if (error.code === '23505') return { ok: false, error: 'A plan with that name already exists' };
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data!.id as string };
}

/**
 * Retire or restore a plan.
 *
 * Never a delete. Companies already on a plan keep pointing at it, and
 * their history has to keep meaning what it meant — a retired plan simply
 * stops being offered.
 */
export async function setPlanActive(id: string, isActive: boolean): Promise<void> {
  const db = privilegedClient('operator');
  await db.from('billing_plans').update({ is_active: isActive }).eq('id', id);
}

/**
 * Edit the words, never the price.
 *
 * Description and highlight describe the offer rather than constituting
 * it, so they are safe to change under an existing customer. Amount and
 * currency are deliberately not accepted here.
 */
export async function updatePlanPresentation(
  id: string,
  input: {
    description?: string | null;
    highlight?: boolean;
    maxNumbers?: number | null;
    maxMembers?: number | null;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = privilegedClient('operator');

  // Only one plan may be highlighted; clear the others first rather than
  // letting the unique index reject the write.
  if (input.highlight === true) {
    await db.from('billing_plans').update({ highlight: false }).eq('highlight', true);
  }

  const patch: Record<string, unknown> = {};
  if (input.description !== undefined) patch.description = input.description;
  if (input.highlight !== undefined) patch.highlight = input.highlight;
  // Ceilings are advisory, so adjusting them changes nothing a customer
  // can already do — safe to edit in place alongside the wording.
  if (input.maxNumbers !== undefined) patch.max_numbers = input.maxNumbers;
  if (input.maxMembers !== undefined) patch.max_members = input.maxMembers;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await db.from('billing_plans').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface BillingUpdate {
  planId?: string | null;
  status?: 'trialing' | 'active' | 'canceled';
  amountMinor?: number | null;
  currency?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  trialEndsAt?: string | null;
  notes?: string | null;
}

/** Create or update what a company is on. */
export async function setCompanyBilling(
  accountId: string,
  update: BillingUpdate
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = privilegedClient('operator');

  const row: Record<string, unknown> = { account_id: accountId };
  if (update.planId !== undefined) row.plan_id = update.planId;
  if (update.status !== undefined) row.status = update.status;
  if (update.amountMinor !== undefined) row.amount_minor = update.amountMinor;
  if (update.currency !== undefined) row.currency = update.currency;
  if (update.periodStart !== undefined) row.period_start = update.periodStart;
  if (update.periodEnd !== undefined) row.period_end = update.periodEnd;
  if (update.trialEndsAt !== undefined) row.trial_ends_at = update.trialEndsAt;
  if (update.notes !== undefined) row.notes = update.notes;

  const { error } = await db.from('account_billing').upsert(row, { onConflict: 'account_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Advance the paid-up-to date by one billing interval.
 *
 * From the CURRENT period end when that is still in the future, so paying
 * early does not cost the customer the remainder of the month they
 * already bought. From today when it is in the past, because a customer
 * three months late who pays for one month is paid up for one month from
 * now — not retroactively covered for arrears they have not settled.
 */
export function nextPeriodEnd(
  currentEnd: string | null,
  interval: 'month' | 'year',
  now = new Date()
): string {
  const base = currentEnd && new Date(currentEnd) > now ? new Date(currentEnd) : new Date(now);
  const next = new Date(base);
  if (interval === 'year') next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next.toISOString();
}

export async function recordPayment(input: {
  accountId: string;
  amountMinor: number;
  currency: string;
  paidAt?: string;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  recordedBy: string;
  recordedByName: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = privilegedClient('operator');
  const { data, error } = await db
    .from('billing_payments')
    .insert({
      account_id: input.accountId,
      amount_minor: input.amountMinor,
      currency: input.currency,
      paid_at: input.paidAt ?? new Date().toISOString(),
      method: input.method ?? null,
      reference: input.reference ?? null,
      note: input.note ?? null,
      recorded_by: input.recordedBy,
      recorded_by_name: input.recordedByName,
    })
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data!.id as string };
}


// ---------------------------------------------------------------- upgrades

export interface UpgradeRequest {
  id: string;
  accountId: string;
  companyName: string;
  companySlug: string | null;
  reason: string | null;
  requestedByName: string | null;
  createdAt: string;
}

/**
 * Customers who have asked to move up.
 *
 * The other half of the upgrade prompt. Without this the button records a
 * row nobody reads, which is worse than no button — the customer believes
 * they have started a conversation that never began.
 */
export async function listUpgradeRequests(): Promise<UpgradeRequest[]> {
  const db = privilegedClient('operator');
  const { data } = await db
    .from('upgrade_requests')
    .select('id, account_id, reason, requested_by_name, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: true });

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.account_id as string))];
  const { data: accounts } = await db.from('accounts').select('id, name, slug').in('id', ids);
  const byId = new Map<string, { name: string; slug: string | null }>();
  for (const a of (accounts ?? []) as Record<string, unknown>[]) {
    byId.set(a.id as string, { name: a.name as string, slug: (a.slug as string) ?? null });
  }

  return rows.map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    companyName: byId.get(r.account_id as string)?.name ?? '(unknown)',
    companySlug: byId.get(r.account_id as string)?.slug ?? null,
    reason: (r.reason as string) ?? null,
    requestedByName: (r.requested_by_name as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** Close a request once it has been dealt with, either way. */
export async function resolveUpgradeRequest(
  id: string,
  status: 'done' | 'declined'
): Promise<void> {
  const db = privilegedClient('operator');
  await db
    .from('upgrade_requests')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', id);
}
