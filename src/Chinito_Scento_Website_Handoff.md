# Chinito Scento official website: handoff brief

## Paste this to start the new conversation

> I am continuing a project from another account. I own Chinito Scento, a perfume business in the Philippines (prices in pesos). I already run an internal management system (React + Supabase, deployed on Vercel). I now want the **official public website and customer order portal built as a separate project, deployed separately, not embedded in the internal app**. The full brief is below and I have attached the files it mentions. Please read the brief, then start with the "First tasks" section. Ask me only what you cannot decide yourself.

---

## 1. What exists today

**Internal system (live, do not disturb)**
- React app using Tailwind and lucide-react, with Supabase (Postgres, RLS, SQL functions) as the backend, deployed on Vercel at `cspmss.vercel.app`.
- Covers procurement, maceration, bottling, packaging, finished goods, sales, costing, marketing gifts and accounting.
- Staff log in. Owner-only areas exist (costing, affiliates).

**Already built for the website (in the attached files)**
- `ChinitoSite.jsx`: a single-page public site: header, hero, live collection (from Supabase), about, how to order, a two-column order request form, footer. It was written as a page inside the internal app, so it imports `peso` from `./ui` and the Supabase client from `../supabaseClient`. Both must be replaced in the new project.
- `26_order_requests.sql` and `27_affiliates.sql`: the database side (already designed; to be run in the same Supabase project). Section 3 summarises them.
- Staff pages `OrderRequests.jsx` and `Affiliates.jsx` stay in the **internal** app. They are not part of the public website.

## 2. The decision: a separate website

- New repository and new Vercel project for the public site, on its own domain.
- It talks to the **same Supabase project** using only the public **anon key** and the public SQL functions below. Never put a service role key in the website.
- It must not contain any staff or owner screens, and no login.
- Benefit: the internal system is never at risk when the website changes.

## 3. Database the website uses (already designed)

Public functions, callable by the anon role:
- `public_catalog()` returns rows of `size_id, perfume_name, size_ml, price, in_stock`. Only active, non-discontinued sizes with a price. It exposes only whether a size is in stock, never counts or costs.
- `submit_order_request(p_name, p_contact, p_email, p_address, p_notes, p_items jsonb, p_hp, p_ref)` returns the request number (bigint), or 0 if the hidden spam field was filled.
  - `p_items` is `[{ "size_id": "...", "qty": 2 }]`. Prices are re-checked on the server.
  - `p_hp` is a hidden honeypot field that must stay empty.
  - `p_ref` is the influencer code. An unknown or inactive code is ignored and the order still goes through.
- Errors come back as readable messages (for example "Please enter your name.") and can be shown to the customer.

Tables (not readable by the public): `order_requests`, `order_request_lines`, `affiliates`, `affiliate_commissions`, `affiliate_payouts`.

Order flow: staff set a request to New / Contacted / Confirmed / Delivered (stored as `Fulfilled`) / Cancelled and mark it Paid. A commission is earned when the request is **both Paid and Delivered**: pieces x the influencer's fixed rate per piece (rate kept at that moment). Voided automatically if the request stops being paid and delivered. The owner records payouts in the internal app.

## 4. What the website must do

- **Info pages:** hero, about, how to order, contact. Editable brand text kept in one config block at the top.
- **Collection:** perfumes grouped, with sizes and prices, an Add button, and "Sold out" when `in_stock` is false. Optional one-line scent notes.
- **Order request (not a purchase):** two columns on desktop. Left: name, mobile number (required), email, address, notes. Right: the chosen perfumes with quantity steppers, an estimated total and the Send button. Clear message that nothing is charged online and that delivery and payment are arranged with the customer.
- **Influencer links:** a link looks like `https://<website>/?ref=CODE`.
  - Read `ref` from the address, remember it in `localStorage` for **30 days**, the **latest link wins**, send it as `p_ref`.
  - If storage is blocked, the code still counts for that visit.
- **Spam:** honeypot field is already in the form. Consider adding Cloudflare Turnstile and a server-side limit per phone number.
- **No online payments.** Not explored yet. Payment is arranged by the owner after confirming. Online payment options can be researched later.
- Mobile first (most visitors will arrive from TikTok or Instagram), accessible (labels, focus, contrast), fast.
- Page title, description and share image (Open Graph) so links look good when shared.

## 5. Look and feel (match the internal app)

- Dark, warm, gold. Page background `#0f0e0c`, panels `#14120f` and `#1a1816`, borders `#2a2622`.
- Text `#ece6d8`, muted text `#a8a090`.
- Gold `#d9b24c` and `#e3bf5a`. Green `#3ecf8e`. Red `#e5736d`. Amber `#e5a93d`.
- Serif headings (the internal app uses `font-serif`), clean sans-serif body, monospace for prices and numbers.
- The internal app uses CSS classes `cs-card`, `cs-input`, `cs-label`, `cs-btn`, `cs-btn-gold`, `cs-btn-ghost` which do **not** exist in the new project. Recreate equivalents from the palette above.

## 6. Changes still needed in the internal app

- Do **not** embed `ChinitoSite.jsx` or add a `/shop` route there.
- In `Affiliates.jsx`, set `SITE_URL` to the new website address so influencer links point at it.
- Add the **Order Requests** and **Affiliates** pages to the internal menu.
- Run `26_order_requests.sql`, then `27_affiliates.sql`, in Supabase **before** the website goes live.

## 7. First tasks for the new conversation

1. Choose the stack. Default: Vite + React + Tailwind, reusing `ChinitoSite.jsx` (fastest). Consider Next.js or prerendering later if search ranking matters.
2. Create the project, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and swap the `peso` helper and Supabase import in `ChinitoSite.jsx`.
3. Recreate the styles from section 5 and test the order flow against the real database on a preview deployment.
4. Add meta tags, favicon, and a 404 page. Deploy as a separate Vercel project and connect the domain.

## 8. Open items (owner to provide or decide)

- Domain name and logo.
- Brand wording: tagline, about text, contact details, Facebook, Instagram and TikTok links.
- Product photos. The catalog has no images yet. Adding them would need an image column and a public Supabase Storage bucket.
- Delivery fees and areas, and how long a request stays valid.
- Online payments, later.
- Posting influencer commissions to the accounting books, later.

## 9. How the owner likes things done

- Short, plain explanations. Say what changed and how to install it.
- Forms are wide, in two columns: the left side is for entering data, the right side is a list. Avoid scrolling.
- Search bars use a "Search by" dropdown.
- Deliver full files, tested for syntax where possible. Be honest about what could not be tested.
- Be careful with anything that could affect the live internal system.

## Files to attach in the new conversation

`ChinitoSite.jsx`, `26_order_requests.sql`, `27_affiliates.sql`, and this brief. Optionally `Affiliates.jsx` and `OrderRequests.jsx` for reference.
