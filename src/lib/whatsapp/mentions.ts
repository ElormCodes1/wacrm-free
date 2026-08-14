/**
 * WhatsApp @mentions.
 *
 * A mention is two things that have to be matched up:
 *
 *   1. the message text, which contains a bare `@<digits>` token, and
 *   2. `contextInfo.mentionedJid`, a list of JIDs alongside the text.
 *
 * The digits in the text are the JID's local part — and these days that is
 * a LID, not a phone number. So an unprocessed mention renders as
 * `@48688487493799`, which means nothing to anyone reading the thread.
 *
 * Resolving them needs both halves: the token (to find it in the text) and
 * the phone (to find the contact). This module extracts the pairs; the
 * webhook resolves LID → phone and stores the result on the message.
 */

/** One mention, as stored on `messages.mentions`. */
export interface MessageMention {
  /** The `@<token>` as it appears in the text — the JID's local part. */
  token: string
  /** The full JID from contextInfo (`…@lid` or `…@s.whatsapp.net`). */
  jid: string
  /** Normalised phone, once resolved. Null when the LID is still unknown. */
  phone: string | null
}

/** The local part of a JID: `48688487493799@lid` → `48688487493799`. */
export function jidLocalPart(jid: string): string {
  return jid.split('@')[0]!.split(':')[0]!
}

/**
 * Every `mentionedJid` in a Baileys message, deduped and in order.
 *
 * Walks the whole object rather than checking known paths: contextInfo
 * hangs off whichever content field a message happens to use, and nests
 * further for wrappers like documentWithCaptionMessage and ephemeral or
 * view-once envelopes. A walk cannot go stale as those shapes change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractMentionJids(message: any): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const stack = [message]
  // Baileys payloads are plain JSON, but a cyclic object must not hang the
  // webhook. A visited set (rather than a step counter) also means a cycle
  // can't starve the real content by being revisited ahead of it.
  const visited = new WeakSet<object>()

  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (visited.has(node)) continue
    visited.add(node)

    if (Array.isArray(node)) {
      for (const item of node) if (item && typeof item === 'object') stack.push(item)
      continue
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'mentionedJid' && Array.isArray(value)) {
        for (const jid of value) {
          if (typeof jid !== 'string' || !jid.includes('@')) continue
          if (seen.has(jid)) continue
          seen.add(jid)
          found.push(jid)
        }
        continue
      }
      if (value && typeof value === 'object') stack.push(value)
    }
  }

  return found
}

/**
 * Split text into literal runs and `@<digits>` mention tokens.
 *
 * Only digits are treated as a mention: `@all` and `@everyone` are group
 * keywords, not people, and an email address must not be mangled — hence
 * the "not preceded by a word character" rule, which keeps
 * `hi@2348012345678.com`-style text intact.
 *
 * The minimum length keeps ordinary text like "@1" from becoming a link;
 * real tokens are phone- or LID-length.
 */
export function splitMentionTokens(
  text: string,
): Array<{ type: 'text'; value: string } | { type: 'mention'; token: string }> {
  const parts: Array<{ type: 'text'; value: string } | { type: 'mention'; token: string }> = []
  const re = /(^|[^\w@])@(\d{5,})/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text))) {
    const lead = m[1] ?? ''
    const start = m.index + lead.length
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) })
    parts.push({ type: 'mention', token: m[2]! })
    last = start + 1 + m[2]!.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}
