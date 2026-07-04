/**
 * Shapes + limits for interactive button / list prompts.
 *
 * Originally these lived in the (now-removed) Meta Cloud API client. They
 * describe the flow-builder's button/list node data. On the self-hosted
 * Evolution backend these prompts are rendered as numbered text (native
 * Baileys buttons are unreliable), but the builder still validates against
 * the same limits so flows stay portable.
 */

export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const

export interface InteractiveButton {
  /** Stable id sent back when tapped/selected. */
  id: string
  /** Visible label. */
  title: string
}

export interface InteractiveListRow {
  /** Stable id sent back when the row is selected. */
  id: string
  /** Visible row title. */
  title: string
  /** Optional secondary line shown under the title. */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}
