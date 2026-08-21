import type { CompanyRoute } from '@/lib/tenancy/routes'

/**
 * What a new workspace gets shown, and in what order.
 *
 * A fresh account opens on a dashboard of zeroes with fourteen things in
 * the sidebar, and none of them do anything until a WhatsApp number is
 * linked. That single dependency is invisible, so the walkthrough exists
 * mainly to make it obvious — everything else is context for why it is
 * worth doing.
 *
 * Content lives here as data rather than inside the component so it can
 * be read, reordered and checked without touching rendering.
 */
export interface GuideStep {
  /** Stable id — used for keys and for tests that pin ordering. */
  id: string
  title: string
  /** One or two sentences. Longer than that and nobody reads it. */
  body: string
  /** Where this step is about, when there is somewhere to go. */
  route?: CompanyRoute
  /** Label for the button that goes there. */
  action?: string
  /**
   * The thing people get wrong, called out separately so it survives
   * skim-reading. Rendered as a distinct block, not another paragraph.
   */
  warning?: string
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: 'Your WhatsApp, run like a business',
    body:
      'Every chat, contact and follow-up in one place — on the WhatsApp number you already use. Nothing here replaces WhatsApp; it sits alongside it.',
  },
  {
    id: 'link-number',
    title: 'Start by linking your number',
    body:
      'Until a number is linked, the rest of the app has nothing to show. Go to Settings, add a number, and a QR code appears.',
    route: 'settings',
    action: 'Link a number',
    // The single most common failure, and the reason this guide exists in
    // the form it does: the code is a pairing token, not a link, so a
    // camera app returns what looks like gibberish and people conclude
    // the QR is broken.
    warning:
      'Scan it from inside WhatsApp — Settings → Linked Devices → Link a Device. Your phone camera will not work: the code is a pairing token, not a web link.',
  },
  {
    id: 'inbox',
    title: 'Everything lands in the Inbox',
    body:
      'Messages arrive here as they do on your phone. The plus button starts a chat with anyone in your contacts, even if they have never messaged you.',
    route: 'inbox',
    action: 'Open the Inbox',
  },
  {
    id: 'business-filter',
    title: 'Separate work from family',
    body:
      'A personal number carries personal chats. Mark the people you do business with, then use the Business filter to hide everything else.',
    route: 'inbox',
    action: 'Try the filter',
  },
  {
    id: 'contacts',
    title: 'Contacts, deals and follow-ups',
    body:
      'Every person you talk to becomes a contact. Move them through a pipeline, set tasks so nothing is forgotten, and keep notes that stay with the conversation.',
    route: 'contacts',
    action: 'See Contacts',
  },
  {
    id: 'reach',
    title: 'Reach people at scale',
    body:
      'Broadcasts send one message to many. The Store keeps your products ready to share, and Status posts to everyone at once.',
    route: 'broadcasts',
    action: 'See Broadcasts',
  },
  {
    id: 'automate',
    title: 'Let it answer without you',
    body:
      'Automations reply to common questions on rules you set. AI Agents go further and hold a conversation — both optional, and off until you turn them on.',
    route: 'automations',
    action: 'See Automations',
  },
  {
    id: 'done',
    title: "That's the tour",
    body:
      'You can reopen this any time from the help menu. If a number is not linked yet, that is the one thing worth doing now.',
    route: 'settings',
    action: 'Go to Settings',
  },
]

/**
 * The setup state a new workspace is actually in.
 *
 * Derived from real rows rather than from what someone clicked through:
 * a checklist that ticks itself because you read a slide is a decoration.
 */
export interface SetupState {
  numberLinked: boolean
  hasConversation: boolean
  hasBusinessContact: boolean
}

export interface SetupTask {
  id: string
  label: string
  done: boolean
  route: CompanyRoute
  /** Shown only while the task is outstanding. */
  hint?: string
}

/**
 * Turn setup state into the checklist.
 *
 * Ordered by dependency, not importance — linking a number first is not a
 * preference, it is the thing the other two cannot happen without.
 */
export function setupTasks(state: SetupState): SetupTask[] {
  return [
    {
      id: 'number',
      label: 'Link a WhatsApp number',
      done: state.numberLinked,
      route: 'settings',
      hint: 'Scan the code from inside WhatsApp → Linked Devices, not with your camera.',
    },
    {
      id: 'conversation',
      label: 'Have your first conversation',
      done: state.hasConversation,
      route: 'inbox',
      hint: state.numberLinked
        ? 'Use the plus button in the Inbox to message someone first.'
        : 'Link a number and your chats appear here.',
    },
    {
      id: 'business',
      label: 'Mark a business contact',
      done: state.hasBusinessContact,
      route: 'inbox',
      hint: 'Open a chat, then turn on “Business contact” to filter out personal ones.',
    },
  ]
}

/** How far through setup, as a fraction — for a progress indicator. */
export function setupProgress(state: SetupState): {
  done: number
  total: number
} {
  const tasks = setupTasks(state)
  return { done: tasks.filter((t) => t.done).length, total: tasks.length }
}
