import 'server-only';

import { privilegedClient } from '@/lib/supabase/privileged';

/**
 * Reading customer data from the operator plane.
 *
 * Every query here bypasses RLS, which is the whole point — an operator
 * looks across companies and RLS exists to stop exactly that. Keeping the
 * queries in one module rather than scattered through pages means the set
 * of things an operator can see is a list you can read in one sitting,
 * instead of something you'd have to go looking for.
 *
 * Nothing here checks whether the caller IS an operator. That is the
 * layout's job and it runs first; duplicating the check in every function
 * would suggest the pages might be reachable without it, which they are
 * not.
 */

export type CompanyStatus = 'active' | 'suspended';

export interface CompanySummary {
  id: string;
  slug: string | null;
  name: string;
  status: CompanyStatus;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  members: number;
  numbers: number;
  /** How many of this company's numbers are not currently connected. */
  numbersDown: number;
  contacts: number;
  conversations: number;
  lastActivityAt: string | null;
}

export interface CompanyMember {
  email: string | null;
  fullName: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export interface CompanyNumber {
  label: string | null;
  status: string | null;
  connectionState: string | null;
  instanceName: string | null;
  connectedAt: string | null;
}

export interface CompanyDetail extends CompanySummary {
  membersList: CompanyMember[];
  numbersList: CompanyNumber[];
}

/**
 * Every company, newest first, optionally filtered.
 *
 * One SQL call. The previous version fetched the accounts and then ran
 * three counts PER COMPANY, so the console got slower in exact proportion
 * to the business doing well — and it still could not show last activity,
 * which needs an aggregate PostgREST cannot express inline.
 */
export async function listCompanies(query?: string): Promise<CompanySummary[]> {
  const db = privilegedClient('operator');
  const { data } = await db.rpc('operator_company_list', { search: query ?? null });
  const rows = (data ?? []) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    slug: (row.slug as string) ?? null,
    name: row.name as string,
    status: row.status as CompanyStatus,
    createdAt: row.created_at as string,
    suspendedAt: (row.suspended_at as string) ?? null,
    suspendedReason: (row.suspended_reason as string) ?? null,
    members: Number(row.members ?? 0),
    numbers: Number(row.numbers ?? 0),
    numbersDown: Number(row.numbers_down ?? 0),
    contacts: Number(row.contacts ?? 0),
    conversations: Number(row.conversations ?? 0),
    lastActivityAt: (row.last_activity_at as string) ?? null,
  }));
}

/** Count rows for one account without fetching them. */
async function countFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  table: string,
  accountId: string
): Promise<number> {
  const { count } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  return count ?? 0;
}

