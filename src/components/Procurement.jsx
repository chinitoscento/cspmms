import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShoppingCart, PlusCircle, Trash2, ChevronDown, ChevronRight, Wallet, Ban, Receipt, Users } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso, fmtDate, ModalActions, STICKY_TH, STICKY_TD } from './ui';
import { MATERIAL_CATEGORIES } from './materialCategories';
import { LateEntryNotice, isLateEntry, withLateNote } from './lateEntry';
import FieldSearch, { emptyFieldFilter, hasFieldFilter, textMatch, numberMatch, dateMatch } from './FieldSearch';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const pad = (n) => String(n).padStart(8, '0');
const purLabel = (n) => `PUR-${pad(n)}`;
const payLabel = (n) => `PAY-${pad(n)}`;
const cents = (v) => Math.round((Number(v) || 0) * 100);
const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });

// What the Purchases tab can be searched by (the "Search by" dropdown)
const PURCHASE_SEARCH_FIELDS = [
  { id: 'supplier', label: 'Supplier', type: 'text', placeholder: 'Supplier name' },
  { id: 'date', label: 'Date', type: 'date' },
  { id: 'material', label: 'Raw material', type: 'text', placeholder: 'e.g. oil, bottle, box' },
  { id: 'pur', label: 'PUR number', type: 'text', placeholder: 'e.g. PUR-00000012 or 12' },
  { id: 'creditor', label: 'Creditor', type: 'text', placeholder: 'Creditor name' },
];

const PAYMENT_LABEL = { cash: 'Cash', bank: 'Bank', credit: 'On credit' };
const ASSET_ACCOUNTS = [
  { code: '1500', name: 'Equipment' },
  { code: '1400', name: 'Prepaid Expenses' },
];

let keySeed = 0;
const newLine = () => ({ key: `p${++keySeed}`, line_type: 'material', material_id: '', account_code: '', description: '', qty: '', pack_size: '', unit_cost: '' });

// For material lines, qty = number of packs and unit_cost = price per pack; pack_size = base units in one pack.
// For asset/expense lines, qty and unit_cost are used as they are.
const lineAmount = (l) => cents((Number(l.qty) || 0) * (Number(l.unit_cost) || 0));

// Units that are normally counted one by one, so the pack size can default to 1
const PIECE_UNITS = /^(pc|pcs|piece|pieces|unit|units|each|ea)$/i;

// Unit costs can be fractions of a peso (e.g. P0.48 per ml), so show more than 2 decimals
const unitPeso = (v) =>
  '\u20B1' + Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

// Add months to a yyyy-mm-dd date, always counting from the original day (Jan 31 + 1 month = Feb 28),
// the same way the database does it.
const addMonths = (iso, k) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = m - 1 + k;
  const yy = y + Math.floor(t / 12);
  const mm = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

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

