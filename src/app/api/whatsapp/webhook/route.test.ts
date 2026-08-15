import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeSupabaseStub,
  envelope,
  webhookRequest,
  inboundText,
  inboundLidText,
  inboundImage,
  inboundGroupText,
  type SupabaseStub,
} from './webhook-harness';

// ============================================================
// Inbound webhook — the paths that have actually broken.
//
// Every case here is a regression test for a real incident, not a
// hypothetical: messages stored by the gateway but never delivered, LID
// addresses dropped without trace, media blocking the message row, LID
// digits written into a phone column. They run the real POST handler with
// captured payload shapes and assert on what reaches the database.
// ============================================================

const CONFIG = {
  id: 'cfg-1',
  account_id: 'acc-1',
  user_id: 'user-1',
};

/** after() callbacks, so the background processing can be awaited. */
let afterTasks: Promise<unknown>[] = [];
let db: SupabaseStub;

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    // The route acks immediately and processes in after(); tests need the
    // work to have finished before they assert.
    after: (fn: () => Promise<unknown>) => {
      afterTasks.push(Promise.resolve(fn()));
    },
  };
});

// The route obtains its RLS-bypassing client through the single
// privileged door now, so that is what the harness stands in for.
vi.mock('@/lib/supabase/privileged', () => ({
  privilegedClient: () => db.client,
}));

vi.mock('@/lib/whatsapp/provider/config', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/whatsapp/provider/config')
  >();
  return {
    ...actual,
    resolveInstanceConfig: vi.fn(async () => CONFIG),
  };
});

const evolution = vi.hoisted(() => ({
  resolveLid: vi.fn(async () => null as string | null),
  getBase64FromMediaMessage: vi.fn(async () => ({
    base64: Buffer.from('binary').toString('base64'),
    mimetype: 'image/jpeg',
    fileName: 'receipt.jpg',
  })),
}));

vi.mock('@/lib/whatsapp/provider/evolution', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/whatsapp/provider/evolution')
  >();
  return {
    ...actual,
    // Pure helpers (jidToPhone, jidLocalPart) stay real — mocking them
    // would hide the address handling these tests exist to check.
    resolveLid: evolution.resolveLid,
    learnLid: vi.fn(),
    learnLidsFromKey: vi.fn(),
    learnLidsFromGroup: vi.fn(async () => {}),
    getBase64FromMediaMessage: evolution.getBase64FromMediaMessage,
    findContactByJid: vi.fn(async () => null),
    fetchGroupInfo: vi.fn(async () => null),
    fetchInstance: vi.fn(async () => null),
  };
});

// Downstream side effects are someone else's tests.
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: vi.fn(async () => {}) }));
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn(async () => ({ consumed: false })),
}));
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: vi.fn(async () => {}) }));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/whatsapp/avatar', () => ({
  syncContactAvatar: vi.fn(async () => {}),
  syncContactProfile: vi.fn(async () => {}),
  storeAvatarFromUrl: vi.fn(async () => {}),
}));

/** POST the envelope and wait for the after() work to finish. */
async function deliver(body: unknown) {
  const { POST } = await import('./route');
  const res = await POST(webhookRequest(body));
  await Promise.all(afterTasks);
  return res;
}

const EXISTING_CONTACT = {
  id: 'contact-1',
  account_id: 'acc-1',
  phone: '233541234567',
  name: 'Ama',
  is_on_whatsapp: true,
  avatar_url: 'https://cdn.test/a.jpg',
};
const EXISTING_CONVERSATION = {
  id: 'conv-1',
  account_id: 'acc-1',
  contact_id: 'contact-1',
  unread_count: 0,
};

beforeEach(() => {
  // The route caches its Supabase client in a module-level variable, so a
  // stale client from the previous test would swallow every write. Reset
  // the module registry so each test gets a route bound to its own stub.
  vi.resetModules();
  afterTasks = [];
  evolution.resolveLid.mockResolvedValue(null);
  db = makeSupabaseStub({
    whatsapp_config: [{ ...CONFIG, instance_name: 'wacrm-test-instance' }],
    contacts: [EXISTING_CONTACT],
    conversations: [EXISTING_CONVERSATION],
    messages: [],
    pending_lid_events: [],
  });
});

describe('acknowledgement', () => {
  it('acks a valid event immediately', async () => {
    const res = await deliver(envelope('messages.upsert', inboundText()));
    expect(res.status).toBe(200);
  });

  it('rejects a body it cannot parse', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"event": "messages.upsert", ',
      })
    );
    expect(res.status).toBe(400);
  });

  it('ignores an event it does not handle, without writing anything', async () => {
    await deliver(envelope('chats.delete', { id: 'x' }));
    expect(db.inserted('messages')).toHaveLength(0);
  });
});

