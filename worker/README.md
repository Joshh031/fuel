# FUEL reminder worker

Sends the "you haven't logged today" push notifications. The app only ever had
the *receiving* half (service worker + `push_subs` table); this Cloudflare
Worker is the sender.

What it does, hourly:

1. Checks the local time in `America/New_York`. Only acts at the hours in
   `REMIND_HOURS` (default: 12:00 and 20:00).
2. Asks Supabase whether any meal is logged for today. If yes → does nothing.
3. If nothing is logged (and there's been activity in the last 14 days, so an
   abandoned install doesn't get nagged forever), sends a Web Push to every
   subscription in `push_subs`, and prunes subscriptions the push service
   reports as expired (404/410).

## Setup (Cloudflare dashboard, ~10 minutes)

1. **Workers & Pages → Create → Worker.** Name it `fuel-reminders`, paste the
   contents of `reminder-worker.js`, deploy.
2. **Settings → Variables and Secrets**, add:
   | Name | Type | Value |
   |---|---|---|
   | `SB_URL` | text | `https://<project>.supabase.co` (same as index.html) |
   | `SB_KEY` | secret | the Supabase anon key (same as index.html) |
   | `VAPID_PUBLIC_KEY` | text | the exact `VAPID_PUB` string from index.html |
   | `VAPID_PRIVATE_KEY` | secret | the private key from the same VAPID pair |
   | `VAPID_SUBJECT` | text | `mailto:you@example.com` (your contact email) |
   | `TEST_KEY` | secret | any random string, for manual test triggers |
3. **Settings → Triggers → Cron Triggers**, add: `0 * * * *` (hourly — the
   worker itself decides which hours matter, so DST just works).
4. **Test it:** open
   `https://fuel-reminders.<account>.workers.dev/?key=<TEST_KEY>&force=1`
   in a browser. `force=1` skips the hour check. You should get a push on any
   device that has tapped "Enable reminders", and the page shows e.g.
   `sent 1/1`. (If today already has meals logged it reports
   `already logged today` and sends nothing — that's it working.)

## Lost the VAPID private key?

The public half is in `index.html`; the private half only exists wherever you
generated the pair. If you can't find it, generate a fresh pair
(`npx web-push generate-vapid-keys`), put the new public key in `index.html`
(`VAPID_PUB`), the new private key in the worker secret, clear the `push_subs`
table, and tap "Enable reminders" again on each device — old subscriptions are
bound to the old key and won't work.

## Notes

- Tapping the notification opens the app and focuses the meal input
  (`?action=log`).
- iOS only delivers Web Push to the home-screen-installed app, and iOS may
  drop the subscription if notifications are ignored repeatedly — the worker
  prunes those rows automatically; re-enable from the targets sheet (⚙).
- The check is per-database, not per-person: with the current single-user
  schema, "logged today" means anyone logged. When the app grows real user
  accounts, this worker needs the same `user_id` scoping.
- Reminder hours, timezone, and the activity window are constants at the top
  of `reminder-worker.js`.
