# Blisscco update: automatic walk-in queue

## Supabase (SQL Editor)
Run `supabase/migrations/0022_auto_queue.sql` BEFORE deploying the new frontend. Safe to re-run. No table, column or RLS change.

## What changed
- Queue positions are computed automatically from the waiting tokens (nothing is set by hand). Skip / cancel / complete -> everyone behind moves up.
- Owner (Queue page): "Run the queue" card with **Start Next**, **Complete**, **Skip**. Each waiting row also shows "No. n in queue" and has Skip / Cancel; the person being served has Complete.
- Customer (My bookings): live card "You are #2 in queue", "Now serving: #5", "You're next!", "It's your turn". Refreshes every 5 s and instantly through realtime when the shop acts on the customer's own token.
- Safe transitions: all queue changes lock the business row first, then re-check the booking row. Double-click or two devices cannot serve the same token twice or serve more people at once than `capacity` (default 1). Errors: `already_serving`, `queue_empty`, `invalid_transition`.
- Appointments, booking, payments, RLS, notifications: unchanged.

## Changed files
- src/pages/owner/OwnerQueue.tsx   (Run the queue card, walk-in row actions, synchronous double-click lock)
- src/pages/MyBookings.tsx   (live queue position card, 5 s refresh + realtime)
- src/lib/types.ts   (QueuePosition)
- src/lib/bookingErrors.ts   (already_serving, queue_empty)
- src/i18n/messages.ts   (new p15 block, EN / HI / MR)
- supabase/RUN_LOG.md, CHANGES.md

## New files
- supabase/migrations/0022_auto_queue.sql