/** One company in full, or null if the address names nothing. */
export async function getCompanyDetail(slug: string): Promise<CompanyDetail | null> {
  const db = privilegedClient('operator');

  const { data: account } = await db
    .from('accounts')
    .select('id, slug, name, status, created_at, suspended_at, suspended_reason')
    .eq('slug', slug)
    .maybeSingle();
  if (!account) return null;

  const id = account.id as string;

  const [membersRes, numbersRes, contacts, conversations, lastMessage] = await Promise.all([
    db
      .from('profiles')
      .select('email, full_name, account_role, is_active, created_at')
      .eq('account_id', id)
      .order('created_at', { ascending: true }),
    db
      .from('whatsapp_config')
      .select('label, status, connection_state, instance_name, connected_at')
      .eq('account_id', id)
      .order('created_at', { ascending: true }),
    countFor(db, 'contacts', id),
    countFor(db, 'conversations', id),
    db
      .from('conversations')
      .select('last_message_at')
      .eq('account_id', id)
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const members = (membersRes.data ?? []) as Record<string, unknown>[];
  const numbers = (numbersRes.data ?? []) as Record<string, unknown>[];

  return {
    id,
    slug: (account.slug as string) ?? null,
    name: account.name as string,
    status: account.status as CompanyStatus,
    createdAt: account.created_at as string,
    suspendedAt: (account.suspended_at as string) ?? null,
    suspendedReason: (account.suspended_reason as string) ?? null,
    members: members.length,
    numbers: numbers.length,
    numbersDown: numbers.filter((n) => n.connection_state !== 'open').length,
    contacts,
    conversations,
    lastActivityAt: (lastMessage.data?.last_message_at as string) ?? null,
    membersList: members.map((m) => ({
      email: (m.email as string) ?? null,
      fullName: (m.full_name as string) ?? null,
      role: (m.account_role as string) ?? 'viewer',
      isActive: m.is_active !== false,
      createdAt: m.created_at as string,
    })),
    numbersList: numbers.map((n) => ({
      label: (n.label as string) ?? null,
      status: (n.status as string) ?? null,
      connectionState: (n.connection_state as string) ?? null,
      instanceName: (n.instance_name as string) ?? null,
      connectedAt: (n.connected_at as string) ?? null,
    })),
  };
}

export interface AuditEntry {
  id: string;
  operatorName: string | null;
  action: string;
  targetAccountId: string | null;
  targetCompany: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  occurredAt: string;
}

/**
 * The operator trail.
 *
 * Written on every operator action already; this is the first thing that
 * reads it. A record nobody can look at deters nobody, so the console
 * showing it is what turns it from a table into an accountability
 * measure.
 */
export async function listOperatorAudit(limit = 200): Promise<AuditEntry[]> {
  const db = privilegedClient('operator');

  const { data } = await db
    .from('operator_audit')
    .select('id, operator_name, action, target_account_id, detail, ip, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Record<string, unknown>[];

  // Resolve company names in one query rather than one per row.
  const ids = [...new Set(rows.map((r) => r.target_account_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: accounts } = await db.from('accounts').select('id, name').in('id', ids);
    for (const a of (accounts ?? []) as Record<string, unknown>[]) {
      names.set(a.id as string, a.name as string);
    }
  }

  return rows.map((r) => ({
    id: r.id as string,
    operatorName: (r.operator_name as string) ?? null,
    action: r.action as string,
    targetAccountId: (r.target_account_id as string) ?? null,
    // A deleted company keeps its audit rows (target_account_id is SET
    // NULL), so an unresolvable id is expected rather than an error.
    targetCompany: r.target_account_id
      ? (names.get(r.target_account_id as string) ?? '(deleted company)')
      : null,
    detail: (r.detail as Record<string, unknown>) ?? null,
    ip: (r.ip as string) ?? null,
    occurredAt: r.occurred_at as string,
  }));
}

// ---------------------------------------------------------------- platform

export interface PlatformOverview {
  companiesTotal: number;
  companiesActive: number;
  companiesSuspended: number;
  companiesDormant: number;
  signups7d: number;
  signups30d: number;
  numbersTotal: number;
  numbersConnected: number;
  numbersDown: number;
  contactsTotal: number;
  messages24h: number;
  messages7d: number;
  mediaFailed7d: number;
  automationsFailed7d: number;
}

/**
 * How the platform is doing, in one query.
 *
 * A dozen aggregates as a dozen PostgREST calls would be a dozen round
 * trips, and counting messages needs a join the client cannot express —
 * so this is a SQL function, granted to service_role only.
 */
export async function platformOverview(): Promise<PlatformOverview> {
  const db = privilegedClient('operator');
  const { data } = await db.rpc('operator_platform_overview');
  const d = (data ?? {}) as Record<string, number>;
  return {
    companiesTotal: d.companies_total ?? 0,
    companiesActive: d.companies_active ?? 0,
    companiesSuspended: d.companies_suspended ?? 0,
    companiesDormant: d.companies_dormant ?? 0,
    signups7d: d.signups_7d ?? 0,
    signups30d: d.signups_30d ?? 0,
    numbersTotal: d.numbers_total ?? 0,
    numbersConnected: d.numbers_connected ?? 0,
    numbersDown: d.numbers_down ?? 0,
    contactsTotal: d.contacts_total ?? 0,
    messages24h: d.messages_24h ?? 0,
    messages7d: d.messages_7d ?? 0,
    mediaFailed7d: d.media_failed_7d ?? 0,
    automationsFailed7d: d.automations_failed_7d ?? 0,
  };
}

export interface CompanyNumberHealth {
  id: string;
  label: string | null;
  instanceName: string | null;
  connectionState: string | null;
  status: string | null;
  lastError: string | null;
}

export interface CompanyHealth {
  messages24h: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** No inbound message for 3+ days — computed server-side, not at render. */
  inboundStale: boolean;
  mediaFailed7d: number;
  automationsFailed7d: number;
  automationLastError: string | null;
  broadcastsWithFailures7d: number;
  numbers: CompanyNumberHealth[];
}

/** What is currently wrong in one company — where support starts. */
export async function getCompanyHealth(accountId: string): Promise<CompanyHealth> {
  const db = privilegedClient('operator');
  const { data } = await db.rpc('operator_company_health', { target: accountId });
  const d = (data ?? {}) as Record<string, unknown>;
  const numbers = (d.numbers ?? []) as Record<string, unknown>[];
  return {
    messages24h: (d.messages_24h as number) ?? 0,
    lastInboundAt: (d.last_inbound_at as string) ?? null,
    lastOutboundAt: (d.last_outbound_at as string) ?? null,
    inboundStale: d.inbound_stale === true,
    mediaFailed7d: (d.media_failed_7d as number) ?? 0,
    automationsFailed7d: (d.automations_failed_7d as number) ?? 0,
    automationLastError: (d.automation_last_error as string) ?? null,
    broadcastsWithFailures7d: (d.broadcasts_with_failures_7d as number) ?? 0,
    numbers: numbers.map((n) => ({
      id: n.id as string,
      label: (n.label as string) ?? null,
      instanceName: (n.instance_name as string) ?? null,
      connectionState: (n.connection_state as string) ?? null,
      status: (n.status as string) ?? null,
      lastError: (n.last_error as string) ?? null,
    })),
  };
}
