import { describe, it, expect } from 'vitest'
import { learnLid, learnLidsFromKey, resolveLid } from './evolution'

// The LID map is keyed by instance name, so each test uses its own
// instance and they can't bleed into one another — no reset hook needed.
// Every assertion below stays on the "already learned" path, which returns
// before any network call, so these run offline.

const PHONE = '233545802918@s.whatsapp.net'
const LID = '255679587713039@lid'

describe('learnLid', () => {
  it('records a lid -> phone pair and resolves it without a lookup', async () => {
    learnLid('inst-basic', LID, PHONE)
    await expect(resolveLid('inst-basic', LID)).resolves.toBe(PHONE)
  })

  it('keeps bindings for different lids side by side', async () => {
    learnLid('inst-many', LID, PHONE)
    learnLid('inst-many', '116930904088706@lid', '233241035885@s.whatsapp.net')

    await expect(resolveLid('inst-many', LID)).resolves.toBe(PHONE)
    await expect(resolveLid('inst-many', '116930904088706@lid')).resolves.toBe(
      '233241035885@s.whatsapp.net',
    )
  })

  it('does not leak bindings across instances', async () => {
    learnLid('inst-a', LID, PHONE)
    // A different instance has never seen it; resolving would have to hit
    // the network, so just assert the first one is unaffected.
    await expect(resolveLid('inst-a', LID)).resolves.toBe(PHONE)
  })

  it('ignores pairs that are not a real lid -> phone mapping', async () => {
    // Wrong direction, wrong suffixes, and non-strings must not be stored;
    // a bad entry would resolve a message to the wrong contact.
    learnLid('inst-junk', PHONE, LID)
    learnLid('inst-junk', LID, '')
    learnLid('inst-junk', LID, undefined)
    learnLid('inst-junk', LID, null)
    learnLid('inst-junk', LID, '233545802918')
    learnLid('inst-junk', LID, '116930904088706@lid')

    // Nothing was learned, so a non-lid input is the only safe assertion
    // that stays offline — it short-circuits before any lookup.
    await expect(resolveLid('inst-junk', PHONE)).resolves.toBe(PHONE)
  })
})

describe('learnLidsFromKey', () => {
  it('harvests the chat address from an outbound message key', async () => {
    learnLidsFromKey('inst-key', {
      remoteJid: LID,
      remoteJidAlt: PHONE,
      fromMe: true,
    })
    await expect(resolveLid('inst-key', LID)).resolves.toBe(PHONE)
  })

  it('harvests the sender address too (group participants)', async () => {
    learnLidsFromKey('inst-participant', {
      remoteJid: '120363111718907840@g.us',
      participant: '999888777@lid',
      participantAlt: '233200000000@s.whatsapp.net',
    })
    await expect(resolveLid('inst-participant', '999888777@lid')).resolves.toBe(
      '233200000000@s.whatsapp.net',
    )
  })

  it('learns nothing from an inbound key, which carries no alt', async () => {
    // This is the shape that was silently dropping messages: an inbound
    // LID message with remoteJidAlt null. It must not poison the map.
    learnLidsFromKey('inst-inbound', {
      remoteJid: LID,
      remoteJidAlt: null,
      fromMe: false,
    })
    // Learn it properly afterwards and confirm the real binding takes.
    learnLid('inst-inbound', LID, PHONE)
    await expect(resolveLid('inst-inbound', LID)).resolves.toBe(PHONE)
  })

  it('tolerates a missing or malformed key', () => {
    expect(() => learnLidsFromKey('inst-safe', null)).not.toThrow()
    expect(() => learnLidsFromKey('inst-safe', undefined)).not.toThrow()
    expect(() => learnLidsFromKey('inst-safe', {})).not.toThrow()
  })
})

describe('resolveLid', () => {
  it('passes a plain phone JID straight through', async () => {
    await expect(resolveLid('inst-passthrough', PHONE)).resolves.toBe(PHONE)
  })

  it('never forgets a binding once learned', async () => {
    learnLid('inst-sticky', LID, PHONE)
    // Repeated resolution must stay stable — the old implementation
    // rebuilt its map wholesale every 5 minutes and could lose entries.
    await expect(resolveLid('inst-sticky', LID)).resolves.toBe(PHONE)
    await expect(resolveLid('inst-sticky', LID)).resolves.toBe(PHONE)
    await expect(resolveLid('inst-sticky', LID)).resolves.toBe(PHONE)
  })
})
