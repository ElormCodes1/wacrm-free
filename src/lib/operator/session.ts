import 'server-only';

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

import { privilegedClient } from '@/lib/supabase/privileged';

/**
 * Operator sessions — the separate way in.
 *
 * The requirement is that no customer session, however privileged inside
 * its own company, can be escalated or converted into an operator
 * session. That rules out deriving operator status from the customer
 * session, because anything derived from it is by definition reachable
 * from it.
 *
 * So an operator session is a distinct credential: a short-lived cookie,
 * signed with a secret this process holds, mintable only by passing the
 * operator sign-in. Arriving with a customer cookie — owner, admin, or
 * anything else — provides no path to obtaining one. The two are checked
 * separately and neither implies the other.
 *
 * The cookie is signed rather than encrypted because it carries nothing
 * secret: an operator id and an expiry. Signing is there to stop it being
 * forged, not to hide it.
 */

const COOKIE_NAME = 'operator_session';
/** Short by design: an operator's reach is wide, so a stale tab should not keep it. */
const TTL_SECONDS = 60 * 60 * 8;

function secret(): string {
  const value = process.env.OPERATOR_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'OPERATOR_SESSION_SECRET must be set to at least 32 characters. ' +
        'Without it operator sessions cannot be signed, and an unsigned one is forgeable.'
    );
  }
  return value;
}

interface OperatorClaims {
  /** auth.users id of the operator. */
  sub: string;
  name: string;
  /** Unix seconds. */
  exp: number;
  /** Distinguishes one sign-in from another, for the audit trail. */
  sid: string;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function encode(claims: OperatorClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decode(token: string): OperatorClaims | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;

  const expected = sign(body);
  // Constant-time: a fast reject on the first wrong byte leaks the
  // signature a byte at a time to anyone willing to time the responses.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as OperatorClaims;
    if (!claims.sub || !claims.exp) return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export interface OperatorIdentity {
  userId: string;
  name: string;
  sessionId: string;
}

/** Mint a session. Callers must already have verified credentials AND membership. */
export async function issueOperatorSession(userId: string, name: string): Promise<void> {
  const claims: OperatorClaims = {
    sub: userId,
    name,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    sid: randomUUID(),
  };
  const store = await cookies();
  store.set(COOKIE_NAME, encode(claims), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SECONDS,
  });
}

export async function clearOperatorSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * The current operator, or null.
 *
 * Verifies the signature AND re-checks the operators table on every call:
 * a signed cookie proves who minted it, not that they are still an
 * operator. Revoking someone must take effect on their next action, the
 * same standard applied to suspended companies and deactivated staff.
 */
export async function getOperator(): Promise<OperatorIdentity | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const claims = decode(token);
  if (!claims) return null;

  const db = privilegedClient('operator');
  const { data } = await db
    .from('operators')
    .select('user_id, name, is_active')
    .eq('user_id', claims.sub)
    .maybeSingle();

  if (!data || data.is_active === false) return null;
  return {
    userId: data.user_id as string,
    name: (data.name as string) ?? claims.name,
    sessionId: claims.sid,
  };
}

/**
 * Record an operator action.
 *
 * Called by the operator routes rather than by a database trigger,
 * because what matters is the intent — which operator looked at which
 * company — and a trigger only sees rows changing. Reads are the point
 * here: an operator browsing a customer's data changes nothing and is
 * exactly what must be on the record.
 */
export async function recordOperatorAction(args: {
  operator: OperatorIdentity;
  action: string;
  targetAccountId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  const db = privilegedClient('operator');
  const { error } = await db.from('operator_audit').insert({
    operator_user_id: args.operator.userId,
    operator_name: args.operator.name,
    action: args.action,
    target_account_id: args.targetAccountId ?? null,
    detail: { ...(args.detail ?? {}), session_id: args.operator.sessionId },
    ip: args.ip ?? null,
  });
  if (error) {
    // An unrecorded operator action is worse than a failed one: the whole
    // point is that nothing crosses company lines unobserved.
    throw new Error(`Refusing to proceed: operator action could not be recorded (${error.message})`);
  }
}
