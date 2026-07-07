# Thin derived Evolution image: same published 2.3.7 bundle, patched to
# forward status view receipts (message-receipt.update, incl. the viewer's
# jid) as a webhook event. See patch-receipt.mjs. Pinned to a digest-free
# tag intentionally — rebuild after pulling a new base to re-apply.
FROM evoapicloud/evolution-api:latest

COPY patch-receipt.mjs /tmp/patch-receipt.mjs
RUN node /tmp/patch-receipt.mjs && rm /tmp/patch-receipt.mjs
