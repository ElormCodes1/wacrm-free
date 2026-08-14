import { describe, it, expect } from 'vitest'
import { baseMime, extensionFromFilename, storageExtension } from './media-naming'

// The mime strings below are verbatim from Evolution's
// getBase64FromMediaMessage against a live WhatsApp instance — not
// invented. That is the point: the previous lookup used the raw mime and
// missed every one that carries a parameter.

describe('baseMime', () => {
  it('strips parameters from a voice-note mime', () => {
    expect(baseMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
  })

  it('lowercases and trims', () => {
    expect(baseMime('  IMAGE/JPEG  ')).toBe('image/jpeg')
  })

  it('passes a bare mime through', () => {
    expect(baseMime('video/mp4')).toBe('video/mp4')
  })

  it('returns null for nothing usable', () => {
    expect(baseMime(undefined)).toBeNull()
    expect(baseMime(null)).toBeNull()
    expect(baseMime('')).toBeNull()
    expect(baseMime(';charset=utf-8')).toBeNull()
  })
})

describe('extensionFromFilename', () => {
  it('takes the extension from a real WhatsApp document name', () => {
    expect(
      extensionFromFilename(
        'CONSTITUTION OF THE ASSEMBLIES OF GOD CAMPUS MINISTRY -UMaT.docx',
      ),
    ).toBe('.docx')
  })

  it('lowercases the extension', () => {
    expect(extensionFromFilename('REPORT.PDF')).toBe('.pdf')
  })

  it('handles dots inside the name', () => {
    expect(extensionFromFilename('v1.2.3-notes.txt')).toBe('.txt')
  })

  it('ignores a name with no extension', () => {
    expect(extensionFromFilename('scan')).toBe('')
    expect(extensionFromFilename('')).toBe('')
    expect(extensionFromFilename(undefined)).toBe('')
  })

  it('does not mistake a trailing dotted word for an extension', () => {
    // Guards the length cap — "…and.something-very-long" is not an ext.
    expect(extensionFromFilename('budget.spreadsheetformat')).toBe('')
  })
})

describe('storageExtension', () => {
  it('gives voice notes a real extension (the regression this fixes)', () => {
    // Was '' because MIME_EXT was keyed on the bare 'audio/ogg'.
    expect(storageExtension(undefined, 'audio/ogg; codecs=opus')).toBe('.ogg')
  })

  it('names Office documents from the sender filename', () => {
    expect(
      storageExtension(
        'FinalDocumentRequisitionDeployment2.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('.docx')
  })

  it('falls back to the mime table when there is no filename', () => {
    expect(
      storageExtension(
        undefined,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('.xlsx')
  })

  it('prefers the filename over the mime table', () => {
    // Senders forward files with generic octet-stream mimes; the name is
    // the only thing that still says what it is.
    expect(storageExtension('archive.zip', 'application/octet-stream')).toBe('.zip')
  })

  it('covers the everyday inbound types', () => {
    expect(storageExtension(undefined, 'image/jpeg')).toBe('.jpg')
    expect(storageExtension(undefined, 'video/mp4')).toBe('.mp4')
    expect(storageExtension(undefined, 'image/webp')).toBe('.webp')
    expect(storageExtension(undefined, 'audio/mp4')).toBe('.m4a')
    expect(storageExtension(undefined, 'application/pdf')).toBe('.pdf')
  })

  it('returns empty rather than guessing on an unknown type', () => {
    expect(storageExtension(undefined, 'application/x-made-up')).toBe('')
    expect(storageExtension(undefined, undefined)).toBe('')
  })
})
