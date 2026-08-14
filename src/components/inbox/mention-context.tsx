'use client';

import { createContext, useContext } from 'react';

/** A person referred to from inside a message — a mention or a group sender. */
export interface MentionTarget {
  /** Normalised phone, when known. Null for a LID we haven't resolved. */
  phone: string | null;
  /** Best label we have if they aren't a contact yet (pushName, digits). */
  name?: string | null;
}

interface MentionContextValue {
  /** Display label for a mention token — a contact's name where we have one. */
  labelFor: (token: string) => string;
  /** Phone behind a mention token, if resolved. */
  phoneFor: (token: string) => string | null;
  /** Open this person's profile. No-op outside a provider. */
  openProfile: (target: MentionTarget) => void;
}

/**
 * Mentions are rendered deep inside message bubbles but resolved and
 * handled well above them — names come from a per-thread contact lookup,
 * and opening a profile is the inbox page's job. A context keeps those two
 * concerns out of every bubble's prop list.
 *
 * The default is deliberately inert so a bubble rendered outside a thread
 * (previews, tests) still displays rather than throwing.
 */
const MentionContext = createContext<MentionContextValue>({
  labelFor: (token) => token,
  phoneFor: () => null,
  openProfile: () => {},
});

export const MentionProvider = MentionContext.Provider;

export function useMentions(): MentionContextValue {
  return useContext(MentionContext);
}
