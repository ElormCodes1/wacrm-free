// Patch the compiled Evolution bundle to forward WhatsApp status view
// receipts. Stock Evolution handles `message-receipt.update` by collapsing
// it to remoteJid->timestamp and discarding receipt.userJid (the viewer),
// and never forwards the event to the webhook. This enables "seen by" for
// our own statuses by:
//   1. emitting the raw receipt payload (incl. userJid) as a
//      `message-receipt.update` webhook event, and
//   2. allowing MESSAGE_RECEIPT_UPDATE in the webhook event enums so the
//      event can be registered via /webhook/set.
//
// Runs at image-build time against the pristine base bundle, so it always
// operates on unpatched source. Fails loudly if an anchor is missing (i.e.
// the upstream bundle changed shape) rather than silently no-op'ing.
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = '/evolution/dist/main.js'
let src = readFileSync(FILE, 'utf8')

if (src.includes('this.sendDataWebhook("message-receipt.update"')) {
  console.log('[evo-patch] already patched — nothing to do')
  process.exit(0)
}

// 1) Forward the receipt payload (with viewer userJid) to the webhook,
//    right where Evolution starts processing message-receipt.update.
const H_FIND = 'let i=e["message-receipt.update"],n={};'
const H_REPL =
  'let i=e["message-receipt.update"];this.sendDataWebhook("message-receipt.update",i);let n={};'
if (!src.includes(H_FIND)) {
  console.error('[evo-patch] FAIL: message-receipt.update handler anchor not found')
  process.exit(1)
}
src = src.replace(H_FIND, H_REPL)

// 2) Allow MESSAGE_RECEIPT_UPDATE wherever MESSAGES_UPDATE appears in the
//    webhook event enums / default event list (quoted, uppercase).
const E_FIND = '"MESSAGES_UPDATE"'
if (!src.includes(E_FIND)) {
  console.error('[evo-patch] FAIL: event enum anchor not found')
  process.exit(1)
}
const before = src.split(E_FIND).length - 1
src = src.split(E_FIND).join('"MESSAGES_UPDATE","MESSAGE_RECEIPT_UPDATE"')

writeFileSync(FILE, src)
console.log(`[evo-patch] OK: forwarding enabled; event allowed in ${before} enum(s)`)
