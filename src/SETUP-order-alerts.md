# Order alerts: setup steps

## Part A: In the internal app (dashboard banner + Website Orders page)
1. Copy `internal-app/OrderRequests.jsx` into `src/components/`.
2. Replace `src/App.jsx` and `src/components/Layout.jsx` with the files in `internal-app/`.
3. Run the app. You get: a new "Website Orders" menu item with an amber badge, an amber banner on the
   Executive Dashboard, and a page to see each request and mark it Contacted / Confirmed / Fulfilled / Paid.

## Part B: Telegram alert (works even when the app is closed)
1. Telegram: open your bot, press Start, send it any message.
2. Find your chat ID: open https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates in a browser
   (replace <YOUR_TOKEN> yourself; do not share the link) and copy the number after "chat":{"id":.
3. Supabase > Edge Functions > Create a new function named `notify-order` (Via Editor).
   Paste `supabase/notify-order.ts`, turn OFF "Verify JWT", and Deploy.
4. Supabase > Edge Functions > Secrets, add: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_SECRET (long random text).
5. Supabase > Database > Webhooks > Create:
   - Table: public.order_requests, Event: Insert
   - Type: Supabase Edge Functions > notify-order, Method POST
   - HTTP header: x-webhook-secret = the same WEBHOOK_SECRET
6. Test: send an order request from the website. Telegram should ping within a few seconds.
