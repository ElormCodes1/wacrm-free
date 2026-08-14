import { describe, it, expect } from 'vitest'
import { extractMentionJids, jidLocalPart, splitMentionTokens } from './mentions'

describe('jidLocalPart', () => {
  it('takes the local part of a LID and a phone JID', () => {
    expect(jidLocalPart('48688487493799@lid')).toBe('48688487493799')
    expect(jidLocalPart('233241035885@s.whatsapp.net')).toBe('233241035885')
  })

  it('drops a device suffix', () => {
    expect(jidLocalPart('233241035885:12@s.whatsapp.net')).toBe('233241035885')
  })
})

describe('extractMentionJids', () => {
  it('finds mentions on a plain text message', () => {
    expect(
      extractMentionJids({
        extendedTextMessage: {
          text: 'Please heed @183713451274301',
          contextInfo: { mentionedJid: ['183713451274301@lid'] },
        },
      }),
    ).toEqual(['183713451274301@lid'])
  })

  it('finds mentions on a media caption', () => {
    // Observed live: mentions ride on image/video messages too.
    expect(
      extractMentionJids({
        imageMessage: {
          caption: 'look @161302093815842',
          contextInfo: { mentionedJid: ['161302093815842@lid'] },
        },
      }),
    ).toEqual(['161302093815842@lid'])
  })

  it('reaches mentions nested inside a wrapper envelope', () => {
    // documentWithCaptionMessage / ephemeral / view-once all nest, which
    // is why extraction walks rather than checking fixed paths.
    expect(
      extractMentionJids({
        ephemeralMessage: {
          message: {
            documentWithCaptionMessage: {
              message: {
                documentMessage: {
                  fileName: 'notes.pdf',
                  contextInfo: { mentionedJid: ['999@lid'] },
                },
              },
            },
          },
        },
      }),
    ).toEqual(['999@lid'])
  })

  it('preserves order and de-duplicates', () => {
    const jids = extractMentionJids({
      conversation: 'a',
      extendedTextMessage: {
        contextInfo: { mentionedJid: ['1@lid', '2@lid', '1@lid'] },
      },
    })
    expect(jids).toEqual(['1@lid', '2@lid'])
  })

  it('handles messages with no mentions, and junk', () => {
    expect(extractMentionJids({ conversation: 'hello' })).toEqual([])
    expect(extractMentionJids({ x: { contextInfo: { mentionedJid: [] } } })).toEqual([])
    expect(extractMentionJids(null)).toEqual([])
    expect(extractMentionJids(undefined)).toEqual([])
    expect(extractMentionJids({ a: { contextInfo: { mentionedJid: [1, null, {}] } } })).toEqual([])
  })

  it('does not hang on a cyclic object', () => {
    const node: Record<string, unknown> = { contextInfo: { mentionedJid: ['7@lid'] } }
    node.self = node
    expect(extractMentionJids(node)).toEqual(['7@lid'])
  })
})

describe('splitMentionTokens', () => {
  it('splits a real mention out of real text', () => {
    // Verbatim from the live message store.
    expect(splitMentionTokens('Please who knows @48688487493799 ?')).toEqual([
      { type: 'text', value: 'Please who knows ' },
      { type: 'mention', token: '48688487493799' },
      { type: 'text', value: ' ?' },
    ])
  })

  it('handles several mentions in a row', () => {
    expect(splitMentionTokens('@48688487493799 @18718021177563')).toEqual([
      { type: 'mention', token: '48688487493799' },
      { type: 'text', value: ' ' },
      { type: 'mention', token: '18718021177563' },
    ])
  })

  it('handles a mention at the very start and end', () => {
    expect(splitMentionTokens('@280839455797266')).toEqual([
      { type: 'mention', token: '280839455797266' },
    ])
  })

  it('leaves @all and @everyone alone — they are keywords, not people', () => {
    // Live text: "@51406782370004 😂 don't you know @all would have…"
    expect(splitMentionTokens("don't you know @all would have")).toEqual([
      { type: 'text', value: "don't you know @all would have" },
    ])
    expect(splitMentionTokens('@everyone')).toEqual([
      { type: 'text', value: '@everyone' },
    ])
  })

  it('does not mangle an email address', () => {
    expect(splitMentionTokens('mail me at hi@2348012345678.com ok')).toEqual([
      { type: 'text', value: 'mail me at hi@2348012345678.com ok' },
    ])
  })

  it('ignores runs too short to be a real token', () => {
    expect(splitMentionTokens('meet @12 pm')).toEqual([
      { type: 'text', value: 'meet @12 pm' },
    ])
  })

  it('returns a single run when there is nothing to split', () => {
    expect(splitMentionTokens('plain text')).toEqual([
      { type: 'text', value: 'plain text' },
    ])
  })
})
