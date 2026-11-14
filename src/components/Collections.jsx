import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, Receipt, FileText, Printer, Ban, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso, fmtDate, ModalActions, STICKY_TH, STICKY_TD } from './ui';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const pad = (n) => String(n ?? 0).padStart(8, '0');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const daysUntil = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(`${todayLocal()}T00:00:00`)) / 86400000);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const METHOD = { cash: 'Cash', bank: 'Bank transfer' };

// How late an invoice is, in days (0 or less means not yet due)
const daysLate = (due) => (due ? -daysUntil(due) : 0);
const BUCKETS = [
  ['current', 'Not yet due'],
  ['d30', '1-30 days late'],
  ['d60', '31-60 days late'],
  ['d90', '61-90 days late'],
  ['d90p', 'Over 90 days late'],
];
const bucketOf = (due) => {
  const d = daysLate(due);
  if (d <= 0) return 'current';
  if (d <= 30) return 'd30';
  if (d <= 60) return 'd60';
  if (d <= 90) return 'd90';
  return 'd90p';
};
const emptyAging = () => ({ current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 });

function Badge({ tone, children }) {
  const tones = {
    green: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    amber: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
    red: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
    gray: 'bg-[#1c1916] text-[#a8a090] border-[#2a2622]',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

function Stat({ label, value, tone, hint }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">{label}</div>
      <div className={`font-mono ${tone || ''}`}>{value}</div>
      {hint && <div className="text-[10px] text-[#a8a090] mt-0.5">{hint}</div>}
    </div>
  );
}

function invoiceTag(i) {
  if (i.pay_status === 'Partial') return <Badge tone="amber">Partly paid</Badge>;
  return <Badge tone="gray">Unpaid</Badge>;
}

function lateText(due) {
  if (!due) return <span className="text-[#a8a090]">No due date</span>;
  const left = daysUntil(due);
  if (left < 0) return <span className="text-[#e5736d]">{-left} day{left === -1 ? '' : 's'} overdue</span>;
  if (left === 0) return <span className="text-[#e5a93d]">Due today</span>;
  return <span className="text-[#a8a090]">in {left} day{left === 1 ? '' : 's'}</span>;
}

// Opens a clean print window for a receipt or statement
function printDoc(title, body) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) {
    window.alert('Please allow pop-ups to print.');
    return;
  }
  w.document.write(
    `<!doctype html><html><head><title>${esc(title)}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:32px;max-width:760px;margin:auto}
      h1{font-size:22px;margin:0}
      h2{font-size:14px;margin:24px 0 0}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border-bottom:1px solid #ccc;padding:7px 8px;text-align:left;font-size:12px}
      th{background:#f3f3f3}
      .r{text-align:right}
      .meta{display:flex;justify-content:space-between;gap:24px;margin-top:16px;font-size:13px;line-height:1.6}
      .total{text-align:right;font-weight:bold;margin-top:12px;font-size:15px}
      .sig{display:flex;justify-content:space-between;margin-top:64px;font-size:12px}
      .sig div{border-top:1px solid #111;width:40%;text-align:center;padding-top:4px}
      .sub{font-size:12px;color:#555}
      .box{border:1px solid #ccc;padding:10px 12px;margin-top:16px;font-size:12px}
    </style></head><body>${body}</body></html>`
  );
  w.document.close();
  w.focus();
  w.print();
}

