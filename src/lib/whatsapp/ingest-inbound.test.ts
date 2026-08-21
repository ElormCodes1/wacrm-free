import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { ingestInbound, resetIngestAvailability } from './ingest-inbound'

const params = {
  accountId: 'acc-1',
  userId: 'user-1',
  whatsappConfigId: 'cfg-1',
  remoteJid: null,
  phone: '233541234567',
  contactName: 'Ama',
  messageId: 'MSG-1',
  contentType: 'text',
  contentText: 'hello',
  mediaPending: false,
  createdAt: '2026-08-21T12:00:00.000Z',
  interactiveReplyId: null,
  mentions: null,
  replyToMetaId: null,
  isHistory: false,
  insertMessage: true,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = (rpc: any) => ({ rpc }) as any

const happyRow = {
  deduped: false,
  contact_id: 'c-1',
  contact_created: true,
  contact_avatar_url: null,
  conversation_id: 'v-1',
  conversation_created: true,
  message_row_id: 'm-1',
  is_first_inbound: true,
}

describe('ingestInbound', () => {
  beforeEach(() => {
    resetIngestAvailability()
    delete process.env.WHATSAPP_FAST_INGEST
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('maps a successful call onto the caller’s shape', async () => {
    const result = await ingestInbound(
      client(async () => ({ data: happyRow, error: null })),
      params,
    )
    expect(result).toEqual({
      deduped: false,
      contactId: 'c-1',
      contactCreated: true,
      contactAvatarUrl: null,
      conversationId: 'v-1',
      conversationCreated: true,
      messageRowId: 'm-1',
      isFirstInbound: true,
    })
  })

  it('reports a dedupe without inventing ids', async () => {
    const result = await ingestInbound(
      client(async () => ({ data: { deduped: true }, error: null })),
      params,
    )
    expect(result?.deduped).toBe(true)
    expect(result?.messageRowId).toBeNull()
  })

  /**
   * The deployment-order hazard. This code can reach production before the
   * migration is applied, and on a self-hosted install it may never be.
   * Returning null hands the caller back to a complete implementation; the
   * alternative is turning a missing migration into lost messages.
   */
  it('falls back when the function is not installed', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    }))
    expect(await ingestInbound(client(rpc), params)).toBeNull()
  })

  it('stops probing once it knows the function is missing', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '42883', message: 'function does not exist' },
    }))
    const c = client(rpc)
    await ingestInbound(c, params)
    await ingestInbound(c, params)
    await ingestInbound(c, params)
    // One probe for the life of the process: retrying would add a failed
    // round trip to the very path being optimised, and log per message.
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  /**
   * A transient failure is not a permanent one — it must not disable the
   * fast path until the next restart.
   */
  it('keeps trying after a one-off error', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'timeout' } })
      .mockResolvedValueOnce({ data: happyRow, error: null })
    const c = client(rpc)
    expect(await ingestInbound(c, params)).toBeNull()
    expect((await ingestInbound(c, params))?.contactId).toBe('c-1')
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('falls back when the function declines to resolve', async () => {
    const result = await ingestInbound(
      client(async () => ({ data: { error: 'contact-unresolved' }, error: null })),
      params,
    )
    expect(result).toBeNull()
  })

  it('falls back when the client cannot issue rpc at all', async () => {
    const result = await ingestInbound(
      client(() => {
        throw new Error('rpc is not a function')
      }),
      params,
    )
    expect(result).toBeNull()
  })

  it('can be switched off entirely', async () => {
    process.env.WHATSAPP_FAST_INGEST = '0'
    const rpc = vi.fn()
    expect(await ingestInbound(client(rpc), params)).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})
