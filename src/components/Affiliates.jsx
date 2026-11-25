import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, PlusCircle, Copy, Check, Wallet, Ban } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, ModalActions, nz, peso, fmtDate } from './ui';

// Influencer links point at the public website. Once the website is launched on its own address,
// put it here, e.g. 'https://chinitoscento.com'. While empty, links use this app's own /shop page.
const SITE_URL = '';
const linkFor = (code) => `${SITE_URL || `${window.location.origin}/shop`}?ref=${code}`;

const pad = (n) => String(n).padStart(8, '0');
const ordLabel = (n) => `WR-${String(n).padStart(4, '0')}`; // same number format as the Website Orders page
const afpLabel = (n) => `AFP-${pad(n)}`;
const todayLocal = () => new Date().toLocaleDateString('en-CA');
const suggestCode = (name) => name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const METHODS = { cash: 'Cash', bank: 'Bank transfer', gcash: 'GCash', other: 'Other' };

function Badge({ tone, children }) {
  const tones = {
    green: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    amber: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
    red: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
    gray: 'bg-[#1c1916] text-[#a8a090] border-[#2a2622]',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${tones[tone]}`}>{children}</span>;
}

function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-2 mb-5 border-b border-[#2a2622]" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-sm cursor-pointer border-b-2 -mb-px transition-colors ${
            value === t.id ? 'border-[#d9b24c] text-[#e3bf5a]' : 'border-transparent text-[#a8a090] hover:text-[#ece6d8]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="cs-card p-5">
      <div className="text-[11px] font-medium text-[#a8a090] uppercase tracking-wider mb-2">{label}</div>
      <div className={`font-serif text-xl xl:text-2xl font-semibold ${tone || ''}`}>{value}</div>
    </div>
  );
}

function CopyButton({ text, label = 'Copy link' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link:', text);
    }
  };
  return (
    <button type="button" onClick={copy} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
      {copied ? <Check className="w-3.5 h-3.5 text-[#3ecf8e]" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

export default function Affiliates({ user }) {
  const isOwner = user?.role === 'owner';
  const [tab, setTab] = useState('influencers');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [affiliates, setAffiliates] = useState([]);
  const [summary, setSummary] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [payouts, setPayouts] = useState([]);

  // influencer form
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [fName, setFName] = useState('');
  const [fCode, setFCode] = useState('');
  const [fContact, setFContact] = useState('');
  const [fRate, setFRate] = useState('');
  const [fStatus, setFStatus] = useState('Active');
  const [fNotes, setFNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // payout form
  const [payOpen, setPayOpen] = useState(false);
  const [payAff, setPayAff] = useState('');
  const [payDate, setPayDate] = useState(todayLocal());
  const [payMethod, setPayMethod] = useState('gcash');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [unchecked, setUnchecked] = useState({});
  const [payError, setPayError] = useState('');

  // void payout
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [a, s, c, p] = await Promise.all([
      supabase.from('affiliates').select('*').order('name'),
      supabase.rpc('affiliate_summary'),
      supabase
        .from('affiliate_commissions')
        .select('*, order_requests(request_no, name), affiliate_payouts(payout_no)')
        .order('earned_at', { ascending: false })
        .limit(500),
      supabase.from('affiliate_payouts').select('*, affiliates(name, code)').order('payout_no', { ascending: false }).limit(200),
    ]);
    const err = [a, s, c, p].find((r) => r.error);
    if (err) setError(err.error.message);
    setAffiliates(a.data || []);
    setSummary(s.data || []);
    setCommissions(c.data || []);
    setPayouts(p.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  const sumById = useMemo(() => new Map(summary.map((s) => [s.affiliate_id, s])), [summary]);
  const affById = useMemo(() => new Map(affiliates.map((a) => [a.id, a])), [affiliates]);
  const totals = useMemo(
    () => ({
      earned: summary.reduce((s, r) => s + Number(r.earned), 0),
      paid: summary.reduce((s, r) => s + Number(r.paid), 0),
      balance: summary.reduce((s, r) => s + Number(r.balance), 0),
    }),
    [summary]
  );

  // ---------- influencers ----------
  const openForm = (a) => {
    setEditId(a?.id || null);
    setFName(a?.name || '');
    setFCode(a?.code || '');
    setFContact(a?.contact || '');
    setFRate(a ? String(a.rate_per_piece) : '');
    setFStatus(a?.status || 'Active');
    setFNotes(a?.notes || '');
    setFormError('');
    setFormOpen(true);
  };

  const saveAffiliate = async (e) => {
    e.preventDefault();
    setFormError('');
    const code = fCode.trim().toUpperCase();
    const rate = Number(fRate);
    if (!fName.trim()) return setFormError('Enter the influencer\u2019s name.');
    if (!/^[A-Z0-9]{3,20}$/.test(code)) return setFormError('The code must be 3 to 20 letters or numbers, with no spaces.');
    if (!(rate >= 0) || fRate === '') return setFormError('Enter the commission per piece.');
    setSaving(true);
    const row = { name: fName.trim(), contact: nz(fContact), rate_per_piece: rate, status: fStatus, notes: nz(fNotes) };
    const { error: err } = editId ? await supabase.from('affiliates').update(row).eq('id', editId) : await supabase.from('affiliates').insert({ ...row, code });
    setSaving(false);
    if (err) return setFormError(err.code === '23505' ? 'That code is already used by another influencer.' : err.message);
    setFormOpen(false);
    await load();
  };

  // ---------- payouts ----------
  const unpaidFor = (id) => commissions.filter((c) => c.affiliate_id === id && c.status === 'Earned' && !c.payout_id);
  const payRows = payAff ? unpaidFor(payAff) : [];
  const picked = payRows.filter((c) => !unchecked[c.id]);
  const payTotal = picked.reduce((s, c) => s + Number(c.amount), 0);

  const openPay = (affId) => {
    const first = affId || summary.find((s) => Number(s.balance) > 0)?.affiliate_id || '';
    setPayAff(first);
    setUnchecked({});
    setPayDate(todayLocal());
    setPayMethod('gcash');
    setPayRef('');
    setPayNotes('');
    setPayError('');
    setPayOpen(true);
  };

  const savePayout = async (e) => {
    e.preventDefault();
    setPayError('');
    if (!payAff) return setPayError('Choose the influencer.');
    if (picked.length === 0) return setPayError('Select at least one commission to pay.');
    setSaving(true);
    const { error: err } = await supabase.rpc('record_affiliate_payout', {
      p_affiliate: payAff,
      p_date: payDate,
      p_method: payMethod,
      p_reference: payRef,
      p_notes: payNotes,
      p_commission_ids: picked.map((c) => c.id),
    });
    setSaving(false);
    if (err) return setPayError(err.message);
    setPayOpen(false);
    setTab('payouts');
    await load();
  };

  const voidPayout = async (e) => {
    e.preventDefault();
    setVoidError('');
    if (!reason.trim()) return setVoidError('Please give a reason.');
    setSaving(true);
    const { error: err } = await supabase.rpc('void_affiliate_payout', { p_id: voiding.id, p_reason: reason.trim() });
    setSaving(false);
    if (err) return setVoidError(err.message);
    setVoiding(null);
    await load();
  };

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Affiliates" subtitle="Influencer links, commissions and payouts" />
        <p className="text-sm text-[#a8a090]">Only the owner can see affiliates.</p>
      </div>
    );
  }

  const th = 'px-4 py-3 font-medium';

  return (
    <div>
      <PageHeader title="Affiliates" subtitle="Influencers earn a fixed amount for each piece sold through their link, once the order is paid and delivered">
        <button onClick={() => openPay('')} className="cs-btn cs-btn-ghost px-4 py-2.5">
          <Wallet className="w-4 h-4" aria-hidden="true" />
          <span>Record payout</span>
        </button>
        <button onClick={() => openForm(null)} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Add influencer</span>
        </button>
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'influencers', label: 'Influencers' },
          { id: 'commissions', label: 'Commissions' },
          { id: 'payouts', label: 'Payouts' },
        ]}
      />

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : tab === 'influencers' ? (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <Stat label="Commission earned" value={peso(totals.earned)} />
            <Stat label="Paid out" value={peso(totals.paid)} tone="text-[#3ecf8e]" />
            <Stat label="Still owed to influencers" value={peso(totals.balance)} tone={totals.balance > 0 ? 'text-[#e5a93d]' : ''} />
          </section>
          <div className="cs-card overflow-hidden">
            {affiliates.length === 0 ? (
              <EmptyState icon={Users} title="No influencers yet" text="Add an influencer to get their personal link." actionLabel="Add influencer" onAction={() => openForm(null)} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                    <tr>
                      <th className={th}>Influencer</th>
                      <th className={`${th} text-right`}>Per piece</th>
                      <th className={`${th} text-right`}>Orders waiting</th>
                      <th className={`${th} text-right`}>Pieces earned on</th>
                      <th className={`${th} text-right`}>Earned</th>
                      <th className={`${th} text-right`}>Paid out</th>
                      <th className={`${th} text-right`}>Owed</th>
                      <th className={th}>Link</th>
                      <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {affiliates.map((a) => {
                      const s = sumById.get(a.id) || {};
                      return (
                        <tr key={a.id} className="hover:bg-[#1c1916] transition-colors">
                          <td className="px-4 py-3">
                            {a.name} {a.status === 'Inactive' && <Badge tone="gray">Inactive</Badge>}
                            <div className="font-mono text-xs text-[#e3bf5a]">{a.code}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{peso(a.rate_per_piece)}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs">{s.orders_pending ?? 0}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs">{s.pieces ?? 0}</td>
                          <td className="px-4 py-3 text-right font-mono">{peso(s.earned || 0)}</td>
                          <td className="px-4 py-3 text-right font-mono text-[#3ecf8e]">{peso(s.paid || 0)}</td>
                          <td className={`px-4 py-3 text-right font-mono ${Number(s.balance) > 0 ? 'text-[#e5a93d]' : ''}`}>{peso(s.balance || 0)}</td>
                          <td className="px-4 py-3"><CopyButton text={linkFor(a.code)} /></td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button onClick={() => openForm(a)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs mr-2">Edit</button>
                            {Number(s.balance) > 0 && (
                              <button onClick={() => openPay(a.id)} className="cs-btn cs-btn-gold px-3 py-1.5 text-xs">Pay</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : tab === 'commissions' ? (
        <div className="cs-card overflow-hidden">
          {commissions.length === 0 ? (
            <EmptyState icon={Wallet} title="No commissions yet" text="A commission appears when an order from an influencer's link is marked Fulfilled and Paid." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className={th}>Order</th>
                    <th className={th}>Influencer</th>
                    <th className={th}>Customer</th>
                    <th className={`${th} text-right`}>Pieces</th>
                    <th className={`${th} text-right`}>Rate</th>
                    <th className={`${th} text-right`}>Commission</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {commissions.map((c) => {
                    const a = affById.get(c.affiliate_id);
                    return (
                      <tr key={c.id} className="hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a]">
                          {c.order_requests ? ordLabel(c.order_requests.request_no) : '-'}
                          <div className="text-[#a8a090]">{fmtDate(new Date(c.earned_at).toLocaleDateString('en-CA'))}</div>
                        </td>
                        <td className="px-4 py-3">{a?.name || '-'}<div className="font-mono text-xs text-[#a8a090]">{a?.code}</div></td>
                        <td className="px-4 py-3 text-xs">{c.order_requests?.name}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{c.pieces}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{peso(c.rate_per_piece)}</td>
                        <td className="px-4 py-3 text-right font-mono">{peso(c.amount)}</td>
                        <td className="px-4 py-3">
                          {c.status === 'Voided' ? (
                            <Badge tone="red">Voided</Badge>
                          ) : c.payout_id ? (
                            <Badge tone="green">Paid {c.affiliate_payouts ? afpLabel(c.affiliate_payouts.payout_no) : ''}</Badge>
                          ) : (
                            <Badge tone="amber">Unpaid</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="cs-card overflow-hidden">
          {payouts.length === 0 ? (
            <EmptyState icon={Wallet} title="No payouts yet" text="Payouts you record to influencers will be listed here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className={th}>Payout</th>
                    <th className={th}>Influencer</th>
                    <th className={th}>Paid by</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {payouts.map((p) => (
                    <tr key={p.id} className="hover:bg-[#1c1916] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a]">
                        {afpLabel(p.payout_no)}
                        <div className="text-[#a8a090]">{fmtDate(p.pay_date)}</div>
                      </td>
                      <td className="px-4 py-3">{p.affiliates?.name}<div className="font-mono text-xs text-[#a8a090]">{p.affiliates?.code}</div></td>
                      <td className="px-4 py-3 text-xs">{METHODS[p.method]}{p.reference && <div className="text-[#a8a090]">{p.reference}</div>}</td>
                      <td className="px-4 py-3">
                        <Badge tone={p.status === 'Posted' ? 'green' : 'red'}>{p.status}</Badge>
                        {p.void_reason && <div className="text-[10px] text-[#a8a090] mt-1">{p.void_reason}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{peso(p.amount)}</td>
                      <td className="px-4 py-3 text-right">
                        {p.status === 'Posted' && (
                          <button onClick={() => { setVoiding(p); setReason(''); setVoidError(''); }} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
                            <Ban className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                            <span>Void</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- Add / edit influencer ---------- */}
      {formOpen && (
        <Modal title={editId ? 'Edit influencer' : 'Add influencer'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={saveAffiliate}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="af-name" className="cs-label">Name</label>
                    <input
                      id="af-name"
                      value={fName}
                      onChange={(e) => {
                        setFName(e.target.value);
                        if (!editId && (!fCode || fCode === suggestCode(fName))) setFCode(suggestCode(e.target.value));
                      }}
                      autoFocus
                      className="cs-input px-3 py-2.5"
                    />
                  </div>
                  <div>
                    <label htmlFor="af-code" className="cs-label">Code</label>
                    <input
                      id="af-code"
                      value={fCode}
                      onChange={(e) => setFCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      disabled={!!editId}
                      maxLength={20}
                      className="cs-input px-3 py-2.5 font-mono disabled:opacity-60"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="af-rate" className="cs-label">Commission per piece (&#8369;)</label>
                    <input id="af-rate" type="number" min="0" step="0.01" value={fRate} onChange={(e) => setFRate(e.target.value)} className="cs-input px-3 py-2.5 text-right" />
                  </div>
                  <div>
                    <label htmlFor="af-status" className="cs-label">Status</label>
                    <select id="af-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="cs-input px-3 py-2.5">
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="af-contact" className="cs-label">Contact (optional)</label>
                  <input id="af-contact" value={fContact} onChange={(e) => setFContact(e.target.value)} placeholder="Mobile number, TikTok or Instagram handle" className="cs-input px-3 py-2.5" />
                </div>
                <div>
                  <label htmlFor="af-notes" className="cs-label">Notes (optional)</label>
                  <input id="af-notes" value={fNotes} onChange={(e) => setFNotes(e.target.value)} className="cs-input px-3 py-2.5" />
                </div>
              </div>

              <div className="rounded-xl border border-[#2a2622] bg-[#14120f] p-5 space-y-3">
                <div className="text-xs uppercase tracking-wider text-[#a8a090]">Their link</div>
                <div className="font-mono text-xs break-all rounded-lg border border-[#2a2622] px-3 py-2.5 min-h-[2.5rem]">
                  {/^[A-Z0-9]{3,20}$/.test(fCode) ? linkFor(fCode) : <span className="text-[#a8a090]">Enter a name and a code of at least 3 letters or numbers</span>}
                </div>
                {/^[A-Z0-9]{3,20}$/.test(fCode) && <CopyButton text={linkFor(fCode)} />}
                <ul className="text-xs text-[#a8a090] list-disc pl-4 space-y-1.5 pt-1">
                  <li>They share this link with their followers. Anything ordered after opening it is credited to them.</li>
                  <li>The link is remembered for 30 days on the customer&rsquo;s phone.</li>
                  <li>The commission is {fRate ? peso(Number(fRate) || 0) : 'the amount you set'} for each piece, earned automatically once the order is marked Fulfilled and Paid.</li>
                  <li>The code cannot be changed after saving, because links already shared would stop working. Set the influencer to Inactive to stop new orders counting.</li>
                </ul>
              </div>
            </div>
            <ModalActions error={formError}>
              <button type="button" onClick={() => setFormOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Record payout ---------- */}
      {payOpen && (
        <Modal title="Record payout to influencer" onClose={() => setPayOpen(false)} wide>
          <form onSubmit={savePayout}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
              <div className="space-y-4">
                <div>
                  <label htmlFor="ap-aff" className="cs-label">Influencer</label>
                  <select id="ap-aff" value={payAff} onChange={(e) => { setPayAff(e.target.value); setUnchecked({}); }} className="cs-input px-3 py-2.5">
                    <option value="">Choose influencer</option>
                    {affiliates.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.code}) - owed {peso(sumById.get(a.id)?.balance || 0)}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="ap-date" className="cs-label">Date paid</label>
                    <input id="ap-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required className="cs-input px-3 py-2.5" />
                  </div>
                  <div>
                    <label htmlFor="ap-method" className="cs-label">Paid by</label>
                    <select id="ap-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="cs-input px-3 py-2.5">
                      {Object.entries(METHODS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="ap-ref" className="cs-label">Reference (optional)</label>
                  <input id="ap-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="e.g. GCash reference number" className="cs-input px-3 py-2.5" />
                </div>
                <div>
                  <label htmlFor="ap-notes" className="cs-label">Notes (optional)</label>
                  <input id="ap-notes" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} className="cs-input px-3 py-2.5" />
                </div>
              </div>

              <div className="rounded-xl border border-[#2a2622] overflow-hidden">
                <div className="px-4 py-3 bg-[#1a1816] border-b border-[#2a2622] flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[#a8a090]">Unpaid commissions</span>
                  {payRows.length > 0 && (
                    <button type="button" onClick={() => setUnchecked(picked.length === payRows.length ? Object.fromEntries(payRows.map((c) => [c.id, true])) : {})} className="text-[11px] text-[#e3bf5a] hover:underline cursor-pointer">
                      {picked.length === payRows.length ? 'Clear all' : 'Select all'}
                    </button>
                  )}
                </div>
                {!payAff ? (
                  <p className="px-4 py-8 text-center text-sm text-[#a8a090]">Choose an influencer to see what is owed.</p>
                ) : payRows.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-[#a8a090]">Nothing unpaid for this influencer.</p>
                ) : (
                  <ul className="divide-y divide-[#24201c]">
                    {payRows.map((c) => (
                      <li key={c.id}>
                        <label className="px-4 py-2.5 flex items-center gap-3 text-sm cursor-pointer hover:bg-[#1c1916]">
                          <input type="checkbox" checked={!unchecked[c.id]} onChange={(e) => setUnchecked((u) => ({ ...u, [c.id]: !e.target.checked }))} className="accent-[#d9b24c] w-4 h-4" />
                          <span className="flex-1 min-w-0">
                            <span className="font-mono text-xs text-[#e3bf5a]">{c.order_requests ? ordLabel(c.order_requests.request_no) : ''}</span>
                            <span className="text-xs text-[#a8a090]"> · {c.pieces} pcs &times; {peso(c.rate_per_piece)}</span>
                          </span>
                          <span className="font-mono">{peso(c.amount)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="px-4 py-3 bg-[#14120f] border-t border-[#2a2622] flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[#a8a090]">Payout total</span>
                  <span className="font-mono text-lg text-[#e3bf5a]">{peso(payTotal)}</span>
                </div>
              </div>
            </div>
            <ModalActions error={payError}>
              <button type="button" onClick={() => setPayOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving || picked.length === 0} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">{saving ? 'Saving...' : 'Record payout'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Void payout ---------- */}
      {voiding && (
        <Modal title={`Void ${afpLabel(voiding.payout_no)}`} onClose={() => setVoiding(null)}>
          <form onSubmit={voidPayout}>
            <p className="text-sm text-[#a8a090] mb-4">
              This cancels the payout of {peso(voiding.amount)} and puts those commissions back as unpaid. The payout stays on record, marked Voided.
            </p>
            <label htmlFor="vp-reason" className="cs-label">Reason</label>
            <input id="vp-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus className="cs-input px-3 py-2.5" />
            <ModalActions error={voidError}>
              <button type="button" onClick={() => setVoiding(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">{saving ? 'Voiding...' : 'Void payout'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}
