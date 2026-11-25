import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, RefreshCw, Phone, Mail, MapPin, StickyNote, BadgeCheck } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, ModalActions, peso } from './ui';

// Website order requests (table order_requests + order_request_lines, created by 37_order_requests.sql)
const STATUSES = ['New', 'Contacted', 'Confirmed', 'Fulfilled', 'Cancelled'];
const OPEN = ['New', 'Contacted', 'Confirmed'];
const TONE = {
  New: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
  Contacted: 'bg-[#1c1916] text-[#e3bf5a] border-[#3a3014]',
  Confirmed: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
  Fulfilled: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
  Cancelled: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
};
const pad = (n) => String(n).padStart(4, '0');
const stamp = (ts) =>
  ts ? new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
const totalOf = (r) => (r.order_request_lines || []).reduce((s, l) => s + Number(l.unit_price) * Number(l.qty), 0);

export default function OrderRequests({ user, onChanged }) {
  const isOwner = user?.role === 'owner';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('open'); // 'new' | 'open' | 'all'
  const [busyId, setBusyId] = useState(null);

  // Mark as paid: records the payment AND the sale in one step
  const [payRow, setPayRow] = useState(null);
  const [payMethod, setPayMethod] = useState('bank');
  const [payRef, setPayRef] = useState('');
  // Mark as unpaid (owner): voids that sale
  const [unpayRow, setUnpayRow] = useState(null);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('order_requests')
      .select('*, order_request_lines(*), sales(sale_no, invoice_no)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (e) setError(e.message);
    else {
      setError('');
      setRows(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // pick up new requests while the page is open
    return () => clearInterval(t);
  }, [load]);

  const update = async (r, patch) => {
    setBusyId(r.id);
    const { error: e } = await supabase.from('order_requests').update(patch).eq('id', r.id);
    setBusyId(null);
    if (e) return setError(e.message);
    await load();
    if (onChanged) onChanged();
  };

  const openPay = (r) => {
    setPayRow(r);
    setPayMethod('bank');
    setPayRef('');
    setFormError('');
  };
  const openUnpay = (r) => {
    setUnpayRow(r);
    setReason('');
    setFormError('');
  };

  const confirmPay = async (e) => {
    e.preventDefault();
    setFormError('');
    if (payMethod === 'bank' && !payRef.trim()) return setFormError('Enter the bank or e-wallet reference number.');
    setSaving(true);
    const { error: err } = await supabase.rpc('mark_order_paid', { p_id: payRow.id, p_method: payMethod, p_reference: payRef.trim() });
    setSaving(false);
    if (err) return setFormError(err.message);
    setPayRow(null);
    await load();
    if (onChanged) onChanged();
  };

  const confirmUnpay = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!reason.trim()) return setFormError('Please give a reason.');
    setSaving(true);
    const { error: err } = await supabase.rpc('mark_order_unpaid', { p_id: unpayRow.id, p_reason: reason.trim() });
    setSaving(false);
    if (err) return setFormError(err.message);
    setUnpayRow(null);
    await load();
    if (onChanged) onChanged();
  };

  const counts = useMemo(() => ({ new: rows.filter((r) => r.status === 'New').length, open: rows.filter((r) => OPEN.includes(r.status)).length }), [rows]);
  const shown = rows.filter((r) => (view === 'new' ? r.status === 'New' : view === 'open' ? OPEN.includes(r.status) : true));

  return (
    <div>
      <PageHeader title="Website Orders" subtitle="Order requests sent from the website. Nothing is charged until you confirm delivery and payment.">
        <button onClick={load} className="cs-btn cs-btn-ghost px-4 py-2.5">
          <RefreshCw className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </PageHeader>

      <ErrorNote>{error}</ErrorNote>

      <div className="flex gap-2 mb-5" role="tablist" aria-label="Order request filters">
        {[['new', 'New', counts.new], ['open', 'Open', counts.open], ['all', 'All', 0]].map(([id, label, n]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border cursor-pointer transition-colors ${view === id ? 'bg-[#1f1b12] text-[#e3bf5a] border-[#3a3014]' : 'text-[#a8a090] border-[#2a2622] hover:bg-[#1a1816]'}`}
          >
            {label}
            {n > 0 && <span className="ml-2 inline-flex min-w-[18px] h-[18px] px-1 rounded-full bg-[#e5a93d] text-[#0e0d0c] text-[10px] font-semibold items-center justify-center">{n}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : shown.length === 0 ? (
        <div className="cs-card">
          <EmptyState icon={Globe} title="No order requests here" text="New requests from the website will appear in this list." />
        </div>
      ) : (
        <div className="space-y-4">
          {shown.map((r) => (
            <div key={r.id} className={`cs-card p-5 ${r.status === 'Cancelled' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <div className="font-mono text-xs text-[#e3bf5a]">WR-{pad(r.request_no)}</div>
                  <div className="font-serif text-lg font-semibold mt-0.5">{r.name}</div>
                  <div className="text-xs text-[#a8a090] mt-0.5">{stamp(r.created_at)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {r.paid && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30">
                      <BadgeCheck className="w-3 h-3" aria-hidden="true" /> Paid
                    </span>
                  )}
                  {r.sales?.invoice_no && (
                    <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-mono border bg-[#1c1916] text-[#e3bf5a] border-[#3a3014]" title="The sale recorded for this order">
                      INV-{String(r.sales.invoice_no).padStart(4, '0')}
                    </span>
                  )}
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${TONE[r.status]}`}>{r.status}</span>
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-[#d9b24c] shrink-0" aria-hidden="true" /><a className="hover:underline" href={`tel:${r.contact_digits}`}>{r.contact}</a></div>
                  {r.email && <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-[#d9b24c] shrink-0" aria-hidden="true" /><a className="hover:underline break-all" href={`mailto:${r.email}`}>{r.email}</a></div>}
                  {r.address && <div className="flex items-start gap-2"><MapPin className="w-4 h-4 text-[#d9b24c] shrink-0 mt-0.5" aria-hidden="true" /><span>{r.address}</span></div>}
                  {r.notes && <div className="flex items-start gap-2"><StickyNote className="w-4 h-4 text-[#d9b24c] shrink-0 mt-0.5" aria-hidden="true" /><span className="text-[#a8a090]">{r.notes}</span></div>}
                  {r.ref_code && <div className="text-xs text-[#a8a090]">Referral code: <span className="font-mono text-[#e3bf5a]">{r.ref_code}</span></div>}
                </div>

                <div>
                  <ul className="divide-y divide-[#24201c] text-sm">
                    {(r.order_request_lines || []).map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
                        <span>{l.perfume_name} <span className="text-[#a8a090]">{Number(l.size_ml)} ml</span> × {l.qty}</span>
                        <span className="font-mono text-xs">{peso(Number(l.unit_price) * Number(l.qty))}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#2a2622] text-sm font-semibold">
                    <span>Total</span>
                    <span className="font-mono text-[#e3bf5a]">{peso(totalOf(r))}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-[#24201c]">
                <label className="cs-label !mb-0 text-xs" htmlFor={`st-${r.id}`}>Status</label>
                <select
                  id={`st-${r.id}`}
                  className="cs-input !w-auto py-2"
                  value={r.status}
                  disabled={busyId === r.id}
                  onChange={(e) => update(r, { status: e.target.value })}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {!r.sale_id && r.status !== 'Cancelled' && (
                  <button disabled={busyId === r.id} onClick={() => openPay(r)} className="cs-btn cs-btn-gold px-4 py-2 text-sm">
                    {r.paid ? 'Record the sale' : 'Mark as paid'}
                  </button>
                )}
                {r.paid && isOwner && (
                  <button disabled={busyId === r.id} onClick={() => openUnpay(r)} className="cs-btn cs-btn-ghost px-4 py-2 text-sm">
                    Mark as unpaid
                  </button>
                )}
                {r.status === 'New' && (
                  <button disabled={busyId === r.id} onClick={() => update(r, { status: 'Contacted' })} className="cs-btn cs-btn-gold px-4 py-2 text-sm">
                    I messaged the customer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- Mark as paid: records the payment and the sale ---------- */}
      {payRow && (
        <Modal title={`Mark WR-${pad(payRow.request_no)} as paid`} onClose={() => setPayRow(null)} wide>
          <form onSubmit={confirmPay}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
              <div className="space-y-4">
                <div>
                  <label htmlFor="op-method" className="cs-label">Paid by</label>
                  <select id="op-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="cs-input px-3 py-2.5">
                    <option value="bank">Bank transfer or e-wallet (GCash, Maya)</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                {payMethod === 'bank' && (
                  <div>
                    <label htmlFor="op-ref" className="cs-label">Reference number</label>
                    <input id="op-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} autoFocus placeholder="From the bank or e-wallet receipt" className="cs-input px-3 py-2.5" />
                  </div>
                )}
                <div className="rounded-xl border border-[#2a2622] bg-[#14120f] p-4 text-xs text-[#a8a090] space-y-1.5">
                  <div className="uppercase tracking-wider">What happens when you confirm</div>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>The customer is matched by mobile number, or added to your Customers list as Retail.</li>
                    <li>The sale is recorded at the prices the customer saw, and an invoice is issued.</li>
                    <li>The pieces leave Finished Goods, oldest stock first.</li>
                    <li>{payMethod === 'cash' ? 'The money goes to Cash.' : 'The money goes to Bank.'} Sales and cost of goods sold are posted.</li>
                    <li>If there is not enough stock, nothing is saved and you will be told which perfume is short.</li>
                  </ul>
                </div>
              </div>
              <div className="rounded-xl border border-[#2a2622] overflow-hidden">
                <div className="px-4 py-3 bg-[#1a1816] border-b border-[#2a2622] text-xs uppercase tracking-wider text-[#a8a090]">{payRow.name}</div>
                <ul className="divide-y divide-[#24201c] text-sm">
                  {(payRow.order_request_lines || []).map((l) => (
                    <li key={l.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <span>{l.perfume_name} <span className="text-[#a8a090]">{Number(l.size_ml)} ml</span> &times; {l.qty}</span>
                      <span className="font-mono text-xs">{peso(Number(l.unit_price) * Number(l.qty))}</span>
                    </li>
                  ))}
                </ul>
                <div className="px-4 py-3 bg-[#14120f] border-t border-[#2a2622] flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[#a8a090]">Amount received</span>
                  <span className="font-mono text-lg text-[#e3bf5a]">{peso(totalOf(payRow))}</span>
                </div>
              </div>
            </div>
            <ModalActions error={formError}>
              <button type="button" onClick={() => setPayRow(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">{saving ? 'Recording...' : 'Confirm payment'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Mark as unpaid (owner): voids the sale ---------- */}
      {unpayRow && (
        <Modal title={`Mark WR-${pad(unpayRow.request_no)} as unpaid`} onClose={() => setUnpayRow(null)}>
          <form onSubmit={confirmUnpay}>
            <p className="text-sm text-[#a8a090] mb-4">
              This voids the sale recorded for this order: the pieces go back to Finished Goods and the books are reversed. The sale stays on record, marked Voided.
            </p>
            <label htmlFor="ou-reason" className="cs-label">Reason</label>
            <input id="ou-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus className="cs-input px-3 py-2.5" />
            <ModalActions error={formError}>
              <button type="button" onClick={() => setUnpayRow(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">{saving ? 'Saving...' : 'Mark as unpaid'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}
