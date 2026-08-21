import { describe, it, expect } from 'vitest'

import { shouldMovePreview, previewText } from './conversation-preview'

const T = (iso: string) => iso

describe('shouldMovePreview', () => {
  it('takes the newer message', () => {
    expect(
      shouldMovePreview(T('2026-08-21T12:00:00Z'), T('2026-08-21T12:05:00Z')),
    ).toBe(true)
  })

  /**
   * The reported bug: a backlog message from hours ago arrives now and
   * overwrites the preview, so the inbox shows an old message as if it
   * were the latest.
   */
  it('refuses to move backwards to an older message', () => {
    expect(
      shouldMovePreview(T('2026-08-21T12:00:00Z'), T('2026-08-21T09:00:00Z')),
    ).toBe(false)
  })

  it('fills an empty preview', () => {
    expect(shouldMovePreview(null, T('2026-08-21T12:00:00Z'))).toBe(true)
    expect(shouldMovePreview(undefined, T('2026-08-21T12:00:00Z'))).toBe(true)
  })

  it('treats a tie as newer', () => {
    const same = T('2026-08-21T12:00:00Z')
    expect(shouldMovePreview(same, same)).toBe(true)
  })

  /**
   * A preview is cosmetic. Refusing to update one over a malformed date
   * would leave a thread showing something stale forever, which is the
   * complaint this exists to fix.
   */
  it('updates rather than sticking when a date cannot be read', () => {
    expect(shouldMovePreview('not a date', T('2026-08-21T12:00:00Z'))).toBe(true)
    expect(shouldMovePreview(T('2026-08-21T12:00:00Z'), 'not a date')).toBe(true)
  })
})

describe('previewText', () => {
  it('uses the text when there is some', () => {
    expect(previewText('hello there', 'text')).toBe('hello there')
  })

  /**
   * Media carries no text. A blank preview reads as a bug — and worse,
   * the client used to render '' while the database held '[image]', so a
   * preview appeared to vanish until the page was reloaded.
   */
  it('names the media when there is no text', () => {
    expect(previewText(null, 'image')).toBe('[image]')
    expect(previewText('', 'audio')).toBe('[audio]')
    expect(previewText('   ', 'document')).toBe('[document]')
  })

  it('never renders an empty preview, even with nothing to go on', () => {
    expect(previewText(null, null)).toBe('[message]')
    expect(previewText(undefined, undefined)).toBe('[message]')
  })
})
