// Supabase Edge Function: notify-order
// Triggered by a Database Webhook on INSERT into public.order_requests.
// Sends a Telegram message to the owner with the order details.
//
// Secrets to set (Edge Functions > Secrets), never put these in the website or in chat:
//   TELEGRAM_BOT_TOKEN  from @BotFather
//   TELEGRAM_CHAT_ID    your chat id
//   WEBHOOK_SECRET      any long random text; the webhook sends it in the x-webhook-secret header
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const peso = (n: number) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const rec = payload?.record;
  if (payload?.type !== 'INSERT' || !rec?.id) return new Response('Ignored', { status: 200 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // The items are saved right after the request row, so wait a moment if they are not there yet.
  let lines: any[] = [];
  for (let i = 0; i < 4; i++) {
    const { data } = await db.from('order_request_lines').select('perfume_name,size_ml,unit_price,qty').eq('request_id', rec.id);
    lines = data || [];
    if (lines.length) break;
    await sleep(1500);
  }

  const total = lines.reduce((s, l) => s + Number(l.unit_price) * Number(l.qty), 0);
  const items = lines.length
    ? lines.map((l) => `• ${esc(l.perfume_name)} ${Number(l.size_ml)}ml × ${l.qty}  (${peso(Number(l.unit_price) * Number(l.qty))})`).join('\n')
    : '• (items not loaded, check the app)';

  const text = [
    `🛍 <b>New website order #${esc(rec.request_no)}</b>`,
    '',
    `<b>${esc(rec.name)}</b>`,
    `📞 ${esc(rec.contact)}`,
    rec.email ? `✉️ ${esc(rec.email)}` : '',
    rec.address ? `📍 ${esc(rec.address)}` : '',
    '',
    items,
    '',
    `<b>Total: ${peso(total)}</b>`,
    rec.notes ? `📝 ${esc(rec.notes)}` : '',
    rec.ref_code ? `🔗 Referral: ${esc(rec.ref_code)}` : '',
    '',
    'Message the customer to arrange delivery and payment, then update the status in the app (Website Orders).',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');

  const res = await fetch(`https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: Deno.env.get('TELEGRAM_CHAT_ID'), text, parse_mode: 'HTML' }),
  });

  if (!res.ok) {
    console.error('Telegram error', res.status, await res.text());
    return new Response('Telegram failed', { status: 502 });
  }
  return new Response('OK', { status: 200 });
});