export default function Collections({ user, onChanged }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('collectibles');
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]); // credit_invoice_balances
  const [payments, setPayments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  // collectibles
  const [open, setOpen] = useState({}); // expanded customers
  const [overdueOnly, setOverdueOnly] = useState(false);

  // ledger / statement
  const [stCust, setStCust] = useState('');
  const [stFrom, setStFrom] = useState('');
  const [stTo, setStTo] = useState('');
  const [ledger, setLedger] = useState([]);

  // record payment
  const [pOpen, setPOpen] = useState(false);
  const [pf, setPf] = useState({ customer: '', method: 'cash', date: todayLocal(), amount: '', reference: '', notes: '', alloc: {}, refundExcess: false });
  const [pError, setPError] = useState('');

  // receipt, void
  const [receiptId, setReceiptId] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const res = await Promise.all([
      supabase.from('customers').select('id, name, address, status').order('name'),
      supabase.from('credit_invoice_balances').select('*').order('due_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('customer_payments')
        .select('*, customers(name, address), customer_payment_allocations(amount, sale_id, sales(invoice_no))')
        .order('payment_no', { ascending: false })
        .limit(300),
    ]);
    const err = res.find((r) => r.error);
    if (err) setLoadError(err.error.message);
    setCustomers(res[0].data || []);
    setInvoices(res[1].data || []);
    setPayments(res[2].data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // the ledger of the customer chosen on the Ledger tab
  useEffect(() => {
    if (!stCust) {
      setLedger([]);
      return undefined;
    }
    let live = true;
    supabase
      .from('customer_ledger')
      .select('*')
      .eq('customer_id', stCust)
      .order('entry_date', { ascending: true })
      .order('ord', { ascending: true })
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setLoadError(error.message);
        setLedger(data || []);
      });
    return () => {
      live = false;
    };
  }, [stCust, version]);

  const afterChange = async () => {
    setVersion((v) => v + 1);
    await load();
    onChanged && onChanged();
  };

  const custById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  const custName = (id) => custById[id]?.name || 'Customer';
  const owing = useMemo(() => invoices.filter((i) => Number(i.balance) > 0), [invoices]);

  // ---------- collectibles ----------
  const groups = useMemo(() => {
    const m = {};
    owing.forEach((i) => {
      const g = (m[i.customer_id] = m[i.customer_id] || { customer_id: i.customer_id, items: [], balance: 0, overdue: 0, worst: 0, aging: emptyAging() });
      const bal = Number(i.balance);
      g.items.push(i);
      g.balance += bal;
      g.aging[bucketOf(i.due_date)] += bal;
      const late = daysLate(i.due_date);
      if (late > 0) {
        g.overdue += bal;
        g.worst = Math.max(g.worst, late);
      }
    });
    return Object.values(m)
      .map((g) => ({ ...g, name: custName(g.customer_id) }))
      .filter((g) => !overdueOnly || g.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owing, custById, overdueOnly]);

  const totals = useMemo(() => {
    const t = { balance: 0, overdue: 0, week: 0, customers: new Set() };
    owing.forEach((i) => {
      const bal = Number(i.balance);
      t.balance += bal;
      t.customers.add(i.customer_id);
      if (daysLate(i.due_date) > 0) t.overdue += bal;
      else if (i.due_date && daysUntil(i.due_date) <= 7) t.week += bal;
    });
    return { ...t, customers: t.customers.size };
  }, [owing]);

  // ---------- record payment ----------
  const payInvoices = useMemo(
    () =>
      owing
        .filter((i) => i.customer_id === pf.customer)
        .sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') || a.invoice_no - b.invoice_no),
    [owing, pf.customer]
  );
  const payOwed = r2(payInvoices.reduce((s, i) => s + Number(i.balance), 0));
  const fifo = (amount, list) => {
    let left = r2(amount);
    const out = {};
    list.forEach((i) => {
      const take = Math.min(left, Number(i.balance));
      if (take > 0) {
        out[i.sale_id] = String(r2(take));
        left = r2(left - take);
      }
    });
    return out;
  };

  const openPayment = (customerId = '') => {
    setPf({ customer: customerId, method: 'cash', date: todayLocal(), amount: '', reference: '', notes: '', alloc: {}, refundExcess: false });
    setPError('');
    setPOpen(true);
  };
  const pickCustomer = (id) => setPf((p) => ({ ...p, customer: id, amount: '', alloc: {}, refundExcess: false }));
  const setAmount = (v) =>
    setPf((p) => {
      const list = owing
        .filter((i) => i.customer_id === p.customer)
        .sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') || a.invoice_no - b.invoice_no);
      return { ...p, amount: v, alloc: fifo(Number(v) || 0, list), refundExcess: false };
    });
  const setApply = (saleId, v) => setPf((p) => ({ ...p, alloc: { ...p.alloc, [saleId]: v } }));

  const received = r2(pf.amount);
  const applied = r2(payInvoices.reduce((s, i) => s + (Number(pf.alloc[i.sale_id]) || 0), 0));
  const excess = r2(received - applied);
  const overApplied = payInvoices.some((i) => (Number(pf.alloc[i.sale_id]) || 0) > Number(i.balance) + 0.001);
  const isBank = pf.method === 'bank';
  const allCovered = applied >= payOwed - 0.001;

  let payProblem = '';
  if (!pf.customer) payProblem = 'Choose the customer.';
  else if (!(received > 0)) payProblem = 'Enter the amount received.';
  else if (overApplied) payProblem = 'An invoice cannot be paid more than its balance.';
  else if (excess < -0.001) payProblem = 'You applied more than you received.';
  else if (applied <= 0) payProblem = 'Apply the payment to at least one invoice.';
  else if (excess > 0.001 && !isBank) payProblem = `Cash overpayments are not accepted, and no customer credit is kept. Take only ${peso(payOwed)}.`;
  else if (excess > 0.001 && !allCovered) payProblem = 'Settle every open invoice first. Only a true overpayment can be refunded.';
  else if (excess > 0.001 && !pf.refundExcess) payProblem = `Confirm that the excess of ${peso(excess)} is refunded by bank transfer.`;
  else if (isBank && !pf.reference.trim()) payProblem = 'Enter the bank transfer reference number.';

  const savePayment = async (e) => {
    e.preventDefault();
    if (payProblem) return setPError(payProblem);
    setSaving(true);
    setPError('');
    const allocations = payInvoices
      .map((i) => ({ sale_id: i.sale_id, amount: r2(pf.alloc[i.sale_id]) }))
      .filter((a) => a.amount > 0);
    const { data, error } = await supabase.rpc('record_customer_payment', {
      p_date: pf.date || todayLocal(),
      p_customer: pf.customer,
      p_method: pf.method,
      p_amount: received,
      p_reference: nz(pf.reference),
      p_notes: nz(pf.notes),
      p_allocations: allocations,
      p_refund_excess: excess > 0.001 && isBank && pf.refundExcess,
    });
    setSaving(false);
    if (error) return setPError(error.message);
    setPOpen(false);
    await afterChange();
    if (data) setReceiptId(data);
  };

  // ---------- void ----------
  const doVoid = async (e) => {
    e.preventDefault();
    if (!voidReason.trim()) return setVoidError('Please give a reason.');
    setSaving(true);
    setVoidError('');
    const { error } = await supabase.rpc('void_customer_payment', { p_id: voiding.id, p_reason: voidReason.trim() });
    setSaving(false);
    if (error) return setVoidError(error.message);
    setVoiding(null);
    await afterChange();
  };

  // ---------- receipt ----------
  const receipt = payments.find((p) => p.id === receiptId);
  const allocText = (p) => (p.customer_payment_allocations || []).map((a) => ({ inv: `INV-${pad(a.sales?.invoice_no)}`, amount: a.amount }));
  const printReceipt = (p) =>
    printDoc(
      `PR-${pad(p.payment_no)}`,
      `<h1>Chinito Scento</h1><div class="sub">Payment Receipt</div>
       <div class="meta">
         <div><strong>PR-${pad(p.payment_no)}</strong><br>Date: ${esc(fmtDate(p.payment_date))}<br>Method: ${esc(METHOD[p.method])}${p.reference ? `<br>Reference: ${esc(p.reference)}` : ''}</div>
         <div><strong>${esc(p.customers?.name || '')}</strong><br>${esc(p.customers?.address || '')}</div>
       </div>
       <table><thead><tr><th>Applied to</th><th class="r">Amount</th></tr></thead><tbody>
       ${allocText(p).map((a) => `<tr><td>${esc(a.inv)}</td><td class="r">${esc(peso(a.amount))}</td></tr>`).join('')}
       </tbody></table>
       <div class="total">Amount received: ${esc(peso(p.amount))}</div>
       ${Number(p.excess_refunded) > 0 ? `<p class="sub" style="text-align:right">Of which ${esc(peso(p.excess_refunded))} was returned to the customer by bank transfer (overpayment). Applied to invoices: ${esc(peso(p.applied))}.</p>` : ''}
       ${p.status === 'Voided' ? '<p class="sub"><strong>VOIDED</strong></p>' : ''}
       <div class="sig"><div>Customer</div><div>Received by</div></div>`
    );

  // ---------- ledger / statement ----------
  const stView = useMemo(() => {
    const before = stFrom ? ledger.filter((r) => r.entry_date < stFrom) : [];
    const opening = before.length ? Number(before[before.length - 1].balance) : 0;
    const rows = ledger.filter((r) => (!stFrom || r.entry_date >= stFrom) && (!stTo || r.entry_date <= stTo));
    const charges = r2(rows.reduce((s, r) => s + Number(r.debit), 0));
    const credits = r2(rows.reduce((s, r) => s + Number(r.credit), 0));
    return { opening: r2(opening), rows, charges, credits, closing: r2(opening + charges - credits) };
  }, [ledger, stFrom, stTo]);

  const stOpen = useMemo(
    () => owing.filter((i) => i.customer_id === stCust).sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31')),
    [owing, stCust]
  );
  const stAging = useMemo(() => {
    const a = emptyAging();
    stOpen.forEach((i) => {
      a[bucketOf(i.due_date)] += Number(i.balance);
    });
    return a;
  }, [stOpen]);
  const stOwed = r2(stOpen.reduce((s, i) => s + Number(i.balance), 0));
  const stCustomer = custById[stCust];

  const printStatement = () => {
    const c = stCustomer;
    printDoc(
      `Statement - ${c?.name || ''}`,
      `<h1>Chinito Scento</h1><div class="sub">Statement of Account</div>
       <div class="meta">
         <div><strong>${esc(c?.name || '')}</strong><br>${esc(c?.address || '')}</div>
         <div>Statement date: ${esc(fmtDate(todayLocal()))}<br>Period: ${esc(stFrom ? fmtDate(stFrom) : 'Beginning')} to ${esc(stTo ? fmtDate(stTo) : fmtDate(todayLocal()))}</div>
       </div>
       <div class="box"><strong>Amount due now: ${esc(peso(stOwed))}</strong><br>
         ${BUCKETS.map(([k, label]) => `${esc(label)}: ${esc(peso(stAging[k]))}`).join(' &nbsp;|&nbsp; ')}</div>
       <h2>Unpaid and partly paid invoices</h2>
       <table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th class="r">Invoice total</th><th class="r">Returns</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody>
       ${stOpen.length === 0 ? '<tr><td colspan="7">Nothing outstanding.</td></tr>' : stOpen.map((i) => `<tr><td>INV-${pad(i.invoice_no)}</td><td>${esc(fmtDate(i.invoice_date))}</td><td>${esc(i.due_date ? fmtDate(i.due_date) : '-')}</td><td class="r">${esc(peso(i.total))}</td><td class="r">${esc(peso(i.returned))}</td><td class="r">${esc(peso(i.paid))}</td><td class="r">${esc(peso(i.balance))}</td></tr>`).join('')}
       </tbody></table>
       <h2>Account activity</h2>
       <table><thead><tr><th>Date</th><th>Document</th><th>Details</th><th class="r">Charges</th><th class="r">Credits</th><th class="r">Balance</th></tr></thead><tbody>
       <tr><td colspan="5"><em>Opening balance</em></td><td class="r">${esc(peso(stView.opening))}</td></tr>
       ${stView.rows.map((r) => `<tr><td>${esc(fmtDate(r.entry_date))}</td><td>${esc(r.doc_no)}</td><td>${esc(r.description)}</td><td class="r">${Number(r.debit) ? esc(peso(r.debit)) : ''}</td><td class="r">${Number(r.credit) ? esc(peso(r.credit)) : ''}</td><td class="r">${esc(peso(r.balance))}</td></tr>`).join('')}
       <tr><td colspan="3"><strong>Closing balance</strong></td><td class="r">${esc(peso(stView.charges))}</td><td class="r">${esc(peso(stView.credits))}</td><td class="r"><strong>${esc(peso(stView.closing))}</strong></td></tr>
       </tbody></table>
       <p class="sub" style="margin-top:24px">Returns reduce the invoice they were made on. Please settle any overdue amount as soon as possible. Thank you.</p>`
    );
  };

  // ---------- render ----------
  const tabs = [
    ['collectibles', 'Collectibles', owing.length],
    ['ledger', 'Ledger & Statement', 0],
    ['payments', 'Payments', 0],
  ];

  return (
    <div>
      <PageHeader title="Collections" subtitle="What customers owe, their ledgers and statements, and payments received">
        {isOwner && (
          <button onClick={() => openPayment()} className="cs-btn cs-btn-gold px-4 py-2.5">
            <Wallet className="w-4 h-4" aria-hidden="true" />
            <span>Receive Payment</span>
          </button>
        )}
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      <div className="flex flex-wrap gap-2 mb-5" role="tablist" aria-label="Collections sections">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border cursor-pointer transition-colors ${tab === id ? 'bg-[#1f1b12] text-[#e3bf5a] border-[#3a3014]' : 'text-[#a8a090] border-[#2a2622] hover:bg-[#1a1816]'}`}
          >
            {label}
            {n > 0 && <span className="ml-2 inline-flex min-w-[18px] h-[18px] px-1 rounded-full bg-[#2a2622] text-[#e3bf5a] text-[10px] font-semibold items-center justify-center">{n}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : tab === 'collectibles' ? (
        <>
          <div className="cs-card px-5 py-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Stat label="To collect" value={peso(totals.balance)} tone="text-[#e3bf5a]" hint={`${totals.customers} customer${totals.customers === 1 ? '' : 's'}`} />
            <Stat label="Overdue" value={peso(totals.overdue)} tone={totals.overdue > 0 ? 'text-[#e5736d]' : ''} />
            <Stat label="Due in 7 days" value={peso(totals.week)} tone={totals.week > 0 ? 'text-[#e5a93d]' : ''} />
            <Stat label="Open invoices" value={owing.length} />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-[#a8a090] mb-3 cursor-pointer">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Show only customers with overdue invoices
          </label>

          <div className="cs-card overflow-hidden">
            {groups.length === 0 ? (
              <EmptyState icon={Wallet} title={overdueOnly ? 'Nothing is overdue' : 'Nothing to collect'} text="Approved credit sales that are unpaid or partly paid appear here, with returns already deducted." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium text-right">Invoices</th>
                      <th className="px-4 py-3 font-medium text-right">Overdue</th>
                      <th className="px-4 py-3 font-medium text-right">Balance</th>
                      <th className="px-4 py-3 font-medium">Oldest overdue</th>
                      <th className={`px-4 py-3 ${STICKY_TH}`}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {groups.map((g) => {
                      const isOpen = !!open[g.customer_id];
                      return (
                        <React.Fragment key={g.customer_id}>
                          <tr className="bg-[#141210] hover:bg-[#1c1916] transition-colors">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => setOpen((p) => ({ ...p, [g.customer_id]: !p[g.customer_id] }))}
                                className="inline-flex items-center gap-2 cursor-pointer text-left"
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? 'Hide' : 'Show'} invoices of ${g.name}`}
                              >
                                {isOpen ? <ChevronDown className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" />}
                                <span>{g.name}</span>
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right font-mono">{g.items.length}</td>
                            <td className={`px-4 py-3 text-right font-mono ${g.overdue > 0 ? 'text-[#e5736d]' : 'text-[#a8a090]'}`}>{g.overdue > 0 ? peso(g.overdue) : '-'}</td>
                            <td className="px-4 py-3 text-right font-mono text-[#e3bf5a]">{peso(g.balance)}</td>
                            <td className="px-4 py-3 text-xs">{g.worst > 0 ? <span className="text-[#e5736d]">{g.worst} day{g.worst === 1 ? '' : 's'}</span> : <span className="text-[#a8a090]">-</span>}</td>
                            <td className={`px-4 py-3 text-right whitespace-nowrap ${STICKY_TD}`}>
                              <div className="inline-flex gap-2">
                                {isOwner && (
                                  <button onClick={() => openPayment(g.customer_id)} className="cs-btn cs-btn-gold px-3 py-1.5 text-xs" aria-label={`Receive payment from ${g.name}`}>
                                    <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>Receive</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setStCust(g.customer_id);
                                    setTab('ledger');
                                  }}
                                  className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs"
                                  aria-label={`Ledger and statement of ${g.name}`}
                                >
                                  <BookOpen className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                                  <span>Statement</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={6} className="bg-[#14120f] px-4 py-3">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs">
                                    <thead className="text-[#a8a090]">
                                      <tr>
                                        <th className="py-2 pr-3 font-medium">Invoice</th>
                                        <th className="py-2 pr-3 font-medium">Date</th>
                                        <th className="py-2 pr-3 font-medium">Due</th>
                                        <th className="py-2 pr-3 font-medium text-right">Total</th>
                                        <th className="py-2 pr-3 font-medium text-right">Returns</th>
                                        <th className="py-2 pr-3 font-medium text-right">Paid</th>
                                        <th className="py-2 pr-3 font-medium text-right">Balance</th>
                                        <th className="py-2 font-medium">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#24201c]">
                                      {g.items.map((i) => (
                                        <tr key={i.sale_id}>
                                          <td className="py-2 pr-3 font-mono text-[#e3bf5a]">INV-{pad(i.invoice_no)}</td>
                                          <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(i.invoice_date)}</td>
                                          <td className="py-2 pr-3 whitespace-nowrap">
                                            {i.due_date ? fmtDate(i.due_date) : '-'}
                                            <div>{lateText(i.due_date)}</div>
                                          </td>
                                          <td className="py-2 pr-3 text-right font-mono">{peso(i.total)}</td>
                                          <td className="py-2 pr-3 text-right font-mono">{Number(i.returned) > 0 ? peso(i.returned) : '-'}</td>
                                          <td className="py-2 pr-3 text-right font-mono">{Number(i.paid) > 0 ? peso(i.paid) : '-'}</td>
                                          <td className="py-2 pr-3 text-right font-mono text-[#e3bf5a]">{peso(i.balance)}</td>
                                          <td className="py-2">{invoiceTag(i)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : tab === 'ledger' ? (
        <>
          <div className="cs-card px-5 py-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="st-cust" className="cs-label">Customer</label>
              <select id="st-cust" value={stCust} onChange={(e) => setStCust(e.target.value)} className="cs-input px-3 py-2.5">
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="st-from" className="cs-label">From (optional)</label>
              <input id="st-from" type="date" value={stFrom} onChange={(e) => setStFrom(e.target.value)} className="cs-input px-3 py-2.5" />
            </div>
            <div>
              <label htmlFor="st-to" className="cs-label">To (optional)</label>
              <input id="st-to" type="date" value={stTo} onChange={(e) => setStTo(e.target.value)} className="cs-input px-3 py-2.5" />
            </div>
          </div>

          {!stCust ? (
            <div className="cs-card">
              <EmptyState icon={BookOpen} title="Choose a customer" text="The ledger lists every invoice, return and payment with a running balance. The statement adds what is unpaid and how late it is." />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="cs-card px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <Stat label="Opening balance" value={peso(stView.opening)} />
                <Stat label="Invoiced" value={peso(stView.charges)} />
                <Stat label="Paid and returned" value={peso(stView.credits)} />
                <Stat label="Closing balance" value={peso(stView.closing)} tone="text-[#e3bf5a]" />
              </div>

              <div className="cs-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#2a2622]">
                  <div className="text-sm font-medium">Ledger of {stCustomer?.name}</div>
                  <div className="flex gap-2">
                    {isOwner && stOwed > 0 && (
                      <button onClick={() => openPayment(stCust)} className="cs-btn cs-btn-gold px-3 py-1.5 text-xs">
                        <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Receive Payment</span>
                      </button>
                    )}
                    <button onClick={printStatement} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
                      <Printer className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                      <span>Print Statement</span>
                    </button>
                  </div>
                </div>
                {ledger.length === 0 ? (
                  <EmptyState icon={BookOpen} title="No credit activity" text="This customer has no approved credit invoices yet." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                        <tr>
                          <th className="px-4 py-3 font-medium">Date</th>
                          <th className="px-4 py-3 font-medium">Document</th>
                          <th className="px-4 py-3 font-medium">Details</th>
                          <th className="px-4 py-3 font-medium text-right">Charges</th>
                          <th className="px-4 py-3 font-medium text-right">Credits</th>
                          <th className="px-4 py-3 font-medium text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#24201c]">
                        {stFrom && (
                          <tr className="text-[#a8a090]">
                            <td className="px-4 py-2.5 text-xs" colSpan={5}>Opening balance</td>
                            <td className="px-4 py-2.5 text-right font-mono">{peso(stView.opening)}</td>
                          </tr>
                        )}
                        {stView.rows.map((r, n) => (
                          <tr key={`${r.doc_no}-${n}`} className="hover:bg-[#1c1916] transition-colors">
                            <td className="px-4 py-2.5 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(r.entry_date)}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-[#e3bf5a]">{r.doc_no}</td>
                            <td className="px-4 py-2.5 text-xs">{r.description}</td>
                            <td className="px-4 py-2.5 text-right font-mono">{Number(r.debit) ? peso(r.debit) : ''}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-[#3ecf8e]">{Number(r.credit) ? peso(r.credit) : ''}</td>
                            <td className="px-4 py-2.5 text-right font-mono">{peso(r.balance)}</td>
                          </tr>
                        ))}
                        {stView.rows.length === 0 && (
                          <tr>
                            <td className="px-4 py-4 text-xs text-[#a8a090]" colSpan={6}>No activity in this period.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="cs-card overflow-hidden">
                <div className="px-4 py-3 border-b border-[#2a2622] text-sm font-medium">Unpaid and partly paid invoices</div>
                <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm border-b border-[#2a2622]">
                  <Stat label="Owed now" value={peso(stOwed)} tone="text-[#e3bf5a]" />
                  {BUCKETS.map(([k, label]) => (
                    <Stat key={k} label={label} value={peso(stAging[k])} tone={k !== 'current' && stAging[k] > 0 ? 'text-[#e5736d]' : ''} />
                  ))}
                </div>
                {stOpen.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-[#a8a090]">Nothing outstanding for this customer.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                        <tr>
                          <th className="px-4 py-3 font-medium">Invoice</th>
                          <th className="px-4 py-3 font-medium">Date</th>
                          <th className="px-4 py-3 font-medium">Due</th>
                          <th className="px-4 py-3 font-medium text-right">Total</th>
                          <th className="px-4 py-3 font-medium text-right">Returns</th>
                          <th className="px-4 py-3 font-medium text-right">Paid</th>
                          <th className="px-4 py-3 font-medium text-right">Balance</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#24201c]">
                        {stOpen.map((i) => (
                          <tr key={i.sale_id} className="bg-[#141210] hover:bg-[#1c1916] transition-colors">
                            <td className="px-4 py-2.5 font-mono text-xs text-[#e3bf5a]">INV-{pad(i.invoice_no)}</td>
                            <td className="px-4 py-2.5 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(i.invoice_date)}</td>
                            <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                              {i.due_date ? fmtDate(i.due_date) : '-'}
                              <div>{lateText(i.due_date)}</div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono">{peso(i.total)}</td>
                            <td className="px-4 py-2.5 text-right font-mono">{Number(i.returned) > 0 ? peso(i.returned) : '-'}</td>
                            <td className="px-4 py-2.5 text-right font-mono">{Number(i.paid) > 0 ? peso(i.paid) : '-'}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-[#e3bf5a]">{peso(i.balance)}</td>
                            <td className="px-4 py-2.5">{invoiceTag(i)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="cs-card overflow-hidden">
          {payments.length === 0 ? (
            <EmptyState icon={Receipt} title="No payments yet" text="Payments received from customers on credit invoices are recorded here by the owner." actionLabel={isOwner ? 'Receive Payment' : undefined} onAction={isOwner ? () => openPayment() : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Receipt</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Method</th>
                    <th className="px-4 py-3 font-medium">Applied to</th>
                    <th className="px-4 py-3 font-medium text-right">Received</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className={`px-4 py-3 ${STICKY_TH}`}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {payments.map((p) => (
                    <tr key={p.id} className={`bg-[#141210] hover:bg-[#1c1916] transition-colors ${p.status === 'Voided' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a]">PR-{pad(p.payment_no)}</td>
                      <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                      <td className="px-4 py-3">{p.customers?.name}</td>
                      <td className="px-4 py-3 text-xs">
                        {METHOD[p.method]}
                        {p.reference && <div className="text-[10px] text-[#a8a090]">Ref {p.reference}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">{allocText(p).map((a) => a.inv).join(', ')}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {peso(p.amount)}
                        {Number(p.excess_refunded) > 0 && <div className="text-[10px] text-[#e5a93d]">{peso(p.excess_refunded)} refunded</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={p.status === 'Posted' ? 'green' : 'gray'}>{p.status}</Badge>
                        {p.status === 'Voided' && p.void_reason && <div className="text-[10px] text-[#a8a090] mt-1">{p.void_reason}</div>}
                      </td>
                      <td className={`px-4 py-3 text-right whitespace-nowrap ${STICKY_TD}`}>
                        <div className="inline-flex gap-2">
                          <button onClick={() => setReceiptId(p.id)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs" aria-label={`View receipt PR-${pad(p.payment_no)}`}>
                            <FileText className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                            <span>Receipt</span>
                          </button>
                          {isOwner && p.status === 'Posted' && (
                            <button
                              onClick={() => {
                                setVoiding(p);
                                setVoidReason('');
                                setVoidError('');
                              }}
                              className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs"
                              aria-label={`Void payment PR-${pad(p.payment_no)}`}
                            >
                              <Ban className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                              <span>Void</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- Receive payment ---------- */}
      {pOpen && (
        <Modal title="Receive Payment" onClose={() => setPOpen(false)} split>
          <form onSubmit={savePayment} className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] gap-6">
            {/* ---------- LEFT: what to enter ---------- */}
            <div className="space-y-4">
              <fieldset>
                <legend className="cs-label">How was it paid?</legend>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(METHOD).map(([val, label]) => (
                    <label key={val} className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm text-center transition-colors ${pf.method === val ? 'border-[#d9b24c] bg-[#1f1b12] text-[#e3bf5a]' : 'border-[#2a2622] text-[#a8a090] hover:bg-[#1a1816]'}`}>
                      <input type="radio" name="p-method" value={val} checked={pf.method === val} onChange={() => setPf((p) => ({ ...p, method: val, refundExcess: false }))} className="sr-only" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="p-customer" className="cs-label">Customer</label>
                  <select id="p-customer" value={pf.customer} onChange={(e) => pickCustomer(e.target.value)} className="cs-input px-3 py-2.5">
                    <option value="">Select customer...</option>
                    {[...new Set(owing.map((i) => i.customer_id))]
                      .map((id) => ({ id, name: custName(id) }))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="p-date" className="cs-label">Date received</label>
                  <input id="p-date" type="date" max={todayLocal()} value={pf.date} onChange={(e) => setPf((p) => ({ ...p, date: e.target.value }))} required className="cs-input px-3 py-2.5" />
                </div>
              </div>

              {pf.customer && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="p-amount" className="cs-label">Amount received</label>
                    <input id="p-amount" type="number" min="0.01" step="0.01" value={pf.amount} onChange={(e) => setAmount(e.target.value)} className="cs-input px-3 py-2.5 text-right" />
                    <button type="button" onClick={() => setAmount(String(payOwed))} className="text-[11px] text-[#d9b24c] mt-1 cursor-pointer text-left">
                      Customer owes {peso(payOwed)} - pay in full
                    </button>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="p-ref" className="cs-label">{isBank ? 'Bank transfer reference' : 'Receipt or note reference (optional)'}</label>
                    <input id="p-ref" value={pf.reference} onChange={(e) => setPf((p) => ({ ...p, reference: e.target.value }))} required={isBank} className="cs-input px-3 py-2.5" />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="p-notes" className="cs-label">Notes (optional)</label>
                <input id="p-notes" value={pf.notes} onChange={(e) => setPf((p) => ({ ...p, notes: e.target.value }))} className="cs-input px-3 py-2.5" />
              </div>
            </div>

            {/* ---------- RIGHT: where the money goes, and the save buttons ---------- */}
            <div className="flex flex-col gap-3 lg:border-l lg:border-[#2a2622] lg:pl-6">
              <div className="cs-label">Invoices to pay</div>
              {!pf.customer ? (
                <p className="text-xs text-[#a8a090] rounded-xl border border-dashed border-[#2a2622] px-4 py-5 text-center">Choose a customer to see their open invoices.</p>
              ) : (
                <>
                  <div className="space-y-1.5 max-h-[40dvh] overflow-y-auto pr-1">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#a8a090] px-2">
                      <span className="flex-1">Invoice / due</span>
                      <span className="w-[4.75rem] text-right">Balance</span>
                      <span className="w-24 text-right">Apply</span>
                    </div>
                    {payInvoices.map((i) => (
                      <div key={i.sale_id} className="flex items-center gap-2 rounded-lg border border-[#2a2622] bg-[#14120f] px-2 py-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs text-[#e3bf5a]">INV-{pad(i.invoice_no)}</div>
                          <div className="text-[11px] leading-tight">
                            {i.due_date ? fmtDate(i.due_date) : '-'}
                            <div>{lateText(i.due_date)}</div>
                          </div>
                        </div>
                        <div className="w-[4.75rem] shrink-0 text-right font-mono text-xs">{peso(i.balance)}</div>
                        <div className="w-24 shrink-0">
                          <label htmlFor={`pa-${i.sale_id}`} className="sr-only">Amount applied to INV-{pad(i.invoice_no)}</label>
                          <input
                            id={`pa-${i.sale_id}`}
                            type="number"
                            min="0"
                            max={i.balance}
                            step="0.01"
                            value={pf.alloc[i.sale_id] ?? ''}
                            onChange={(e) => setApply(i.sale_id, e.target.value)}
                            className="cs-input px-2 py-1.5 text-xs text-right"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] leading-snug text-[#a8a090]">The amount is applied to the oldest due date first. You can change how much goes to each invoice.</p>

                  <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-2.5 text-sm space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[10px] uppercase tracking-wider text-[#a8a090]">Received</span>
                      <span className="font-mono text-xl text-[#e3bf5a]">{peso(received)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[10px] uppercase tracking-wider text-[#a8a090]">Applied to invoices</span>
                      <span className="font-mono">{peso(applied)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[10px] uppercase tracking-wider text-[#a8a090]">Excess</span>
                      <span className={`font-mono ${excess > 0.001 ? 'text-[#e5a93d]' : ''}`}>{peso(Math.max(excess, 0))}</span>
                    </div>
                    {excess > 0.001 && isBank && allCovered && (
                      <label className="flex items-start gap-2 text-xs text-[#e5a93d] border-t border-[#2a2622] pt-2 cursor-pointer">
                        <input type="checkbox" checked={pf.refundExcess} onChange={(e) => setPf((p) => ({ ...p, refundExcess: e.target.checked }))} className="mt-0.5" />
                        <span>
                          The customer sent {peso(excess)} more than owed. No customer credit is kept: I will refund this by bank transfer. It is recorded in the same entry, so the money in and out are both on the audit trail.
                        </span>
                      </label>
                    )}
                  </div>
                </>
              )}

              {pf.customer && payProblem && received > 0 && (
                <p className="text-xs text-[#e5a93d]" role="alert">{payProblem}</p>
              )}

              <div className="sticky bottom-0 z-20 -mx-6 -mb-5 px-6 pt-3 pb-4 bg-[#12100e] border-t border-[#2a2622] space-y-3 lg:mx-0 lg:px-0 lg:border-t-0 lg:pt-1">
                <ErrorNote>{pError}</ErrorNote>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setPOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
                  <button type="submit" disabled={saving || !!payProblem} className="cs-btn cs-btn-gold flex-1 px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">
                    {saving ? 'Saving...' : 'Record Payment'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Void payment ---------- */}
      {voiding && (
        <Modal title={`Void PR-${pad(voiding.payment_no)}`} onClose={() => setVoiding(null)}>
          <form onSubmit={doVoid} className="space-y-4">
            <p className="text-sm text-[#a8a090]">
              This reverses the journal entry and puts {peso(voiding.applied)} back on the customer&rsquo;s invoices as unpaid.
              It does not work if a refund was already paid back on one of those invoices.
            </p>
            <div>
              <label htmlFor="pv-reason" className="cs-label">Reason</label>
              <input id="pv-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Wrong customer" required autoFocus className="cs-input px-3.5 py-2.5" />
            </div>
            <ModalActions error={voidError}>
              <button type="button" onClick={() => setVoiding(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Voiding...' : 'Void Payment'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Receipt ---------- */}
      {receipt && (
        <Modal title={`Receipt PR-${pad(receipt.payment_no)}`} onClose={() => setReceiptId(null)}>
          <div className="space-y-4 text-sm">
            <div className="flex justify-between gap-4">
              <div>
                <div className="font-medium">{receipt.customers?.name}</div>
                {receipt.customers?.address && <div className="text-xs text-[#a8a090]">{receipt.customers.address}</div>}
              </div>
              <div className="text-right text-xs text-[#a8a090]">
                <div>Date: {fmtDate(receipt.payment_date)}</div>
                <div>{METHOD[receipt.method]}</div>
                {receipt.reference && <div>Ref: {receipt.reference}</div>}
                {receipt.status === 'Voided' && <Badge tone="gray">Voided</Badge>}
              </div>
            </div>
            <ul className="divide-y divide-[#24201c] rounded-xl border border-[#2a2622]">
              {allocText(receipt).map((a) => (
                <li key={a.inv} className="flex justify-between gap-3 px-4 py-2.5">
                  <span>Applied to {a.inv}</span>
                  <span className="font-mono">{peso(a.amount)}</span>
                </li>
              ))}
              {Number(receipt.excess_refunded) > 0 && (
                <li className="flex justify-between gap-3 px-4 py-2.5 text-[#e5a93d]">
                  <span>Overpayment returned by bank transfer</span>
                  <span className="font-mono">{peso(receipt.excess_refunded)}</span>
                </li>
              )}
            </ul>
            <div className="flex justify-between font-medium text-base">
              <span>Amount received</span>
              <span className="font-mono text-[#e3bf5a]">{peso(receipt.amount)}</span>
            </div>
            {receipt.notes && <p className="text-xs text-[#a8a090]">Notes: {receipt.notes}</p>}
            <ModalActions>
              <button type="button" onClick={() => setReceiptId(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Close</button>
              <button type="button" onClick={() => printReceipt(receipt)} className="cs-btn cs-btn-gold px-5 py-2.5">
                <Printer className="w-4 h-4" aria-hidden="true" />
                <span>Print</span>
              </button>
            </ModalActions>
          </div>
        </Modal>
      )}
    </div>
  );
}
