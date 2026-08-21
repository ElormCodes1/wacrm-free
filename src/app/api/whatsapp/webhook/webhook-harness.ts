/**
 * Test harness for the inbound webhook.
 *
 * The route's internals aren't exported (Next restricts what a route
 * module may export), so these tests drive the real `POST` handler with
 * real payload shapes and assert on what reaches the database. That is
 * also the more honest test: every bug this file guards against was a
 * whole-path failure — an event skipped, an address unresolved, a write
 * that never happened — none of which a unit test of a helper would have
 * caught.
 *
 * Not a test file itself; `*.test.ts` is the include pattern.
 */

/** A recorded write, so tests can assert on what the route actually did. */
export interface RecordedOp {
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete';
  payload: unknown;
}

export interface SupabaseStub {
  ops: RecordedOp[];
  /** Rows returned by selects, keyed by table. */
  rows: Record<string, Record<string, unknown>[]>;
  client: unknown;
  /** Every row inserted into `table`, in order. */
  inserted(table: string): Record<string, unknown>[];
  /** Every update applied to `table`. */
  updated(table: string): Record<string, unknown>[];
  /**
   * Install a stand-in for the single-round-trip ingest function
   * (migration 082). Absent by default, which is the honest default: a
   * database without the migration is exactly what the fallback path
   * exists for, and it is what most of these tests should exercise.
   */
  setRpc(fn: ((name: string, args: unknown) => Promise<unknown>) | null): void;
  /** Calls made to rpc(), in order. */
  rpcCalls: { name: string; args: unknown }[];
}

/**
 * A minimal stand-in for the Supabase client covering the shapes the
 * webhook uses: chained filters ending in `maybeSingle`/`single`, awaited
 * builders, insert/update/upsert/delete, and storage uploads.
 *
 * Selects return `rows[table]` filtered by the `eq` constraints applied,
 * which is enough for the route's lookups (by id, message_id, lid) without
 * pretending to be a database.
 */
export function makeSupabaseStub(
  rows: Record<string, Record<string, unknown>[]> = {}
): SupabaseStub {
  const ops: RecordedOp[] = [];
  const store: Record<string, Record<string, unknown>[]> = { ...rows };

  function builder(table: string) {
    const eqs: [string, unknown][] = [];
    let pendingInsert: Record<string, unknown> | null = null;

    const matches = () =>
      (store[table] ?? []).filter((r) =>
        eqs.every(([col, val]) => String(r[col] ?? '') === String(val))
      );

    const result = () => {
      // After an insert, `.select().single()` should hand back the new row.
      if (pendingInsert) return { data: pendingInsert, error: null };
      return { data: matches(), error: null };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        eqs.push([col, val]);
        return chain;
      },
      neq: () => chain,
      or: () => chain,
      in: () => chain,
      ilike: () => chain,
      like: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      single: async () => {
        if (pendingInsert) return { data: pendingInsert, error: null };
        const hit = matches()[0];
        return hit
          ? { data: hit, error: null }
          : { data: null, error: { message: 'no rows' } };
      },
      insert: (payload: Record<string, unknown>) => {
        ops.push({ table, op: 'insert', payload });
        pendingInsert = { id: `generated-${table}-${ops.length}`, ...payload };
        store[table] = [...(store[table] ?? []), pendingInsert];
        return chain;
      },
      upsert: (payload: unknown) => {
        ops.push({ table, op: 'upsert', payload });
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        ops.push({ table, op: 'update', payload });
        return chain;
      },
      delete: () => {
        ops.push({ table, op: 'delete', payload: null });
        return chain;
      },
      // Awaiting the builder directly (no maybeSingle/single) is common in
      // the route — `const { error } = await db.from(x).update(y).eq(...)`.
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  }

  const client = {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'x' }, error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/${path}` },
        }),
      }),
    },
  };

  const rpcCalls: { name: string; args: unknown }[] = [];

  return {
    ops,
    rows: store,
    client,
    rpcCalls,
    setRpc: (fn) => {
      // Assigned onto the same client object the route already holds, so
      // a test can switch the fast path on after the stub is built.
      (client as { rpc?: unknown }).rpc = fn
        ? async (name: string, args: unknown) => {
            rpcCalls.push({ name, args });
            return fn(name, args);
          }
        : undefined;
    },
    inserted: (table) =>
      ops.filter((o) => o.table === table && o.op === 'insert').map(
        (o) => o.payload as Record<string, unknown>
      ),
    updated: (table) =>
      ops.filter((o) => o.table === table && o.op === 'update').map(
        (o) => o.payload as Record<string, unknown>
      ),
  };
}

// ============================================================
// Payload builders — shapes captured from a live WhatsApp instance
// ============================================================

/** A 1:1 text message from a phone-addressed sender. */
export function inboundText(overrides: Record<string, unknown> = {}) {
  return {
    key: {
      id: 'MSGID-TEXT-1',
      fromMe: false,
      remoteJid: '233541234567@s.whatsapp.net',
    },
    pushName: 'Ama',
    messageTimestamp: 1786000000,
    message: { conversation: 'hello there' },
    ...overrides,
  };
}

/**
 * A LID-addressed inbound message. Note remoteJidAlt is absent — that is
 * the shape that was silently dropping messages: WhatsApp only includes
 * the phone on messages we SEND.
 */
export function inboundLidText(overrides: Record<string, unknown> = {}) {
  return {
    key: {
      id: 'MSGID-LID-1',
      fromMe: false,
      remoteJid: '265403578232895@lid',
    },
    pushName: 'Seyram',
    messageTimestamp: 1786000100,
    message: { conversation: 'sent from a lid chat' },
    ...overrides,
  };
}

/** An inbound image, to exercise the insert-then-backfill media path. */
export function inboundImage(overrides: Record<string, unknown> = {}) {
  return {
    key: {
      id: 'MSGID-IMG-1',
      fromMe: false,
      remoteJid: '233541234567@s.whatsapp.net',
    },
    pushName: 'Ama',
    messageTimestamp: 1786000200,
    message: {
      imageMessage: { mimetype: 'image/jpeg', caption: 'the receipt' },
    },
    ...overrides,
  };
}

/**
 * A group message. `participant` is a LID and `participantAlt` is absent —
 * the shape that used to write LID digits into author_phone.
 */
export function inboundGroupText(overrides: Record<string, unknown> = {}) {
  return {
    key: {
      id: 'MSGID-GROUP-1',
      fromMe: false,
      remoteJid: '120363111718907840@g.us',
      participant: '51406782370004@lid',
    },
    pushName: 'Kwame',
    messageTimestamp: 1786000300,
    message: { conversation: 'morning all' },
    ...overrides,
  };
}

/** Wrap a message in the webhook envelope Evolution posts. */
export function envelope(
  event: string,
  data: unknown,
  instance = 'wacrm-test-instance'
) {
  return { event, instance, data };
}

/** Build the Request the route handler receives. */
export function webhookRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
