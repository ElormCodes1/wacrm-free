import { describe, it, expect } from 'vitest'

import { isPlaceholderName, betterName } from './contact-name'

describe('isPlaceholderName', () => {
  it('treats nothing as a placeholder', () => {
    expect(isPlaceholderName(null)).toBe(true)
    expect(isPlaceholderName(undefined)).toBe(true)
    expect(isPlaceholderName('')).toBe(true)
    expect(isPlaceholderName('   ')).toBe(true)
  })

  it('treats the phone number itself as a placeholder', () => {
    expect(isPlaceholderName('233541234567', '233541234567')).toBe(true)
  })

  /**
   * The case that makes a naive `name === phone` check useless: the same
   * digits written differently compare unequal, so the row looks named
   * while telling the reader nothing.
   */
  it('treats a reformatted number as a placeholder', () => {
    expect(isPlaceholderName('+233 54 123 4567', '233541234567')).toBe(true)
    expect(isPlaceholderName('(233) 541-234567', '233541234567')).toBe(true)
    expect(isPlaceholderName('233-541-234567')).toBe(true)
  })

  it('accepts an actual name', () => {
    expect(isPlaceholderName('Ama', '233541234567')).toBe(false)
    expect(isPlaceholderName('Kwame Mensah')).toBe(false)
  })

  /**
   * Businesses really are named like this. Rejecting anything containing
   * a digit would quietly discard them.
   */
  it('accepts names that merely contain digits', () => {
    expect(isPlaceholderName('Shop 24')).toBe(false)
    expect(isPlaceholderName('A1 Motors')).toBe(false)
  })
})

describe('betterName', () => {
  it('fills in over a placeholder', () => {
    expect(betterName('233541234567', 'Ama', '233541234567')).toBe('Ama')
    expect(betterName(null, 'Ama')).toBe('Ama')
    expect(betterName('+233 54 123 4567', 'Ama', '233541234567')).toBe('Ama')
  })

  /**
   * A stored name was more likely typed by someone in the business than
   * derived from whatever the contact currently calls themselves.
   */
  it('never replaces a real stored name', () => {
    expect(betterName('Ama', 'Ama Serwaa')).toBeNull()
  })

  it('refuses a placeholder as an improvement', () => {
    expect(betterName(null, '233541234567', '233541234567')).toBeNull()
    expect(betterName(null, '   ')).toBeNull()
  })

  it('returns null when nothing should change, so callers can skip the write', () => {
    expect(betterName('Ama', null)).toBeNull()
  })
})
