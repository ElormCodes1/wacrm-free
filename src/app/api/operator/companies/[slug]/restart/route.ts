import { NextResponse } from 'next/server';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { privilegedClient } from '@/lib/supabase/privileged';
import {
  isInstanceAlive,
  clearAliveCache,
  restartInstance,
} from '@/lib/whatsapp/provider/evolution';

/** Give the socket a moment to come up before believing the re-probe. */
const RESTART_SETTLE_MS = 4000;

/**
 * Probe, and if necessary restart, one customer's WhatsApp number.
 *
 * This is the support action the console most needed. Evolution's socket
 * dies quietly: connectionState keeps reporting "open" while every
 * operation fails with 428, so inbound messages stop, the CRM looks
 * healthy, and the only symptom is silence. Diagnosing that previously
 * meant a terminal and the gateway's API.
 *
 * Two things it deliberately does NOT do:
 *
 *   * Trust the stored connection_state. It probes for real (force), which
 *     is the whole point — a cached "alive" is exactly what a watchdog
 *     must not believe.
 *
 *   * Restart a healthy socket. Restarting drops the connection and
 *     re-pairs from stored credentials; doing it to a working number
 *     turns a support call into an outage. If the probe says alive, this
 *     reports that and stops.
 *
 * The instance is looked up THROUGH the company, so an operator cannot
 * restart an arbitrary instance name by guessing it — the number has to
 * belong to the company in the URL.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const operator = await getOperator();
    if (!operator) {
      return NextResponse.json({ error: 'Not signed in as an operator' }, { status: 401 });
    }

    const { slug } = await params;
    const { numberId } = (await request.json().catch(() => ({}))) as { numberId?: string };
    if (!numberId) {
      return NextResponse.json({ error: 'numberId is required' }, { status: 400 });
    }

    const db = privilegedClient('operator');

    const { data: account } = await db
      .from('accounts')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle();
    if (!account) {
      return NextResponse.json({ error: 'No company at that address' }, { status: 404 });
    }

    // Scoped to the company: an id from another customer resolves to
    // nothing rather than to their instance.
    const { data: number } = await db
      .from('whatsapp_config')
      .select('id, label, instance_name')
      .eq('id', numberId)
      .eq('account_id', account.id as string)
      .maybeSingle();
    if (!number) {
      return NextResponse.json({ error: 'That number does not belong to this company' }, { status: 404 });
    }

    const instance = number.instance_name as string;
    if (!instance) {
      return NextResponse.json({ error: 'That number has no gateway instance' }, { status: 409 });
    }

    const aliveBefore = await isInstanceAlive(instance, { force: true });

    let restarted = false;
    let aliveAfter = aliveBefore;

    if (!aliveBefore) {
      try {
        await restartInstance(instance);
        restarted = true;
      } catch {
        /* the re-probe below is the real verdict */
      }
      await new Promise((r) => setTimeout(r, RESTART_SETTLE_MS));
      clearAliveCache(instance);
      aliveAfter = await isInstanceAlive(instance, { force: true });
    }

    // Keep the stored column honest — it is what the customer's own
    // Settings page reads, and letting it drift is how a dead line reads
    // as connected.
    await db
      .from('whatsapp_config')
      .update({
        connection_state: aliveAfter ? 'open' : 'close',
        status: aliveAfter ? 'connected' : 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', number.id as string);

    await recordOperatorAction({
      operator,
      action: restarted ? 'number.restart' : 'number.probe',
      targetAccountId: account.id as string,
      detail: {
        slug,
        label: number.label ?? null,
        aliveBefore,
        restarted,
        aliveAfter,
      },
      ip: request.headers.get('x-forwarded-for'),
    });

    return NextResponse.json({
      ok: true,
      aliveBefore,
      restarted,
      alive: aliveAfter,
      message: aliveBefore
        ? 'Socket answered — left it alone rather than dropping a working connection.'
        : aliveAfter
          ? 'Socket was dead. Restarted and it came back.'
          : 'Socket was dead and did not come back after a restart. Needs re-pairing.',
    });
  } catch (error) {
    console.error('Error restarting a number:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