// Everything owed to one creditor and everything paid to them: each purchase, its installment schedule,
// and which payment settled which installment. Built only from rows the page already loads.
function CreditorStatement({ stmt, purchases, installmentRows, payAllocs, instPays, payments, onClose }) {
  const today = todayLocal();
  const payById = new Map(payments.map((p) => [p.id, p]));
  const byDateNo = (x, y) =>
    x.pay.pay_date < y.pay.pay_date ? -1 : x.pay.pay_date > y.pay.pay_date ? 1 : x.pay.pay_no - y.pay.pay_no;

  const rows = purchases
    .filter((p) => p.creditor_id === stmt.creditor_id && p.payment_type === 'credit' && p.status === 'Posted')
    .sort((a, b) => a.purchase_no - b.purchase_no)
    .map((p) => {
      const insts = installmentRows.filter((i) => i.purchase_id === p.id).sort((a, b) => a.seq - b.seq);
      const interest = insts.length ? insts.reduce((s, i) => s + Number(i.interest_due), 0) : Number(p.interest_total || 0);
      const total = Number(p.total) + interest;
      const allocs = payAllocs
        .filter((a) => a.purchase_id === p.id)
        .map((a) => ({ a, pay: payById.get(a.payment_id) }))
        .filter((x) => x.pay)
        .sort(byDateNo);
      const paid = allocs.filter((x) => x.pay.status === 'Posted').reduce((s, x) => s + Number(x.a.amount), 0);
      return { p, insts, total, allocs, paid, balance: total - paid };
    });

  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const paidBy = (installmentId) =>
    instPays
      .filter((ip) => ip.installment_id === installmentId)
      .map((ip) => ({ ip, pay: payById.get(ip.payment_id) }))
      .filter((x) => x.pay && x.pay.status === 'Posted')
      .sort(byDateNo);

  return (
    <Modal title={`Statement: ${stmt.creditor_name}`} onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          ['Billed (with interest)', sum('total'), ''],
          ['Paid', sum('paid'), 'text-[#3ecf8e]'],
          ['Balance', sum('balance'), sum('balance') > 0.005 ? 'text-[#e5736d]' : 'text-[#3ecf8e]'],
        ].map(([label, v, tone]) => (
          <div key={label} className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">{label}</div>
            <div className={`font-mono text-lg mt-0.5 ${tone}`}>{peso(v)}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 && <p className="text-sm text-[#a8a090]">No credit purchases are assigned to this creditor yet.</p>}

      {rows.map(({ p, insts, total, allocs, paid, balance }) => (
        <div key={p.id} className="mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div>
              <span className="font-mono text-[#d9b24c]">{purLabel(p.purchase_no)}</span>
              {p.reference && <span className="text-xs text-[#a8a090]"> · {p.reference}</span>}
              <span className="text-xs text-[#a8a090]"> · {fmtDate(p.purchase_date)}</span>
            </div>
            <div className="text-xs text-[#a8a090]">
              Total {peso(total)} · Paid {peso(paid)} · Balance{' '}
              <span className={balance > 0.005 ? 'text-[#e5736d]' : 'text-[#3ecf8e]'}>{peso(balance)}</span>
            </div>
          </div>

          {insts.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-[#2a2622] mb-3">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1a1816] uppercase tracking-wider text-[#a8a090]">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 font-medium text-right">Amount</th>
                    <th className="px-3 py-2 font-medium text-right">Paid</th>
                    <th className="px-3 py-2 font-medium text-right">Balance</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Paid by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {insts.map((i) => {
                    const amt = Number(i.principal_due) + Number(i.interest_due);
                    const got = Number(i.paid_principal) + Number(i.paid_interest);
                    const bal = Number(i.balance);
                    let status = 'Upcoming';
                    let tone = 'text-[#a8a090]';
                    if (bal < 0.005) { status = 'Paid'; tone = 'text-[#3ecf8e]'; }
                    else if (i.due_date < today) { status = got > 0 ? `Short ${peso(bal)}` : 'Overdue'; tone = 'text-[#e5736d]'; }
                    else if (got > 0) status = 'Part paid';
                    const by = paidBy(i.installment_id);
                    return (
                      <tr key={i.installment_id} className="bg-[#141210] align-top">
                        <td className="px-3 py-2">{i.seq}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtDate(i.due_date)}</td>
                        <td className="px-3 py-2 text-right font-mono">{peso(amt)}</td>
                        <td className="px-3 py-2 text-right font-mono">{peso(got)}</td>
                        <td className="px-3 py-2 text-right font-mono">{peso(bal)}</td>
                        <td className={`px-3 py-2 whitespace-nowrap ${tone}`}>{status}</td>
                        <td className="px-3 py-2 text-[#a8a090]">
                          {by.length === 0 ? '-' : by.map((x) => (
                            <div key={x.ip.payment_id} className="whitespace-nowrap">
                              {payLabel(x.pay.pay_no)} · {peso(Number(x.ip.principal_amt) + Number(x.ip.interest_amt))}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-[#2a2622]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1a1816] uppercase tracking-wider text-[#a8a090]">
                <tr>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">Date paid</th>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium text-right">Applied here</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                {allocs.length === 0 ? (
                  <tr className="bg-[#141210]"><td colSpan={6} className="px-3 py-2 text-[#a8a090]">No payments recorded for this purchase.</td></tr>
                ) : allocs.map(({ a, pay }) => (
                  <tr key={a.payment_id} className={`bg-[#141210] ${pay.status === 'Posted' ? '' : 'opacity-50 line-through'}`}>
                    <td className="px-3 py-2 font-mono text-[#d9b24c] whitespace-nowrap">{payLabel(pay.pay_no)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(pay.pay_date)}</td>
                    <td className="px-3 py-2">{PAYMENT_LABEL[pay.method] || pay.method}</td>
                    <td className="px-3 py-2 text-[#a8a090]">{pay.reference || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{peso(a.amount)}</td>
                    <td className="px-3 py-2">{pay.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="text-[10px] text-[#a8a090]">
        A payment that covers several purchases appears under each one, showing only the part applied there. Voided payments are struck through and not counted.
      </p>
    </Modal>
  );
}

export default function Procurement({ user, onChanged, prefill }) {
  const isOwner = user?.role === 'owner';
  const [tab, setTab] = useState(prefill?.tab || 'purchases'); // the dashboard payables alert opens the Payables tab
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [suppliers, setSuppliers] = useState([]);
  const [creditors, setCreditors] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [payables, setPayables] = useState([]);
  const [payments, setPayments] = useState([]);
  const [installmentRows, setInstallmentRows] = useState([]);
  const [payAllocs, setPayAllocs] = useState([]); // which payment went to which purchase
  const [instPays, setInstPays] = useState([]); // which payment went to which installment
  const [stmt, setStmt] = useState(null); // creditor whose statement is open
  const [openId, setOpenId] = useState(null);
  const [pfilter, setPfilter] = useState(() => emptyFieldFilter('supplier')); // search on the Purchases tab

  // new purchase
  const [formOpen, setFormOpen] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [supplier, setSupplier] = useState('');
  const [creditor, setCreditor] = useState('');
  const [reference, setReference] = useState('');
  const [payment, setPayment] = useState('cash');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [draft, setDraft] = useState(newLine());
  const [draftError, setDraftError] = useState('');
  const [terms, setTerms] = useState('full'); // 'full' = one due date, 'installment' = monthly installments
  const [instCount, setInstCount] = useState('6');
  const [firstDue, setFirstDue] = useState('');
  const [interestMode, setInterestMode] = useState('none'); // 'none' | 'rate' | 'amount'
  const [interestValue, setInterestValue] = useState('');
  const [oneMode, setOneMode] = useState('none'); // interest on a one-date purchase: 'none' | 'rate' | 'amount'
  const [oneValue, setOneValue] = useState('');
  const [lateReason, setLateReason] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // pay creditor
  const [paying, setPaying] = useState(null); // { creditor_id, creditor_name, items }
  const [payDate, setPayDate] = useState(todayLocal());
  const [payMethod, setPayMethod] = useState('cash');
  const [payRef, setPayRef] = useState('');
  const [payAmounts, setPayAmounts] = useState({});
  const [payError, setPayError] = useState('');

  // creditors (the third parties you owe) and fixing purchases entered before creditors existed
  const [credFormOpen, setCredFormOpen] = useState(false);
  const [credName, setCredName] = useState('');
  const [credContact, setCredContact] = useState('');
  const [credNotes, setCredNotes] = useState('');
  const [credError, setCredError] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignFrom, setAssignFrom] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [assignCreditor, setAssignCreditor] = useState('');
  const [assignReason, setAssignReason] = useState('The creditor was entered as the supplier');
  const [assignPicked, setAssignPicked] = useState({});
  const [assignError, setAssignError] = useState('');

  // void
  const [voiding, setVoiding] = useState(null); // { kind: 'purchase'|'payment', row }
  const [reason, setReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    // Post any month-end interest that is due on installment plans (does nothing when there is none)
    await supabase.rpc('accrue_installment_interest');
    const [sup, cre, mat, acc, pur, pay, pmt, ins] = await Promise.all([
      supabase.from('suppliers').select('id, name, payment_terms_days').eq('status', 'Active').order('name'),
      supabase.from('creditors').select('id, name, contact_number, notes, status').order('name'),
      supabase.from('materials').select('id, name, category, unit').eq('is_active', true).order('name'),
      supabase.from('accounts').select('code, name').eq('type', 'expense').eq('is_active', true).eq('is_system', false).order('code'),
      supabase.from('purchases').select('*, suppliers(name), creditors(name), purchase_lines(*)').order('purchase_no', { ascending: false }).limit(200),
      supabase.from('payables_open').select('*').order('due_date', { ascending: true }),
      supabase.from('supplier_payments').select('*, suppliers(name), creditors(name)').order('pay_no', { ascending: false }).limit(200),
      supabase.from('installments_status').select('*').order('seq', { ascending: true }),
    ]);
    const err = [sup, cre, mat, acc, pur, pay, pmt, ins].find((r) => r.error);
    if (err) setLoadError(err.error.message);
    setSuppliers(sup.data || []);
    setCreditors(cre.data || []);
    setMaterials(mat.data || []);
    setExpenseAccounts((acc.data || []).filter((a) => !['6060', '6080'].includes(a.code)));
    setPurchases(pur.data || []);
    setPayables(pay.data || []);
    setPayments(pmt.data || []);
    setInstallmentRows(ins.data || []);
    // Payment trace data. Not fatal if it cannot be read: the statement then shows less.
    const [alc, ipm] = await Promise.all([
      supabase.from('payment_allocations').select('*'),
      supabase.from('installment_payments').select('*'),
    ]);
    setPayAllocs(alc.data || []);
    setInstPays(ipm.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const afterChange = async () => {
    await load();
    onChanged && onChanged();
  };

  // ---------- new purchase ----------
  const openForm = () => {
    setDate(todayLocal());
    setSupplier('');
    setCreditor('');
    setReference('');
    setPayment('cash');
    setDue('');
    setNotes('');
    setLines([]);
    setDraft(newLine());
    setDraftError('');
    setTerms('full');
    setInstCount('6');
    setFirstDue('');
    setInterestMode('none');
    setInterestValue('');
    setOneMode('none');
    setOneValue('');
    setLateReason('');
    setFormError('');
    setFormOpen(true);
  };

  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  // What a material line will put into stock: total base units and cost per base unit
  const stockInfo = (l) => {
    if (l.line_type !== 'material') return null;
    const m = matById.get(l.material_id);
    const packs = Number(l.qty) || 0;
    const size = Number(l.pack_size) || 0;
    const price = Number(l.unit_cost) || 0;
    if (!m || !(packs > 0) || !(size > 0)) return { m, ready: false };
    return { m, ready: true, baseQty: packs * size, perUnit: price / size };
  };

  const updateLine = (key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  // Validate one line (used when it is added to the purchase)
  const checkLine = (l) => {
    if (l.line_type === 'material' && !l.material_id) return 'Choose a material.';
    if (l.line_type !== 'material' && !l.account_code) return 'Choose an account.';
    if (l.line_type !== 'material' && !l.description.trim()) return 'Describe the item.';
    if (l.line_type === 'material' && !(Number(l.pack_size) > 0)) {
      const u = matById.get(l.material_id)?.unit || 'unit';
      return `Enter the size of each pack in ${u} (for example 1000 for a 1-liter bottle).`;
    }
    if (!(Number(l.qty) > 0)) return l.line_type === 'material' ? 'Enter how many packs.' : 'Enter a quantity.';
    if (l.unit_cost === '' || !(Number(l.unit_cost) >= 0)) return 'Enter the cost.';
    return '';
  };
  const draftTouched = (l) => !!(l.material_id || l.description || l.account_code || Number(l.qty) || Number(l.unit_cost));

  const addDraft = () => {
    const err = checkLine(draft);
    if (err) return setDraftError(err);
    setLines((prev) => [...prev, draft]);
    setDraft({ ...newLine(), line_type: draft.line_type });
    setDraftError('');
    setFormError('');
  };
  const editLine = (l) => {
    setLines((prev) => prev.filter((x) => x.key !== l.key));
    setDraft(l);
    setDraftError('');
  };
  const lineTitle = (l) => (l.line_type === 'material' ? matById.get(l.material_id)?.name || 'Material' : l.description);
  const lineDetail = (l) => {
    if (l.line_type === 'material') {
      const m = matById.get(l.material_id);
      return `${qty(l.qty)} pack${Number(l.qty) === 1 ? '' : 's'} \u00D7 ${qty(l.pack_size)} ${m?.unit || ''} @ ${peso(Number(l.unit_cost) || 0)}`;
    }
    return `${l.line_type === 'asset' ? 'Asset' : 'Expense'} \u00B7 ${l.account_code} \u00B7 ${qty(l.qty)} \u00D7 ${peso(Number(l.unit_cost) || 0)}`;
  };

  // Installment preview: same split as the database (equal parts, last one takes the rounding)
  const plan = useMemo(() => {
    if (payment !== 'credit' || terms !== 'installment') return null;
    const n = Math.floor(Number(instCount));
    if (!(n >= 2 && n <= 60) || total <= 0) return { n, valid: false, rows: [], interestCents: 0, first: '' };
    const first = firstDue || addMonths(date || todayLocal(), 1);
    const interestCents =
      interestMode === 'rate'
        ? Math.round((total * (Number(interestValue) || 0) * n) / 100)
        : interestMode === 'amount'
        ? cents(interestValue)
        : 0;
    const pp = Math.floor(total / n);
    const ii = Math.floor(interestCents / n);
    const rows = Array.from({ length: n }, (_, k) => ({
      seq: k + 1,
      due: addMonths(first, k),
      principal: k === n - 1 ? total - pp * (n - 1) : pp,
      interest: k === n - 1 ? interestCents - ii * (n - 1) : ii,
    }));
    return { n, valid: true, rows, interestCents, first };
  }, [payment, terms, instCount, firstDue, interestMode, interestValue, total, date]);

  // Interest from the creditor on a purchase paid in full on one date (an expense only when it is paid)
  const oneInterestCents = useMemo(() => {
    if (payment !== 'credit' || terms !== 'full' || total <= 0) return 0;
    if (oneMode === 'rate') return Math.round((total * (Number(oneValue) || 0)) / 100);
    if (oneMode === 'amount') return cents(oneValue);
    return 0;
  }, [payment, terms, oneMode, oneValue, total]);

  const savePurchase = async (e) => {
    e.preventDefault();
    if (payment === 'credit' && !creditor) return setFormError('Choose the creditor (the party you owe) for a purchase on credit.');
    if (plan) {
      if (!(plan.n >= 2 && plan.n <= 60)) return setFormError('Choose between 2 and 60 installments.');
      if (firstDue && firstDue < date) return setFormError('The first due date cannot be before the purchase date.');
      if (interestMode !== 'none' && !(Number(interestValue) > 0)) return setFormError('Enter the interest, or choose no interest.');
    }
    if (payment === 'credit' && terms === 'full' && oneMode !== 'none' && !(Number(oneValue) > 0)) return setFormError('Enter the interest, or choose no interest.');
    if (isLateEntry(date) && !lateReason.trim()) return setFormError('This is a late entry. Enter why it was not recorded on the day.');
    if (draftTouched(draft)) return setFormError('You have an item that is not added yet. Click "Add item" or clear it.');
    if (lines.length === 0) return setFormError('Add at least one item.');
    const used = lines;
    setSaving(true);
    setFormError('');
    const { error } = await supabase.rpc('record_purchase', {
      p_date: date || todayLocal(),
      p_supplier: supplier || null,
      p_creditor: payment === 'credit' ? creditor : null,
      p_reference: nz(reference),
      p_payment: payment,
      p_due: payment === 'credit' && terms === 'full' && due ? due : null,
      p_installments: plan ? plan.n : null,
      p_first_due: plan && firstDue ? firstDue : null,
      p_interest: plan ? plan.interestCents / 100 : oneInterestCents / 100,
      p_interest_rate: plan && interestMode === 'rate' ? Number(interestValue) : null,
      p_notes: withLateNote(nz(notes), date, lateReason),
      p_lines: used.map((l) => ({
        line_type: l.line_type,
        material_id: l.line_type === 'material' ? l.material_id : null,
        account_code: l.line_type === 'material' ? null : l.account_code,
        description: l.line_type === 'material' ? null : l.description.trim(),
        // Materials are always stored per base unit (ml, g, pc...): total units and cost of ONE unit
        qty: l.line_type === 'material' ? Math.round(Number(l.qty) * Number(l.pack_size) * 1e6) / 1e6 : Number(l.qty),
        unit_cost: l.line_type === 'material' ? Number(l.unit_cost) / Number(l.pack_size) : Number(l.unit_cost),
      })),
    });
    setSaving(false);
    if (error) return setFormError(error.message);
    setFormOpen(false);
    await afterChange();
  };

  // ---------- pay creditor ----------
  const openPay = (group) => {
    setPaying(group);
    setPayDate(todayLocal());
    setPayMethod('cash');
    setPayRef('');
    setPayError('');
    setPayAmounts(Object.fromEntries(group.items.map((i) => [i.purchase_id, String(Number(i.is_installment ? (overdueOf(i) > 0 ? overdueOf(i) : i.next_due_balance) : i.balance))])));
  };

  const payTotal = paying ? paying.items.reduce((s, i) => s + cents(payAmounts[i.purchase_id]), 0) : 0;

  const savePayment = async (e) => {
    e.preventDefault();
    const allocations = paying.items
      .map((i) => ({ purchase_id: i.purchase_id, amount: cents(payAmounts[i.purchase_id]) / 100 }))
      .filter((a) => a.amount > 0);
    if (allocations.length === 0) return setPayError('Enter an amount to pay.');
    const tooMuch = paying.items.find((i) => cents(payAmounts[i.purchase_id]) > cents(i.balance));
    if (tooMuch) return setPayError(`${purLabel(tooMuch.purchase_no)} has only ${peso(tooMuch.balance)} left to pay.`);
    setSaving(true);
    setPayError('');
    const { error } = await supabase.rpc('record_supplier_payment', {
      p_date: payDate || todayLocal(),
      p_creditor: paying.creditor_id,
      p_method: payMethod,
      p_reference: nz(payRef),
      p_notes: null,
      p_allocations: allocations,
    });
    setSaving(false);
    if (error) return setPayError(error.message);
    setPaying(null);
    await afterChange();
  };

  // ---------- void ----------
  const openVoid = (kind, row) => {
    setVoiding({ kind, row });
    setReason('');
    setVoidError('');
  };

  const doVoid = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return setVoidError('Please give a reason.');
    setSaving(true);
    setVoidError('');
    const { error } =
      voiding.kind === 'purchase'
        ? await supabase.rpc('void_purchase', { p_id: voiding.row.id, p_reason: reason.trim() })
        : await supabase.rpc('void_supplier_payment', { p_id: voiding.row.id, p_reason: reason.trim() });
    setSaving(false);
    if (error) return setVoidError(error.message);
    setVoiding(null);
    await afterChange();
  };

  // ---------- derived ----------
  const groups = useMemo(() => {
    const map = new Map();
    payables.forEach((p) => {
      const key = p.creditor_id || 'none';
      if (!map.has(key)) map.set(key, { creditor_id: p.creditor_id || null, creditor_name: p.creditor_name || 'No creditor assigned yet', items: [] });
      map.get(key).items.push(p);
    });
    // purchases without a creditor first, so they are not missed
    return [...map.values()].sort((a, b) => (a.creditor_id ? 1 : 0) - (b.creditor_id ? 1 : 0) || a.creditor_name.localeCompare(b.creditor_name));
  }, [payables]);
  const scheduleByPurchase = useMemo(() => {
    const map = new Map();
    installmentRows.forEach((r) => {
      if (!map.has(r.purchase_id)) map.set(r.purchase_id, []);
      map.get(r.purchase_id).push(r);
    });
    return map;
  }, [installmentRows]);
  const totalOwed = payables.reduce((s, p) => s + Number(p.balance), 0);
  // What is really past due: unpaid installments whose date has passed (not the whole remaining balance).
  // Until 30_payables_overdue_by_installment.sql is run, the old rule is used.
  const overdueOf = (p) => Number(p.overdue_amount ?? (Number(p.days_overdue) > 0 ? p.balance : 0));
  const overdueOwed = payables.reduce((s, p) => s + overdueOf(p), 0);

  const lineLabel = (l) => (l.line_type === 'material' ? l.description : `${l.description} (${l.account_code})`);

  const shownPurchases = useMemo(() => {
    if (!hasFieldFilter(pfilter)) return purchases;
    return purchases.filter((p) => {
      switch (pfilter.field) {
        case 'supplier':
          return textMatch(p.suppliers?.name, pfilter.text);
        case 'creditor':
          return textMatch(p.creditors?.name, pfilter.text);
        case 'material': // any material line of the purchase, by its current name or the name written on the line
          return (p.purchase_lines || []).some(
            (l) => l.line_type === 'material' && (textMatch(matById.get(l.material_id)?.name, pfilter.text) || textMatch(l.description, pfilter.text))
          );
        case 'pur':
          return numberMatch(pfilter.text, 'PUR', p.purchase_no);
        case 'date':
          return dateMatch(pfilter.from, pfilter.to, p.purchase_date);
        default:
          return true;
      }
    });
  }, [purchases, pfilter, matById]);

  // ---------- creditors ----------
  const owedByCreditor = useMemo(() => {
    const map = new Map();
    payables.forEach((p) => p.creditor_id && map.set(p.creditor_id, (map.get(p.creditor_id) || 0) + Number(p.balance)));
    return map;
  }, [payables]);

  const openCredForm = () => {
    setCredName('');
    setCredContact('');
    setCredNotes('');
    setCredError('');
    setCredFormOpen(true);
  };

  const saveCreditor = async (e) => {
    e.preventDefault();
    if (!credName.trim()) return setCredError('Enter the creditor name.');
    setSaving(true);
    setCredError('');
    const { error } = await supabase.from('creditors').insert({ name: credName.trim(), contact_number: nz(credContact), notes: nz(credNotes) });
    setSaving(false);
    if (error) return setCredError(error.code === '23505' ? 'A creditor with this name already exists.' : error.message);
    setCredFormOpen(false);
    await afterChange();
  };

  // ---------- assign creditor to existing credit purchases ----------
  const unassigned = purchases.filter((p) => p.payment_type === 'credit' && p.status === 'Posted' && !p.creditor_id);
  const assignRows = unassigned.filter((p) => (!assignFrom || p.purchase_date >= assignFrom) && (!assignTo || p.purchase_date <= assignTo));
  const assignSelected = assignRows.filter((p) => assignPicked[p.id]);
  const assignTotal = assignSelected.reduce((s, p) => s + cents(p.total), 0);

  const openAssign = () => {
    setAssignFrom('');
    setAssignTo('');
    setAssignCreditor('');
    setAssignReason('The creditor was entered as the supplier');
    setAssignPicked({});
    setAssignError('');
    setAssignOpen(true);
  };

  const saveAssign = async (e) => {
    e.preventDefault();
    if (assignSelected.length === 0) return setAssignError('Select at least one purchase.');
    if (!assignCreditor) return setAssignError('Choose the creditor.');
    if (!assignReason.trim()) return setAssignError('Please give a reason.');
    setSaving(true);
    setAssignError('');
    const { error } = await supabase.rpc('assign_purchase_creditor', {
      p_purchase_ids: assignSelected.map((p) => p.id),
      p_creditor: assignCreditor,
      p_reason: assignReason.trim(),
    });
    setSaving(false);
    if (error) return setAssignError(error.message);
    setAssignOpen(false);
    await afterChange();
  };

  return (
    <div>
      <PageHeader title="Procurement" subtitle="Purchases of materials, assets and expenses, and payments to creditors">
        <button onClick={openForm} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Record Purchase</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {!loading && unassigned.length > 0 && (
        <div className="cs-card p-4 mb-5 flex items-center justify-between gap-3 border border-[#e5a93d]/30">
          <p className="text-xs text-[#a8a090]">
            {unassigned.length} credit purchase{unassigned.length > 1 ? 's have' : ' has'} no creditor yet ({peso(unassigned.reduce((s, p) => s + Number(p.total), 0))}).
            They cannot be paid until you say who you owe.
          </p>
          {isOwner && (
            <button onClick={openAssign} className="cs-btn cs-btn-gold px-4 py-2 text-xs whitespace-nowrap">
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Assign creditor</span>
            </button>
          )}
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'purchases', label: 'Purchases' },
          { id: 'payables', label: `Payables${payables.length ? ` (${payables.length})` : ''}` },
          { id: 'payments', label: 'Payments to creditors' },
          { id: 'creditors', label: 'Creditors' },
        ]}
      />

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : tab === 'purchases' ? (
        <div className="cs-card overflow-hidden">
          {purchases.length > 0 && (
            <FieldSearch
              idPrefix="pu-search"
              fields={PURCHASE_SEARCH_FIELDS}
              filter={pfilter}
              onChange={setPfilter}
              shown={shownPurchases.length}
              total={purchases.length}
              loadedLimit={200}
            />
          )}
          {purchases.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No purchases yet"
              text="Record your first purchase to bring materials into stock."
              actionLabel="Record Purchase"
              onAction={openForm}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 w-8"><span className="sr-only">Details</span></th>
                    <th className="px-4 py-3 font-medium">Purchase</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Supplier</th>
                    <th className="px-4 py-3 font-medium">Creditor</th>
                    <th className="px-4 py-3 font-medium">Paid by</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    {isOwner && <th className={`px-4 py-3 ${STICKY_TH}`}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {shownPurchases.map((p) => {
                    const isOpen = openId === p.id;
                    return (
                      <React.Fragment key={p.id}>
                        <tr className="bg-[#141210] hover:bg-[#1c1916] transition-colors">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setOpenId(isOpen ? null : p.id)}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Hide' : 'Show'} lines of ${purLabel(p.purchase_no)}`}
                              className="text-[#a8a090] hover:text-[#e3bf5a] cursor-pointer"
                            >
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a]">
                            {purLabel(p.purchase_no)}
                            {p.reference && <div className="text-[#a8a090]">{p.reference}</div>}
                          </td>
                          <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(p.purchase_date)}</td>
                          <td className="px-4 py-3">{p.suppliers?.name || <span className="text-[#a8a090]">-</span>}</td>
                          <td className="px-4 py-3">
                            {p.payment_type !== 'credit' ? <span className="text-[#a8a090]">-</span> : p.creditors?.name || <span className="text-xs text-[#e5a93d]">Not assigned</span>}
                          </td>
                          <td className="px-4 py-3"><Badge tone={p.payment_type === 'credit' ? 'amber' : 'gray'}>{PAYMENT_LABEL[p.payment_type]}</Badge></td>
                          <td className="px-4 py-3"><Badge tone={p.status === 'Posted' ? 'green' : 'red'}>{p.status}</Badge></td>
                          <td className="px-4 py-3 text-right font-mono">{peso(p.total)}</td>
                          {isOwner && (
                            <td className={`px-4 py-3 text-right ${STICKY_TD}`}>
                              {p.status === 'Posted' && (
                                <button onClick={() => openVoid('purchase', p)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs" aria-label={`Void ${purLabel(p.purchase_no)}`}>
                                  <Ban className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                                  <span>Void</span>
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                        {isOpen && (
                          <tr className="bg-[#14120f]">
                            <td />
                            <td colSpan={isOwner ? 8 : 7} className="px-4 pb-4">
                              <table className="w-full text-xs">
                                <thead className="text-[#a8a090]">
                                  <tr>
                                    <th className="text-left font-medium py-2">Item</th>
                                    <th className="text-right font-medium py-2">Qty</th>
                                    <th className="text-right font-medium py-2">Unit cost</th>
                                    <th className="text-right font-medium py-2">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...(p.purchase_lines || [])].sort((a, b) => a.line_no - b.line_no).map((l) => (
                                    <tr key={l.id} className="border-t border-[#24201c]">
                                      <td className="py-2">{lineLabel(l)}</td>
                                      <td className="py-2 text-right font-mono">{qty(l.qty)}</td>
                                      <td className="py-2 text-right font-mono">{unitPeso(l.unit_cost)}</td>
                                      <td className="py-2 text-right font-mono">{peso(l.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {p.payment_type === 'credit' && p.due_date && !(scheduleByPurchase.get(p.id) || []).length && (
                                <p className="text-[11px] text-[#a8a090] mt-2">Due {fmtDate(p.due_date)}</p>
                              )}
                              {(scheduleByPurchase.get(p.id) || []).length > 0 && (
                                <div className="mt-3">
                                  <div className="text-[10px] uppercase tracking-wider text-[#a8a090] mb-1">Installment schedule</div>
                                  <table className="w-full text-xs">
                                    <thead className="text-[#a8a090]">
                                      <tr>
                                        <th className="text-left font-medium py-1.5">#</th>
                                        <th className="text-left font-medium py-1.5">Due</th>
                                        <th className="text-right font-medium py-1.5">Principal</th>
                                        <th className="text-right font-medium py-1.5">Interest</th>
                                        <th className="text-right font-medium py-1.5">Balance</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {scheduleByPurchase.get(p.id).map((r) => (
                                        <tr key={r.installment_id} className="border-t border-[#24201c]">
                                          <td className="py-1.5">{r.seq}</td>
                                          <td className="py-1.5">{fmtDate(r.due_date)}</td>
                                          <td className="py-1.5 text-right font-mono">{peso(r.principal_due)}</td>
                                          <td className="py-1.5 text-right font-mono">{peso(r.interest_due)}</td>
                                          <td className={`py-1.5 text-right font-mono ${Number(r.balance) <= 0 ? 'text-[#3ecf8e]' : ''}`}>
                                            {Number(r.balance) <= 0 ? 'Paid' : peso(r.balance)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <p className="text-[10px] text-[#a8a090] mt-2">
                                    Interest is booked as an expense month by month as it accrues, not when the purchase is posted.
                                  </p>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {shownPurchases.length === 0 && (
                    <tr>
                      <td colSpan={isOwner ? 9 : 8} className="px-4 py-8 text-center text-sm text-[#a8a090]">No purchases match your search.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === 'payables' ? (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className="cs-card p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">Total owed to creditors</div>
              <div className="font-serif text-2xl mt-1">{peso(totalOwed)}</div>
            </div>
            <div className="cs-card p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">Overdue</div>
              <div className={`font-serif text-2xl mt-1 ${overdueOwed > 0 ? 'text-[#e5736d]' : 'text-[#3ecf8e]'}`}>{peso(overdueOwed)}</div>
            </div>
          </div>
          {groups.length === 0 ? (
            <div className="cs-card">
              <EmptyState icon={Wallet} title="Nothing owed" text="Purchases made on credit appear here until they are paid." />
            </div>
          ) : (
            groups.map((g) => {
              const owed = g.items.reduce((s, i) => s + Number(i.balance), 0);
              const overdue = g.items.reduce((s, i) => s + overdueOf(i), 0);
              return (
                <div key={g.creditor_id || 'none'} className="cs-card overflow-hidden mb-4">
                  <div className="p-4 border-b border-[#2a2622] flex items-center justify-between gap-3">
                    <div>
                      <div className="font-serif text-lg">{g.creditor_name}</div>
                      <div className="text-xs text-[#a8a090]">{g.items.length} open purchase{g.items.length > 1 ? 's' : ''} · {peso(owed)} owed{overdue > 0 && <span className="text-[#e5736d]"> · {peso(overdue)} overdue</span>}</div>
                    </div>
                    <div className="flex items-center gap-2">
                    {g.creditor_id && (
                      <button onClick={() => setStmt({ creditor_id: g.creditor_id, creditor_name: g.creditor_name })} className="cs-btn cs-btn-ghost px-4 py-2 text-xs">
                        <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Statement</span>
                      </button>
                    )}
                    {isOwner && g.creditor_id && (
                      <button onClick={() => openPay(g)} className="cs-btn cs-btn-gold px-4 py-2 text-xs">
                        <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Pay creditor</span>
                      </button>
                    )}
                    {isOwner && !g.creditor_id && (
                      <button onClick={openAssign} className="cs-btn cs-btn-gold px-4 py-2 text-xs">
                        <Users className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Assign creditor</span>
                      </button>
                    )}
                    </div>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wider text-[#a8a090]">
                      <tr>
                        <th className="px-4 py-2 font-medium">Purchase</th>
                        <th className="px-4 py-2 font-medium">Due</th>
                        <th className="px-4 py-2 font-medium text-right">Total</th>
                        <th className="px-4 py-2 font-medium text-right">Paid</th>
                        <th className="px-4 py-2 font-medium text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#24201c]">
                      {g.items.map((i) => (
                        <tr key={i.purchase_id}>
                          <td className="px-4 py-2 font-mono text-xs text-[#e3bf5a]">
                            {purLabel(i.purchase_no)}
                            {i.reference && <span className="text-[#a8a090]"> · {i.reference}</span>}
                            {i.is_installment && (
                              <div className="text-[10px] text-[#a8a090] font-sans">
                                {i.installments} installments · includes {peso(i.interest_total)} interest{i.not_yet_due != null && ` · ${peso(i.not_yet_due)} not yet due`}
                              </div>
                            )}
                            {!i.is_installment && Number(i.interest_total) > 0 && (
                              <div className="text-[10px] text-[#a8a090] font-sans">includes {peso(i.interest_total)} interest</div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs whitespace-nowrap">
                            {i.is_installment ? (
                              <>
                                {overdueOf(i) > 0 && (
                                  <div className="text-[#e5736d]">
                                    {peso(overdueOf(i))} overdue{i.overdue_installments != null && ` (${i.overdue_installments} installment${Number(i.overdue_installments) === 1 ? '' : 's'})`}
                                    <div className="text-[10px]">Oldest due {fmtDate(i.due_date)} · {i.days_overdue} days late</div>
                                  </div>
                                )}
                                {i.next_upcoming_date ? (
                                  <div className={overdueOf(i) > 0 ? 'text-[10px] text-[#a8a090] mt-0.5' : ''}>
                                    Next due {fmtDate(i.next_upcoming_date)} · {peso(i.next_upcoming_amount)}
                                  </div>
                                ) : (
                                  overdueOf(i) <= 0 && (i.due_date ? fmtDate(i.due_date) : '-')
                                )}
                              </>
                            ) : (
                              <>
                                {i.due_date ? fmtDate(i.due_date) : '-'}
                                {Number(i.days_overdue) > 0 && <span className="ml-2 text-[#e5736d]">{i.days_overdue} days overdue</span>}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">{peso(i.total)}</td>
                          <td className="px-4 py-2 text-right font-mono">{peso(i.paid)}</td>
                          <td className="px-4 py-2 text-right font-mono font-medium">{peso(i.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
          {!isOwner && <p className="text-[11px] text-[#a8a090]">Only the owner can record payments to creditors.</p>}
        </div>
      ) : tab === 'creditors' ? (
        <div className="cs-card overflow-hidden">
          <div className="p-4 border-b border-[#2a2622] flex items-center justify-between gap-3">
            <p className="text-xs text-[#a8a090]">The third parties you owe money to. They are not the same as the suppliers you buy from.</p>
            {isOwner && (
              <button onClick={openCredForm} className="cs-btn cs-btn-gold px-4 py-2 text-xs whitespace-nowrap">
                <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add creditor</span>
              </button>
            )}
          </div>
          {creditors.length === 0 ? (
            <EmptyState icon={Users} title="No creditors yet" text="Add the party you owe, then assign it to your credit purchases." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Creditor</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium text-right">Owed now</th>
                    <th className="px-4 py-3 font-medium"><span className="sr-only">Statement</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {creditors.map((c) => (
                    <tr key={c.id} className="bg-[#141210]">
                      <td className="px-4 py-3">
                        {c.name}
                        {c.notes && <div className="text-xs text-[#a8a090]">{c.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#a8a090]">{c.contact_number || '-'}</td>
                      <td className="px-4 py-3 text-right font-mono">{peso(owedByCreditor.get(c.id) || 0)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setStmt({ creditor_id: c.id, creditor_name: c.name })} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">Statement</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="cs-card overflow-hidden">
          {payments.length === 0 ? (
            <EmptyState icon={Receipt} title="No payments to creditors yet" text="Payments you make against credit purchases will be listed here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Payment</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Creditor</th>
                    <th className="px-4 py-3 font-medium">Method</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    {isOwner && <th className={`px-4 py-3 ${STICKY_TH}`}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {payments.map((p) => (
                    <tr key={p.id} className="bg-[#141210] hover:bg-[#1c1916] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a]">
                        {payLabel(p.pay_no)}
                        {p.reference && <div className="text-[#a8a090]">{p.reference}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(p.pay_date)}</td>
                      <td className="px-4 py-3">{p.creditors?.name || p.suppliers?.name}</td>
                      <td className="px-4 py-3 text-xs">{p.method === 'cash' ? 'Cash' : 'Bank'}</td>
                      <td className="px-4 py-3"><Badge tone={p.status === 'Posted' ? 'green' : 'red'}>{p.status}</Badge></td>
                      <td className="px-4 py-3 text-right font-mono">{peso(p.amount)}</td>
                      {isOwner && (
                        <td className={`px-4 py-3 text-right ${STICKY_TD}`}>
                          {p.status === 'Posted' && (
                            <button onClick={() => openVoid('payment', p)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
                              <Ban className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                              <span>Void</span>
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- Record purchase ---------- */}
      {formOpen && (
        <Modal title="Record Purchase" onClose={() => setFormOpen(false)} dirty={lines.length > 0} xl>
          <form onSubmit={savePurchase} className="space-y-4 lg:flex lg:flex-col lg:space-y-0">
            {/* Everything above the buttons scrolls as one block; the Post / Cancel bar stays pinned below it */}
            <div className="space-y-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pb-4">
            {/* Header fields: one compact band across the top */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-2">
                <label htmlFor="pu-date" className="cs-label">Date</label>
                <input id="pu-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="cs-input px-3 py-2.5" />
              </div>
              <div className="lg:col-span-4">
                <label htmlFor="pu-sup" className="cs-label">Supplier (who sold it, optional)</label>
                <select id="pu-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} className="cs-input px-3 py-2.5">
                  <option value="">No supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-3">
                <label htmlFor="pu-ref" className="cs-label">Invoice / receipt no.</label>
                <input id="pu-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="cs-input px-3 py-2.5" />
              </div>
              <div className="lg:col-span-3">
                <label htmlFor="pu-pay" className="cs-label">Paid by</label>
                <select id="pu-pay" value={payment} onChange={(e) => setPayment(e.target.value)} className="cs-input px-3 py-2.5">
                  <option value="cash">Cash on hand</option>
                  <option value="bank">Bank</option>
                  <option value="credit">On credit (pay later)</option>
                </select>
              </div>

              {payment === 'credit' && (
                <>
                  <div className="lg:col-span-3">
                    <label htmlFor="pu-cred" className="cs-label">Creditor (who you owe)</label>
                    <select id="pu-cred" value={creditor} onChange={(e) => setCreditor(e.target.value)} required className="cs-input px-3 py-2.5">
                      <option value="">Choose creditor</option>
                      {creditors.filter((c) => c.status === 'Active').map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {creditors.length === 0 && <p className="text-[10px] text-[#a8a090] mt-1">Add one in the Creditors tab first.</p>}
                  </div>
                  <div className="lg:col-span-3">
                    <label htmlFor="pu-terms" className="cs-label">Payment terms</label>
                    <select id="pu-terms" value={terms} onChange={(e) => setTerms(e.target.value)} className="cs-input px-3 py-2.5">
                      <option value="full">Pay in full on one date</option>
                      <option value="installment">Monthly installments</option>
                    </select>
                  </div>
                  {terms === 'full' ? (
                    <>
                      <div className="lg:col-span-3">
                        <label htmlFor="pu-due" className="cs-label">Due date</label>
                        <input id="pu-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="cs-input px-3 py-2.5" />
                        <p className="text-[10px] text-[#a8a090] mt-1">Blank = supplier&rsquo;s terms</p>
                      </div>
                      <div className="lg:col-span-3">
                        <label htmlFor="pu-omode" className="cs-label">Interest from creditor</label>
                        <select id="pu-omode" value={oneMode} onChange={(e) => { setOneMode(e.target.value); setOneValue(''); }} className="cs-input px-3 py-2.5">
                          <option value="none">No interest</option>
                          <option value="rate">% of purchase (one time)</option>
                          <option value="amount">Fixed amount</option>
                        </select>
                      </div>
                      {oneMode !== 'none' && (
                        <div className="lg:col-span-3">
                          <label htmlFor="pu-oval" className="cs-label">{oneMode === 'rate' ? '% of purchase' : 'Interest (\u20B1)'}</label>
                          <input id="pu-oval" type="number" min="0" step="any" value={oneValue} onChange={(e) => setOneValue(e.target.value)} className="cs-input px-3 py-2.5 text-right" />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="lg:col-span-2">
                        <label htmlFor="pu-n" className="cs-label">Installments</label>
                        <input id="pu-n" type="number" min="2" max="60" step="1" value={instCount} onChange={(e) => setInstCount(e.target.value)} className="cs-input px-3 py-2.5 text-right" />
                      </div>
                      <div className="lg:col-span-3">
                        <label htmlFor="pu-first" className="cs-label">First due date</label>
                        <input id="pu-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className="cs-input px-3 py-2.5" />
                      </div>
                      <div className="lg:col-span-4">
                        <label htmlFor="pu-imode" className="cs-label">Interest</label>
                        <select id="pu-imode" value={interestMode} onChange={(e) => { setInterestMode(e.target.value); setInterestValue(''); }} className="cs-input px-3 py-2.5">
                          <option value="none">No interest</option>
                          <option value="rate">Rate per month (flat)</option>
                          <option value="amount">Total interest amount</option>
                        </select>
                      </div>
                      {interestMode !== 'none' && (
                        <div className="lg:col-span-3">
                          <label htmlFor="pu-ival" className="cs-label">{interestMode === 'rate' ? '% per month' : 'Total interest (\u20B1)'}</label>
                          <input id="pu-ival" type="number" min="0" step="any" value={interestValue} onChange={(e) => setInterestValue(e.target.value)} className="cs-input px-3 py-2.5 text-right" />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              <div className={payment === 'credit' && terms === 'full' ? 'lg:col-span-3' : payment === 'credit' ? (interestMode === 'none' ? 'lg:col-span-5' : 'lg:col-span-9') : 'lg:col-span-12'}>
                <label htmlFor="pu-notes" className="cs-label">Notes (optional)</label>
                <input id="pu-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="cs-input px-3 py-2.5" />
              </div>
            </div>

            <LateEntryNotice date={date} reason={lateReason} onReason={setLateReason} id="pu-late" />

            {/* Two columns: enter an item on the left, the items already added on the right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* ---- Add item ---- */}
              <div
                className="lg:col-span-5 rounded-xl border border-[#2a2622] p-4 space-y-3 self-start"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    addDraft();
                  }
                }}
              >
                <div className="text-xs uppercase tracking-wider text-[#a8a090]">Add item</div>
                <div className="grid grid-cols-6 gap-3">
                  <div className="col-span-2">
                    <label htmlFor="dr-type" className="cs-label">Type</label>
                    <select
                      id="dr-type"
                      value={draft.line_type}
                      onChange={(e) => setDraft((d) => ({ ...d, line_type: e.target.value, material_id: '', account_code: '', description: '', pack_size: '' }))}
                      className="cs-input px-3 py-2.5"
                    >
                      <option value="material">Material</option>
                      <option value="asset">Asset</option>
                      <option value="expense">Expense</option>
                    </select>
                  </div>
                  <div className="col-span-4">
                    {draft.line_type === 'material' ? (
                      <>
                        <label htmlFor="dr-mat" className="cs-label">Item</label>
                        <select
                          id="dr-mat"
                          value={draft.material_id}
                          onChange={(e) => {
                            const m = matById.get(e.target.value);
                            setDraft((d) => ({ ...d, material_id: e.target.value, pack_size: m && PIECE_UNITS.test(String(m.unit).trim()) ? '1' : '' }));
                          }}
                          className="cs-input px-3 py-2.5"
                        >
                          <option value="">Select material...</option>
                          {MATERIAL_CATEGORIES.map((c) => {
                            const list = materials.filter((m) => m.category === c.id);
                            return list.length ? (
                              <optgroup key={c.id} label={c.label}>
                                {list.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                                ))}
                              </optgroup>
                            ) : null;
                          })}
                        </select>
                      </>
                    ) : (
                      <>
                        <label htmlFor="dr-acc" className="cs-label">Account</label>
                        <select id="dr-acc" value={draft.account_code} onChange={(e) => setDraft((d) => ({ ...d, account_code: e.target.value }))} className="cs-input px-3 py-2.5">
                          <option value="">Select account...</option>
                          {(draft.line_type === 'asset' ? ASSET_ACCOUNTS : expenseAccounts).map((a) => (
                            <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                </div>
                {draft.line_type === 'material' && materials.length === 0 && (
                  <p className="text-[10px] text-[#e5a93d]">No materials yet. Add them first under Raw Materials.</p>
                )}
                {draft.line_type !== 'material' && (
                  <div>
                    <label htmlFor="dr-desc" className="cs-label">Description</label>
                    <input id="dr-desc" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Describe the item" className="cs-input px-3 py-2.5" />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  {draft.line_type === 'material' ? (
                    <div>
                      <label htmlFor="dr-size" className="cs-label">
                        Size / pack{matById.get(draft.material_id) ? ` (${matById.get(draft.material_id).unit})` : ''}
                      </label>
                      <input id="dr-size" type="number" min="0" step="any" placeholder="e.g. 1000" value={draft.pack_size} onChange={(e) => setDraft((d) => ({ ...d, pack_size: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
                    </div>
                  ) : null}
                  <div>
                    <label htmlFor="dr-qty" className="cs-label">{draft.line_type === 'material' ? 'Packs' : 'Qty'}</label>
                    <input id="dr-qty" type="number" min="0" step="any" placeholder={draft.line_type === 'material' ? 'Packs' : 'Qty'} value={draft.qty} onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
                  </div>
                  <div>
                    <label htmlFor="dr-cost" className="cs-label">{draft.line_type === 'material' ? 'Price / pack' : 'Cost each'}</label>
                    <input id="dr-cost" type="number" min="0" step="any" placeholder="0.00" value={draft.unit_cost} onChange={(e) => setDraft((d) => ({ ...d, unit_cost: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
                  </div>
                </div>

                {(() => {
                  const info = stockInfo(draft);
                  return info && info.ready ? (
                    <p className="text-[11px] text-[#a8a090]">
                      Adds <span className="font-mono text-[#ece6d8]">{qty(info.baseQty)} {info.m.unit}</span> to stock at{' '}
                      <span className="font-mono text-[#ece6d8]">{unitPeso(info.perUnit)}</span> per {info.m.unit}
                    </p>
                  ) : null;
                })()}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-[#a8a090]">
                    Amount <span className="font-mono text-sm text-[#ece6d8] ml-1">{peso(lineAmount(draft) / 100)}</span>
                  </div>
                  <button type="button" onClick={addDraft} className="cs-btn cs-btn-gold px-4 py-2 text-xs">
                    <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Add item</span>
                  </button>
                </div>
                {draftError && <p role="alert" className="text-xs text-[#e5736d]">{draftError}</p>}
                <p className="text-[10px] leading-relaxed text-[#a8a090]">
                  Materials: enter the packs bought, the size of each pack (e.g. 1000 for a 1-liter bottle of an ml item) and the price per pack. Stock is used oldest first.
                  Assets and expenses go straight to the books.
                </p>
              </div>

              {/* ---- Items added ---- */}
              <div className="lg:col-span-7 flex flex-col gap-3 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider text-[#a8a090]">Items in this purchase</div>
                  <span className="text-xs text-[#a8a090]">{lines.length} {lines.length === 1 ? 'item' : 'items'}</span>
                </div>
                <div className="rounded-xl border border-[#2a2622] min-h-[200px] max-h-[300px] overflow-y-auto">
                  {lines.length === 0 ? (
                    <div className="h-[200px] flex items-center justify-center text-xs text-[#a8a090] px-6 text-center">
                      Nothing added yet. Fill in the item on the left and click &ldquo;Add item&rdquo;.
                    </div>
                  ) : (
                    <ul>
                      {lines.map((l, i) => (
                        <li key={l.key} className="flex items-center gap-3 px-4 py-2.5 border-b border-[#24201c] last:border-b-0">
                          <span className="text-[10px] text-[#a8a090] w-4">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm truncate">{lineTitle(l)}</div>
                            <div className="text-[11px] text-[#a8a090] truncate">{lineDetail(l)}</div>
                          </div>
                          <span className="font-mono text-sm whitespace-nowrap">{peso(lineAmount(l) / 100)}</span>
                          <button type="button" onClick={() => editLine(l)} className="text-[11px] text-[#d9b24c] hover:underline cursor-pointer" aria-label={`Edit item ${i + 1}`}>Edit</button>
                          <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="text-[#a8a090] hover:text-[#e5736d] cursor-pointer" aria-label={`Remove item ${i + 1}`}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {plan && plan.valid && (
                  <div className="rounded-xl border border-[#2a2622] px-4 py-2 max-h-[140px] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[#a8a090] sticky top-0 bg-[#141210]">
                        <tr>
                          <th className="text-left font-medium py-1">#</th>
                          <th className="text-left font-medium py-1">Due</th>
                          <th className="text-right font-medium py-1">Principal</th>
                          <th className="text-right font-medium py-1">Interest</th>
                          <th className="text-right font-medium py-1">Installment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.rows.map((r) => (
                          <tr key={r.seq} className="border-t border-[#24201c]">
                            <td className="py-1">{r.seq}</td>
                            <td className="py-1">{fmtDate(r.due)}</td>
                            <td className="py-1 text-right font-mono">{peso(r.principal / 100)}</td>
                            <td className="py-1 text-right font-mono">{peso(r.interest / 100)}</td>
                            <td className="py-1 text-right font-mono">{peso((r.principal + r.interest) / 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {payment === 'credit' && terms === 'installment' && (
                  <p className="text-[10px] leading-relaxed text-[#a8a090]">
                    Interest is not added to the cost of the materials. It is recorded as Interest Expense month by month and owed as Interest Payable until paid.
                  </p>
                )}

                {payment === 'credit' && terms === 'full' && oneInterestCents > 0 && (
                  <>
                    <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 text-xs space-y-1">
                      <div className="flex justify-between"><span className="text-[#a8a090]">Items</span><span className="font-mono">{peso(total / 100)}</span></div>
                      <div className="flex justify-between"><span className="text-[#a8a090]">Interest</span><span className="font-mono">{peso(oneInterestCents / 100)}</span></div>
                      <div className="flex justify-between"><span className="text-[#a8a090]">Pay on {due ? fmtDate(due) : 'the due date'}</span><span className="font-mono">{peso((total + oneInterestCents) / 100)}</span></div>
                    </div>
                    <p className="text-[10px] leading-relaxed text-[#a8a090]">
                      Interest is not added to the cost of the materials. It is owed together with the purchase and recorded as Interest Expense only when it is paid.
                    </p>
                  </>
                )}

                <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 flex items-center justify-between text-sm mt-auto">
                  <span className="text-[10px] uppercase tracking-wider text-[#a8a090]">
                    Purchase total{(plan && plan.valid) || oneInterestCents > 0 ? ' (with interest)' : ''}
                  </span>
                  <span className="font-mono text-lg">{peso((total + (plan && plan.valid ? plan.interestCents : oneInterestCents)) / 100)}</span>
                </div>
              </div>
            </div>

            </div>

            <ModalActions error={formError}>
              <button type="button" onClick={() => setFormOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving || total <= 0} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">
                {saving ? 'Posting...' : 'Post Purchase'}
              </button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Pay supplier ---------- */}
      {stmt && (
        <CreditorStatement
          stmt={stmt}
          purchases={purchases}
          installmentRows={installmentRows}
          payAllocs={payAllocs}
          instPays={instPays}
          payments={payments}
          onClose={() => setStmt(null)}
        />
      )}

      {paying && (
        <Modal title={`Pay ${paying.creditor_name}`} onClose={() => setPaying(null)}>
          <form onSubmit={savePayment} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="py-date" className="cs-label">Date</label>
                <input id="py-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required className="cs-input px-3 py-2.5" />
              </div>
              <div>
                <label htmlFor="py-method" className="cs-label">Paid from</label>
                <select id="py-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="cs-input px-3 py-2.5">
                  <option value="cash">Cash on hand</option>
                  <option value="bank">Bank</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="py-ref" className="cs-label">Reference (optional)</label>
              <input id="py-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="e.g. check or transfer no." className="cs-input px-3 py-2.5" />
            </div>
            <div className="space-y-2">
              {paying.items.map((i) => (
                <div key={i.purchase_id} className="grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-7 text-xs">
                    <span className="font-mono text-[#e3bf5a]">{purLabel(i.purchase_no)}</span>
                    <span className="text-[#a8a090]"> · balance {peso(i.balance)}</span>
                    {i.is_installment && <span className="block text-[10px] text-[#a8a090]">{overdueOf(i) > 0 ? `Overdue ${peso(overdueOf(i))}${i.overdue_installments != null ? ` (${i.overdue_installments} installment${Number(i.overdue_installments) === 1 ? '' : 's'})` : ''}` : `Next installment ${peso(i.next_due_balance)}`} · paid oldest installment first, interest first</span>}
                    {!i.is_installment && Number(i.interest_total) > 0 && <span className="block text-[10px] text-[#a8a090]">includes {peso(i.interest_total)} interest · interest is paid first</span>}
                  </div>
                  <div className="col-span-5">
                    <label htmlFor={`pa-${i.purchase_id}`} className="sr-only">Amount for {purLabel(i.purchase_no)}</label>
                    <input
                      id={`pa-${i.purchase_id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={payAmounts[i.purchase_id] ?? ''}
                      onChange={(e) => setPayAmounts((p) => ({ ...p, [i.purchase_id]: e.target.value }))}
                      className="cs-input px-3 py-2 text-right"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-[10px] uppercase tracking-wider text-[#a8a090]">Total payment</span>
              <span className="font-mono text-lg">{peso(payTotal / 100)}</span>
            </div>
            <ModalActions error={payError}>
              <button type="button" onClick={() => setPaying(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving || payTotal <= 0} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">
                {saving ? 'Posting...' : 'Post Payment'}
              </button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Add creditor ---------- */}
      {credFormOpen && (
        <Modal title="Add Creditor" onClose={() => setCredFormOpen(false)}>
          <form onSubmit={saveCreditor} className="space-y-4">
            <div>
              <label htmlFor="cr-name" className="cs-label">Name</label>
              <input id="cr-name" value={credName} onChange={(e) => setCredName(e.target.value)} required autoFocus className="cs-input px-3 py-2.5" />
            </div>
            <div>
              <label htmlFor="cr-contact" className="cs-label">Contact number (optional)</label>
              <input id="cr-contact" value={credContact} onChange={(e) => setCredContact(e.target.value)} className="cs-input px-3 py-2.5" />
            </div>
            <div>
              <label htmlFor="cr-notes" className="cs-label">Notes (optional)</label>
              <input id="cr-notes" value={credNotes} onChange={(e) => setCredNotes(e.target.value)} className="cs-input px-3 py-2.5" />
            </div>
            <ModalActions error={credError}>
              <button type="button" onClick={() => setCredFormOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">{saving ? 'Saving...' : 'Save Creditor'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Assign creditor to existing credit purchases ---------- */}
      {assignOpen && (
        <Modal title="Assign Creditor" onClose={() => setAssignOpen(false)} wide>
          <form onSubmit={saveAssign} className="space-y-4">
            <p className="text-sm text-[#a8a090]">
              This only records who you owe. Amounts, dates, invoice numbers and the journal entries do not change, and nothing is voided.
              Each change is saved in a log with your reason. Payments already made on these purchases move to the same creditor.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="as-from" className="cs-label">Purchases from</label>
                <input id="as-from" type="date" value={assignFrom} onChange={(e) => setAssignFrom(e.target.value)} className="cs-input px-3 py-2.5" />
              </div>
              <div>
                <label htmlFor="as-to" className="cs-label">To</label>
                <input id="as-to" type="date" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="cs-input px-3 py-2.5" />
              </div>
              <div>
                <label htmlFor="as-cred" className="cs-label">Creditor</label>
                <select id="as-cred" value={assignCreditor} onChange={(e) => setAssignCreditor(e.target.value)} className="cs-input px-3 py-2.5">
                  <option value="">Choose creditor</option>
                  {creditors.filter((c) => c.status === 'Active').map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {creditors.length === 0 && <p className="text-[10px] text-[#a8a090] mt-1">Add the creditor in the Creditors tab first.</p>}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <button type="button" className="cs-btn cs-btn-ghost px-3 py-1.5" onClick={() => setAssignPicked(Object.fromEntries(assignRows.map((p) => [p.id, true])))}>
                Select all shown ({assignRows.length})
              </button>
              <button type="button" className="cs-btn cs-btn-ghost px-3 py-1.5" onClick={() => setAssignPicked({})}>Clear</button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-[#2a2622]">
              {assignRows.length === 0 ? (
                <p className="p-4 text-xs text-[#a8a090]">No credit purchases without a creditor in this period.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-[#24201c]">
                    {assignRows.map((p) => (
                      <tr key={p.id} className="bg-[#141210]">
                        <td className="px-3 py-2 w-8">
                          <input
                            type="checkbox"
                            aria-label={`Select ${purLabel(p.purchase_no)}`}
                            checked={!!assignPicked[p.id]}
                            onChange={(e) => setAssignPicked((s) => ({ ...s, [p.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-[#e3bf5a]">{purLabel(p.purchase_no)}</td>
                        <td className="px-3 py-2 text-[#a8a090] whitespace-nowrap">{fmtDate(p.purchase_date)}</td>
                        <td className="px-3 py-2">{p.suppliers?.name || '-'}</td>
                        <td className="px-3 py-2 text-right font-mono">{peso(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <label htmlFor="as-reason" className="cs-label">Reason</label>
              <input id="as-reason" value={assignReason} onChange={(e) => setAssignReason(e.target.value)} required className="cs-input px-3.5 py-2.5" />
            </div>
            <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-[10px] uppercase tracking-wider text-[#a8a090]">{assignSelected.length} selected</span>
              <span className="font-mono text-lg">{peso(assignTotal / 100)}</span>
            </div>
            <ModalActions error={assignError}>
              <button type="button" onClick={() => setAssignOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving || assignSelected.length === 0} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">
                {saving ? 'Saving...' : 'Assign Creditor'}
              </button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Void ---------- */}
      {voiding && (
        <Modal
          title={`Void ${voiding.kind === 'purchase' ? purLabel(voiding.row.purchase_no) : payLabel(voiding.row.pay_no)}`}
          onClose={() => setVoiding(null)}
        >
          <form onSubmit={doVoid} className="space-y-4">
            <p className="text-sm text-[#a8a090]">
              {voiding.kind === 'purchase'
                ? 'This reverses the purchase in the books and removes its materials from stock. It only works if nothing was paid and none of the materials were used yet.'
                : 'This reverses the payment in the books and puts the amount back on the creditor\u2019s balance.'}
            </p>
            <div>
              <label htmlFor="void-reason" className="cs-label">Reason</label>
              <input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" required autoFocus className="cs-input px-3.5 py-2.5" />
            </div>
            <ModalActions error={voidError}>
              <button type="button" onClick={() => setVoiding(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Voiding...' : 'Void'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}