describe('1:1 inbound text', () => {
  it('stores the message against the existing conversation', async () => {
    await deliver(envelope('messages.upsert', inboundText()));

    const [msg] = db.inserted('messages');
    expect(msg).toBeDefined();
    expect(msg.sender_type).toBe('customer');
    expect(msg.content_text).toBe('hello there');
    expect(msg.content_type).toBe('text');
    expect(msg.message_id).toBe('MSGID-TEXT-1');
  });

  it('ignores newsletter traffic entirely', async () => {
    await deliver(
      envelope(
        'messages.upsert',
        inboundText({
          key: {
            id: 'N1',
            fromMe: false,
            remoteJid: '120363000000000000@newsletter',
          },
        })
      )
    );
    expect(db.inserted('messages')).toHaveLength(0);
  });
});

describe('history replay (messages.set)', () => {
  // The gateway skips anything already in ITS database on the assumption
  // that stored means delivered, so recovery replays backlog through this
  // event — which means it re-delivers things we may already hold.
  it('does not duplicate a message already in the thread', async () => {
    db.rows.messages = [
      { id: 'm-existing', message_id: 'MSGID-TEXT-1', conversation_id: 'conv-1' },
    ];

    await deliver(envelope('messages.set', inboundText()));

    expect(db.inserted('messages')).toHaveLength(0);
  });

  it('still stores a backlog message that is genuinely new', async () => {
    await deliver(envelope('messages.set', inboundText()));
    expect(db.inserted('messages')).toHaveLength(1);
  });
});

describe('LID-addressed inbound', () => {
  it('delivers under a LID-keyed contact when no phone can be found', async () => {
    // WhatsApp shares a number only once you have history with someone;
    // for a stranger there may be none to find, ever. These used to be
    // parked and invisible.
    evolution.resolveLid.mockResolvedValue(null);

    await deliver(envelope('messages.upsert', inboundLidText()));

    const [contact] = db.inserted('contacts');
    expect(contact).toBeDefined();
    expect(contact.lid).toBe('265403578232895@lid');
    expect(contact.name).toBe('Seyram');

    const [msg] = db.inserted('messages');
    expect(msg).toBeDefined();
    expect(msg.content_text).toBe('sent from a lid chat');
  });

  it('does not park a message it can deliver', async () => {
    evolution.resolveLid.mockResolvedValue(null);
    await deliver(envelope('messages.upsert', inboundLidText()));
    expect(db.inserted('pending_lid_events')).toHaveLength(0);
  });

  it('uses the real phone when the LID does resolve', async () => {
    evolution.resolveLid.mockResolvedValue('233541234567@s.whatsapp.net');

    await deliver(envelope('messages.upsert', inboundLidText()));

    // Resolved to the known contact, so no LID contact is invented.
    expect(db.inserted('contacts')).toHaveLength(0);
    expect(db.inserted('messages')).toHaveLength(1);
  });
});

describe('media', () => {
  it('inserts the message before fetching the file', async () => {
    await deliver(envelope('messages.upsert', inboundImage()));

    const [msg] = db.inserted('messages');
    expect(msg.content_type).toBe('image');
    // The row lands with the caption and a pending marker; blocking on the
    // download is what used to keep a video invisible for tens of seconds.
    expect(msg.media_url).toBeNull();
    expect(msg.media_status).toBe('pending');
    expect(msg.content_text).toBe('the receipt');
  });

  it('backfills the media URL afterwards', async () => {
    await deliver(envelope('messages.upsert', inboundImage()));

    const backfill = db
      .updated('messages')
      .find((u) => 'media_status' in u && u.media_status === 'ready');
    expect(backfill).toBeDefined();
    expect(String(backfill!.media_url)).toContain('https://cdn.test/');
  });

  it('marks the media failed rather than leaving it pending forever', async () => {
    evolution.getBase64FromMediaMessage.mockRejectedValueOnce(new Error('gone'));

    await deliver(envelope('messages.upsert', inboundImage()));

    const failed = db
      .updated('messages')
      .find((u) => 'media_status' in u && u.media_status === 'failed');
    expect(failed).toBeDefined();
  });
});

describe('group messages', () => {
  it('never writes a LID into author_phone', async () => {
    // participantAlt is absent and the participant is a LID. Writing those
    // digits as a phone produced a plausible number belonging to nobody —
    // harmless as a label, not harmless once it became clickable.
    evolution.resolveLid.mockResolvedValue(null);

    await deliver(envelope('messages.upsert', inboundGroupText()));

    const msg = db.inserted('messages')[0];
    expect(msg).toBeDefined();
    expect(msg.author_phone).toBeNull();
    // The name still shows, so the sender is identifiable.
    expect(msg.author_name).toBe('Kwame');
  });

  it('records the real phone when the participant resolves', async () => {
    evolution.resolveLid.mockResolvedValue('233200000000@s.whatsapp.net');

    await deliver(envelope('messages.upsert', inboundGroupText()));

    const msg = db.inserted('messages')[0];
    expect(msg.author_phone).toBe('233200000000');
  });
});
