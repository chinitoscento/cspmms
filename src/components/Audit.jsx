import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, RefreshCw, CheckCircle2, AlertTriangle, Search, ListChecks, ScrollText, FileSearch, Boxes, Archive, Download } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, ModalActions, peso, fmtDate } from './ui';

// ---------------------------------------------------------------------------
// Audit (owner only). The checks are READ ONLY: they never save, edit or delete any record.
// They only call the audit_* functions from file 27_audit_readonly.sql.
// The one thing that can be saved is a stock count report (file 33_stock_count_reports_migration.sql):
// a frozen copy of a physical count. It never changes stock, stock layers or the ledger.
// ---------------------------------------------------------------------------

const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const fmtStamp = (ts) =>
  ts ? new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

const KIND_LABEL = { material: 'Raw materials', juice: 'Matured juice', bottled: 'Bottled, not packaged', finished: 'Finished goods' };
const MOVE_LABEL = { in: 'In', out: 'Out', void: 'Put back (void)' };

// Plain-language help for each check: what it means and what to do
const CHECK_HELP = {
  RET_NO_JOURNAL: 'The return was approved but the books were not updated. Open it in Sales and look at the invoice trace here. Do not approve it again. Ask your developer to fix it by a correction entry.',
  RET_NO_STOCK_IN: 'A piece was supposed to come back to the shelf but the stock record has nothing for it. Count that item on the shelf (Stock count tab) to see which side is right.',
  RET_NO_STOCK_OUT: 'A replacement was given out but the stock record has nothing for it. Count that item on the shelf (Stock count tab).',
  MOVE_NO_DOC: 'Stock moved with no invoice, batch, purchase or slip behind it. Find out who did it and why. Nothing should move without a document.',
  DOC_NO_MOVE: 'A document exists but its stock did not move. The shelf and the system may now disagree. Count the item.',
  JE_UNBALANCED: 'A journal entry where debits and credits differ. This should be impossible, so tell your developer at once.',
  AR_MISMATCH: 'What the customer owes by invoices differs from what the ledger says. Open the invoice trace for that customer’s invoices.',
  AR_UNTAGGED: 'Some receivable amounts are not linked to a customer. Check the Journal Ledger for account 1100.',
  STOCK_VS_LEDGER: 'The value of stock does not equal the ledger account. A stock move and its journal entry did not happen together.',
  LAYER_VS_LOG: 'A stock layer’s remaining quantity differs from what its own movement history adds up to. Tell your developer.',
  PENDING_OLD: 'Waiting for you for more than 3 days. Open Sales and approve or reject it.',
};

function Badge({ tone = 'gray', children }) {
  const tones = {
    green: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    amber: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
    red: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
    gray: 'bg-[#1c1916] text-[#a8a090] border-[#2a2622]',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

const Th = ({ children, right }) => <th className={`px-4 py-3 font-medium ${right ? 'text-right' : ''}`}>{children}</th>;
const THEAD = 'bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]';

// ======================================================================
// Tab 1: Exceptions
// ======================================================================
function Exceptions() {
  const [rows, setRows] = useState(null);
  const [recon, setRecon] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ranAt, setRanAt] = useState(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr('');
    const [ex, sv] = await Promise.all([supabase.rpc('audit_exceptions'), supabase.rpc('audit_stock_value')]);
    if (ex.error || sv.error) setErr((ex.error || sv.error).message);
    else {
      setRows(ex.data || []);
      setRecon(sv.data || []);
      setRanAt(new Date());
    }
    setBusy(false);
  }, []);
  useEffect(() => {
    run();
  }, [run]);

  const groups = useMemo(() => {
    const g = new Map();
    (rows || []).forEach((r) => {
      const key = r.check_name;
      if (!g.has(key)) g.set(key, { name: key, severity: r.severity, code: r.check_code, items: [] });
      g.get(key).items.push(r);
    });
    return [...g.values()];
  }, [rows]);

  return (
    <div className="space-y-5">
      <ErrorNote>{err}</ErrorNote>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#a8a090]">
          Reads your books and stock and lists anything that does not line up. It changes nothing.
          {ranAt && <span> Checked {fmtStamp(ranAt)}.</span>}
        </p>
        <button onClick={run} disabled={busy} className="cs-btn cs-btn-ghost px-4 py-2.5">
          <RefreshCw className={`w-4 h-4 text-[#d9b24c] ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{busy ? 'Checking...' : 'Check again'}</span>
        </button>
      </div>

      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-[#3ecf8e]/30 bg-[#3ecf8e]/10 px-5 py-4 flex items-center gap-3 text-sm">
          <CheckCircle2 className="w-5 h-5 text-[#3ecf8e] shrink-0" aria-hidden="true" />
          <span><strong className="text-[#3ecf8e]">No exceptions found.</strong> <span className="text-[#a8a090]">Every check passed.</span></span>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.name} className="cs-card overflow-hidden">
          <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-[#24201c]">
            <div>
              <h3 className="text-[15px] font-semibold flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 ${g.severity === 'high' ? 'text-[#e5736d]' : 'text-[#e5a93d]'}`} aria-hidden="true" />
                {g.name}
              </h3>
              <p className="text-xs text-[#a8a090] mt-1 max-w-3xl">{CHECK_HELP[g.code]}</p>
            </div>
            <Badge tone={g.severity === 'high' ? 'red' : 'amber'}>{g.items.length} found</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <Th>Document</Th>
                  <Th>Date</Th>
                  <Th>What is wrong</Th>
                  <Th right>Amount</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                {g.items.map((r, i) => (
                  <tr key={`${r.source_id}-${i}`} className="bg-[#141210] hover:bg-[#1c1916] transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a] whitespace-nowrap">{r.doc_ref}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#a8a090]">{r.doc_date ? fmtDate(r.doc_date) : '-'}</td>
                    <td className="px-4 py-3">{r.detail}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{r.amount == null ? '-' : peso(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="cs-card overflow-hidden">
        <div className="px-5 py-4 border-b border-[#24201c]">
          <h3 className="text-[15px] font-semibold">Stock value vs the ledger</h3>
          <p className="text-xs text-[#a8a090] mt-1">Each line should show a difference of zero.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={THEAD}>
              <tr>
                <Th>Account</Th>
                <Th right>Stock layers</Th>
                <Th right>Ledger</Th>
                <Th right>Difference</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#24201c]">
              {recon.map((r) => {
                const bad = Math.abs(Number(r.difference)) > 0.005;
                return (
                  <tr key={r.account_code} className="bg-[#141210]">
                    <td className="px-4 py-3"><span className="font-mono text-xs text-[#e3bf5a] mr-2">{r.account_code}</span>{r.account_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{peso(r.stock_value)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{peso(r.ledger_balance)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${bad ? 'text-[#e5736d] font-semibold' : 'text-[#3ecf8e]'}`}>{peso(r.difference)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ======================================================================
// Tab 2: Movement log
// ======================================================================
function MovementLog() {
  const [items, setItems] = useState([]);
  const [kind, setKind] = useState('');
  const [item, setItem] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [find, setFind] = useState('');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('audit_stock_items').then(({ data, error }) => {
      if (error) setErr(error.message);
      else setItems(data || []);
    });
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('audit_movement_log', {
      p_kind: kind || null,
      p_item: item || null,
      p_from: from || null,
      p_to: to || null,
      p_limit: 1500,
    });
    if (error) setErr(error.message);
    else setRows(data || []);
    setBusy(false);
  }, [kind, item, from, to]);
  useEffect(() => {
    load();
  }, [load]);

  const itemChoices = items.filter((i) => !kind || i.stock_kind === kind);
  const shown = rows.filter((r) => {
    if (!find.trim()) return true;
    return `${r.item_name} ${r.doc_ref} ${r.by_name}`.toLowerCase().includes(find.trim().toLowerCase());
  });
  const single = !!item;

  return (
    <div className="space-y-4">
      <ErrorNote>{err}</ErrorNote>
      <div className="cs-card p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div>
          <label htmlFor="a-kind" className="cs-label">Kind of stock</label>
          <select id="a-kind" value={kind} onChange={(e) => { setKind(e.target.value); setItem(''); }} className="cs-input px-3 py-2">
            <option value="">All</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="a-item" className="cs-label">Item</label>
          <select id="a-item" value={item} onChange={(e) => setItem(e.target.value)} className="cs-input px-3 py-2">
            <option value="">All items</option>
            {itemChoices.map((i) => <option key={`${i.stock_kind}-${i.item_id}`} value={i.item_id}>{i.item_name}{kind ? '' : ` · ${KIND_LABEL[i.stock_kind]}`}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="a-from" className="cs-label">From</label>
          <input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="cs-input px-3 py-2" />
        </div>
        <div>
          <label htmlFor="a-to" className="cs-label">To</label>
          <input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="cs-input px-3 py-2" />
        </div>
        <div className="md:col-span-5 relative">
          <Search className="w-4 h-4 text-[#a8a090] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find by item, document or person" className="cs-input pl-9 pr-3 py-2" aria-label="Find in the movement log" />
        </div>
      </div>

      <p className="text-xs text-[#a8a090]">
        Newest first. Running balance is per item and counts from its very first movement. Showing {shown.length} of {rows.length} line(s){rows.length >= 1500 ? ' (the newest 1,500; narrow the dates to see more)' : ''}.
        {!single && ' Pick one item to read its balance as one continuous story.'}
      </p>

      <div className="cs-card overflow-hidden">
        {busy && rows.length === 0 ? (
          <p className="p-6 text-sm text-[#a8a090]">Loading...</p>
        ) : shown.length === 0 ? (
          <EmptyState icon={Boxes} title="No movements" text="Nothing matches these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <Th>Date</Th>
                  <Th>Item</Th>
                  <Th>Movement</Th>
                  <Th>Document</Th>
                  <Th right>Qty</Th>
                  <Th right>Cost</Th>
                  <Th right>Balance qty</Th>
                  <Th right>Balance value</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                {shown.map((r, i) => (
                  <tr key={`${r.created_at}-${i}`} className="bg-[#141210] hover:bg-[#1c1916] transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>{fmtDate(r.move_date)}</div>
                      <div className="text-[10px] text-[#7d766a]">{fmtStamp(r.created_at)}</div>
                    </td>
                    <td className="px-4 py-3">{r.item_name}</td>
                    <td className="px-4 py-3"><Badge tone={r.move_type === 'in' ? 'green' : r.move_type === 'out' ? 'amber' : 'gray'}>{MOVE_LABEL[r.move_type] || r.move_type}</Badge></td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                      <span className="text-[#e3bf5a]">{r.doc_ref}</span>
                      {!r.doc_found && <span className="ml-2"><Badge tone="red">no document</Badge></span>}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${Number(r.qty) < 0 ? 'text-[#e5a93d]' : ''}`}>{qty(r.qty)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{peso(r.cost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{qty(r.running_qty)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{peso(r.running_cost)}</td>
                    <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{r.by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ======================================================================
// Tab 3: Invoice trace
// ======================================================================
const STEP_LABEL = { sale: 'Sale', decision: 'Approval', journal: 'Journal entry', return: 'Return / exchange', payment: 'Payment', stock: 'Stock' };
const STEP_TONE = { sale: 'gray', decision: 'amber', journal: 'green', return: 'amber', payment: 'green', stock: 'gray' };

function InvoiceTrace() {
  const [list, setList] = useState([]);
  const [find, setFind] = useState('');
  const [sale, setSale] = useState('');
  const [steps, setSteps] = useState([]);
  const [open, setOpen] = useState(null); // journal entry id being viewed
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('audit_invoice_list').then(({ data, error }) => {
      if (error) setErr(error.message);
      else setList(data || []);
    });
  }, []);

  const pad = (n) => String(n).padStart(4, '0');
  const choices = list.filter((s) => {
    if (!find.trim()) return true;
    return `inv-${pad(s.invoice_no)} ${s.invoice_no} ${s.customer_name} ${s.total}`.toLowerCase().includes(find.trim().toLowerCase());
  });

  const trace = async (id) => {
    setSale(id);
    setOpen(null);
    setSteps([]);
    if (!id) return;
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('audit_invoice_trace', { p_sale: id });
    if (error) setErr(error.message);
    else setSteps(data || []);
    setBusy(false);
  };

  const viewEntry = async (id) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setLines([]);
    const { data, error } = await supabase.rpc('audit_entry_lines', { p_entry: id });
    if (error) setErr(error.message);
    else setLines(data || []);
  };

  const current = list.find((s) => s.sale_id === sale);

  return (
    <div className="space-y-4">
      <ErrorNote>{err}</ErrorNote>
      <div className="cs-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative">
          <label htmlFor="a-inv-find" className="cs-label">Find an invoice</label>
          <Search className="w-4 h-4 text-[#a8a090] absolute left-3 bottom-3" aria-hidden="true" />
          <input id="a-inv-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Number, customer or amount" className="cs-input pl-9 pr-3 py-2" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="a-inv" className="cs-label">Invoice</label>
          <select id="a-inv" value={sale} onChange={(e) => trace(e.target.value)} className="cs-input px-3 py-2">
            <option value="">Choose an invoice</option>
            {choices.map((s) => (
              <option key={s.sale_id} value={s.sale_id}>
                INV-{pad(s.invoice_no)} · {s.customer_name} · {peso(s.total)} · {s.status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!sale ? (
        <div className="cs-card"><EmptyState icon={FileSearch} title="Choose an invoice" text="You will see every step: the sale, its returns, payments, journal entries and stock moves, with who did it and when." /></div>
      ) : (
        <div className="cs-card overflow-hidden">
          {current && (
            <div className="px-5 py-4 border-b border-[#24201c] text-sm flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="font-mono text-[#e3bf5a]">INV-{pad(current.invoice_no)}</span>
              <span>{current.customer_name}</span>
              <span className="text-[#a8a090]">{current.payment_type} · {peso(current.total)}</span>
              <Badge tone={current.status === 'Posted' ? 'green' : 'gray'}>{current.status}</Badge>
            </div>
          )}
          {busy ? (
            <p className="p-6 text-sm text-[#a8a090]">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className={THEAD}>
                  <tr>
                    <Th>When</Th>
                    <Th>Step</Th>
                    <Th>Document</Th>
                    <Th>What happened</Th>
                    <Th right>Amount</Th>
                    <Th>Status</Th>
                    <Th>By</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {steps.map((s, i) => (
                    <React.Fragment key={`${s.sort_at}-${i}`}>
                      <tr className="bg-[#141210] hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-xs">{fmtStamp(s.sort_at)}</td>
                        <td className="px-4 py-3"><Badge tone={STEP_TONE[s.step_type]}>{STEP_LABEL[s.step_type] || s.step_type}</Badge></td>
                        <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a] whitespace-nowrap">
                          {s.entry_id ? (
                            <button type="button" onClick={() => viewEntry(s.entry_id)} className="hover:underline cursor-pointer" aria-expanded={open === s.entry_id}>
                              {s.doc_ref} · #{s.entry_no}
                            </button>
                          ) : (
                            s.doc_ref
                          )}
                        </td>
                        <td className="px-4 py-3">{s.description}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{s.amount == null ? '-' : peso(s.amount)}</td>
                        <td className="px-4 py-3 text-xs text-[#a8a090]">{s.status}</td>
                        <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{s.by_name || '-'}</td>
                      </tr>
                      {s.entry_id && open === s.entry_id && (
                        <tr className="bg-[#100f0d]">
                          <td colSpan={7} className="px-8 py-3">
                            <table className="w-full text-xs">
                              <thead className="text-[#7d766a]">
                                <tr><th className="text-left py-1">Account</th><th className="text-right py-1">Debit</th><th className="text-right py-1">Credit</th><th className="text-left py-1 pl-4">Memo</th></tr>
                              </thead>
                              <tbody>
                                {lines.map((l) => (
                                  <tr key={l.line_no}>
                                    <td className="py-1"><span className="font-mono text-[#e3bf5a] mr-2">{l.account_code}</span>{l.account_name}</td>
                                    <td className="py-1 text-right tabular-nums">{Number(l.debit) ? peso(l.debit) : ''}</td>
                                    <td className="py-1 text-right tabular-nums">{Number(l.credit) ? peso(l.credit) : ''}</td>
                                    <td className="py-1 pl-4 text-[#a8a090]">{l.memo}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ======================================================================
// Tab 4: Stock count vs system (typed counts stay on this page until saved as a report; counting never changes any record)
// ======================================================================
function StockCount({ counts, setCounts, onSaved }) {
  const [sheet, setSheet] = useState([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [kind, setKind] = useState('finished');
  const [err, setErr] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    const { data, error } = await supabase.rpc('audit_count_sheet');
    if (error) setErr(error.message);
    else setSheet(data || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const rows = sheet
    .filter((r) => r.stock_kind === kind)
    .map((r) => {
      const typed = counts[r.item_id];
      const has = typed !== undefined && typed !== '';
      const counted = has ? Number(typed) : null;
      const diff = has ? counted - Number(r.system_qty) : null;
      const unitCost = Number(r.system_qty) > 0 ? Number(r.system_value) / Number(r.system_qty) : null;
      return { ...r, typed, has, diff, valueDiff: has && unitCost != null ? diff * unitCost : null };
    });
  const shown = onlyDiff ? rows.filter((r) => r.has && Math.abs(r.diff) > 0.0005) : rows;
  const counted = rows.filter((r) => r.has).length;
  const off = rows.filter((r) => r.has && Math.abs(r.diff) > 0.0005);
  const decimals = kind === 'finished' || kind === 'bottled' ? 0 : 3;
  const totalTyped = Object.values(counts).filter((v) => v !== undefined && v !== '').length;

  return (
    <div className="space-y-4">
      <ErrorNote>{err}</ErrorNote>
      <div className="rounded-xl border border-[#2a2622] bg-[#141210] px-5 py-3 text-sm text-[#a8a090]">
        Type what you actually count on the shelf. The page shows the difference from the system. Counting never changes your stock or books. <strong className="text-[#ece6d8]">Save a count report</strong> to keep a copy; otherwise leaving the Audit page clears it. Leave a row empty if you did not count it.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="c-kind" className="cs-label">Count</label>
          <select id="c-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="cs-input px-3 py-2">
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          Show only differences
        </label>
        <button onClick={() => setSaveOpen(true)} disabled={totalTyped === 0} className="cs-btn cs-btn-gold px-4 py-2.5 ml-auto">
          <Archive className="w-4 h-4" aria-hidden="true" />
          <span>Save count report</span>
        </button>
        <button onClick={() => setCounts({})} className="cs-btn cs-btn-ghost px-4 py-2.5">Clear all counts</button>
        <button onClick={load} className="cs-btn cs-btn-ghost px-4 py-2.5"><RefreshCw className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" /><span>Reload system quantities</span></button>
      </div>

      <p className="text-sm">
        {counted} counted · {off.length === 0 ? <span className="text-[#3ecf8e]">no differences</span> : <span className="text-[#e5736d]">{off.length} difference(s)</span>}
      </p>

      <div className="cs-card overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState icon={ListChecks} title={onlyDiff ? 'No differences' : 'Nothing to count'} text={onlyDiff ? 'Every item you counted matches the system.' : 'No items in this group.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <Th>Item</Th>
                  <Th right>System says</Th>
                  <Th right>You counted</Th>
                  <Th right>Difference</Th>
                  <Th right>Approx. value</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                {shown.map((r) => {
                  const bad = r.has && Math.abs(r.diff) > 0.0005;
                  return (
                    <tr key={r.item_id} className={`bg-[#141210] ${bad ? 'bg-[#2a1a19]/40' : ''}`}>
                      <td className="px-4 py-3">{r.item_name}<div className="text-[10px] text-[#7d766a]">{r.group_name}</div></td>
                      <td className="px-4 py-3 text-right tabular-nums">{qty(r.system_qty)} <span className="text-xs text-[#7d766a]">{r.unit}</span></td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step={decimals === 0 ? '1' : 'any'}
                          value={r.typed ?? ''}
                          onChange={(e) => setCounts((p) => ({ ...p, [r.item_id]: e.target.value }))}
                          aria-label={`Counted quantity of ${r.item_name}`}
                          className="cs-input px-3 py-1.5 w-28 text-right"
                        />
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${!r.has ? 'text-[#7d766a]' : bad ? 'text-[#e5736d]' : 'text-[#3ecf8e]'}`}>
                        {!r.has ? '-' : `${r.diff > 0 ? '+' : ''}${qty(r.diff)}`}
                        {r.has && bad && <span className="block text-[10px] font-normal">{r.diff < 0 ? 'missing on shelf' : 'extra on shelf'}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#a8a090]">{r.valueDiff == null ? '-' : peso(r.valueDiff)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-[#7d766a]">A difference is a clue, not a correction, and a saved report does not change stock or books either. To fix a real loss, use Stock Write-offs (materials) or ask your developer, so the books and the stock stay in step.</p>

      {saveOpen && <SaveCountModal sheet={sheet} counts={counts} onClose={() => setSaveOpen(false)} onSaved={(id) => { setSaveOpen(false); onSaved(id); }} />}
    </div>
  );
}

// Asks for the date and saves a frozen copy of the count. The server reads the system quantities itself.
function SaveCountModal({ sheet, counts, onClose, onSaved }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const [date, setDate] = useState(today);
  const [by, setBy] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const isTyped = (id) => counts[id] !== undefined && counts[id] !== '';
  const kinds = [...new Set(sheet.filter((r) => isTyped(r.item_id)).map((r) => r.stock_kind))];
  const covered = sheet.filter((r) => kinds.includes(r.stock_kind));
  const counted = covered.filter((r) => isTyped(r.item_id));
  const off = counted.filter((r) => Math.abs(Number(counts[r.item_id]) - Number(r.system_qty)) > 0.0005);

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    if (!date) return setErr('Choose the date of the count.');
    if (counted.some((r) => !Number.isFinite(Number(counts[r.item_id])) || Number(counts[r.item_id]) < 0)) {
      return setErr('Every counted quantity must be zero or more.');
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('save_stock_count_report', {
      p_count_date: date,
      p_counted_by: by,
      p_notes: notes,
      p_lines: covered.map((r) => ({
        stock_kind: r.stock_kind,
        item_id: String(r.item_id),
        counted: isTyped(r.item_id) ? Number(counts[r.item_id]) : null,
      })),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    onSaved(data);
  };

  return (
    <Modal title="Save count report" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-[#a8a090]">
          This keeps a frozen copy of your count: what the system said, what you counted, and the difference.{' '}
          <strong className="text-[#ece6d8]">It does not change any stock or books.</strong> A saved report cannot be edited or deleted.
        </p>

        <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 text-sm space-y-1.5">
          {kinds.map((k) => {
            const all = covered.filter((r) => r.stock_kind === k);
            const done = all.filter((r) => isTyped(r.item_id));
            return (
              <div key={k} className="flex justify-between gap-3">
                <span>{KIND_LABEL[k]}</span>
                <span className="text-[#a8a090]">{done.length} of {all.length} counted</span>
              </div>
            );
          })}
          <div className="flex justify-between gap-3 pt-1.5 border-t border-[#24201c]">
            <span>Differences</span>
            <span className={off.length === 0 ? 'text-[#3ecf8e]' : 'text-[#e5736d]'}>{off.length === 0 ? 'none' : off.length}</span>
          </div>
        </div>

        <div>
          <label htmlFor="sc-date" className="cs-label">Date of the count</label>
          <input id="sc-date" type="date" required value={date} max={today} onChange={(e) => setDate(e.target.value)} className="cs-input px-3 py-2.5" />
          {date && date !== today && (
            <p className="text-[11px] text-[#e5a93d] mt-1">
              System quantities are read when you save, not as of this date. Sales, production or purchases since then can explain differences.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="sc-by" className="cs-label">Counted by (optional)</label>
          <input id="sc-by" type="text" value={by} onChange={(e) => setBy(e.target.value)} className="cs-input px-3 py-2.5" />
        </div>
        <div>
          <label htmlFor="sc-notes" className="cs-label">Notes (optional)</label>
          <textarea id="sc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="cs-input px-3 py-2.5" />
        </div>

        <ModalActions error={err}>
          <button type="button" onClick={onClose} className="cs-btn cs-btn-ghost px-5 py-2.5">Cancel</button>
          <button type="submit" disabled={busy} className="cs-btn cs-btn-gold px-5 py-2.5">{busy ? 'Saving...' : 'Save report'}</button>
        </ModalActions>
      </form>
    </Modal>
  );
}

// ======================================================================
// Tab 5: Saved counts (frozen copies of past stock counts; they cannot be edited or deleted)
// ======================================================================
const reportNo = (n) => `SC-${String(n).padStart(4, '0')}`;

function SavedReports({ highlight }) {
  const [reports, setReports] = useState(null);
  const [open, setOpen] = useState(highlight || null);
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase
      .from('stock_count_reports')
      .select('*')
      .order('count_date', { ascending: false })
      .order('report_no', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setReports(data || []);
      });
  }, []);

  useEffect(() => {
    setLines([]);
    if (!open) return;
    supabase
      .from('stock_count_report_lines')
      .select('*')
      .eq('report_id', open)
      .order('item_name')
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setLines(data || []);
      });
  }, [open]);

  const current = (reports || []).find((r) => r.id === open);
  const kindsInOpen = [...new Set(lines.map((l) => l.stock_kind))];

  const download = (r) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Report', 'Count date', 'Kind', 'Item', 'Group', 'Unit', 'System qty', 'Counted qty', 'Difference', 'Approx. value difference'];
    const body = lines.map((l) => [
      reportNo(r.report_no), r.count_date, KIND_LABEL[l.stock_kind] || l.stock_kind, l.item_name, l.group_name, l.unit,
      l.system_qty, l.counted_qty ?? 'not counted', l.diff_qty ?? '', l.value_diff ?? '',
    ]);
    const csv = [head, ...body].map((row) => row.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-count-${reportNo(r.report_no)}-${r.count_date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <ErrorNote>{err}</ErrorNote>
      <p className="text-sm text-[#a8a090]">
        Each report is a frozen copy of a physical count: the system quantity at the moment it was saved, what was counted, and the difference.
        Saving a report changes no stock and no books, and a saved report cannot be edited or deleted.
      </p>

      <div className="cs-card overflow-hidden">
        {reports === null ? (
          <p className="p-6 text-sm text-[#a8a090]">Loading...</p>
        ) : reports.length === 0 ? (
          <EmptyState icon={Archive} title="No saved counts yet" text="Count your stock in the Stock count tab, then choose Save count report." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <Th>Report</Th>
                  <Th>Count date</Th>
                  <Th>Covers</Th>
                  <Th>Counted by</Th>
                  <Th right>Counted</Th>
                  <Th right>Differences</Th>
                  <Th right>Approx. value</Th>
                  <Th>Saved</Th>
                  <Th><span className="sr-only">Open</span></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                {reports.map((r) => (
                  <tr key={r.id} className={`hover:bg-[#1c1916] transition-colors ${open === r.id ? 'bg-[#1c1916]' : 'bg-[#141210]'}`}>
                    <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a] whitespace-nowrap">{reportNo(r.report_no)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDate(r.count_date)}</td>
                    <td className="px-4 py-3 text-xs text-[#a8a090]">{(r.kinds || []).map((k) => KIND_LABEL[k] || k).join(', ')}</td>
                    <td className="px-4 py-3">{r.counted_by || '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.items_counted} of {r.items_total}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${r.items_off > 0 ? 'text-[#e5736d]' : 'text-[#3ecf8e]'}`}>{r.items_off === 0 ? 'none' : r.items_off}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{peso(r.value_diff)}</td>
                    <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtStamp(r.saved_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setOpen(open === r.id ? null : r.id)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
                        {open === r.id ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {current && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold">
                <span className="font-mono text-[#e3bf5a]">{reportNo(current.report_no)}</span> · Count of {fmtDate(current.count_date)}
              </h3>
              <p className="text-xs text-[#a8a090] mt-1">
                System quantities as of {fmtStamp(current.saved_at)}.{current.counted_by ? ` Counted by ${current.counted_by}.` : ''}
              </p>
              {current.notes && <p className="text-sm mt-2 max-w-3xl">{current.notes}</p>}
            </div>
            <button onClick={() => download(current)} disabled={lines.length === 0} className="cs-btn cs-btn-ghost px-4 py-2.5">
              <Download className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" />
              <span>Download CSV</span>
            </button>
          </div>

          {kindsInOpen.map((k) => (
            <div key={k} className="cs-card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#24201c] text-[15px] font-semibold">{KIND_LABEL[k] || k}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className={THEAD}>
                    <tr>
                      <Th>Item</Th>
                      <Th right>System said</Th>
                      <Th right>Counted</Th>
                      <Th right>Difference</Th>
                      <Th right>Approx. value</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {lines.filter((l) => l.stock_kind === k).map((l) => {
                      const has = l.counted_qty !== null && l.counted_qty !== undefined;
                      const bad = has && Math.abs(Number(l.diff_qty)) > 0.0005;
                      return (
                        <tr key={l.id} className={`bg-[#141210] ${bad ? 'bg-[#2a1a19]/40' : ''}`}>
                          <td className="px-4 py-3">{l.item_name}<div className="text-[10px] text-[#7d766a]">{l.group_name}</div></td>
                          <td className="px-4 py-3 text-right tabular-nums">{qty(l.system_qty)} <span className="text-xs text-[#7d766a]">{l.unit}</span></td>
                          <td className="px-4 py-3 text-right tabular-nums">{has ? qty(l.counted_qty) : <span className="text-[#7d766a]">not counted</span>}</td>
                          <td className={`px-4 py-3 text-right tabular-nums font-medium ${!has ? 'text-[#7d766a]' : bad ? 'text-[#e5736d]' : 'text-[#3ecf8e]'}`}>
                            {!has ? '-' : `${Number(l.diff_qty) > 0 ? '+' : ''}${qty(l.diff_qty)}`}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[#a8a090]">{l.value_diff == null ? '-' : peso(l.value_diff)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ======================================================================
// Page
// ======================================================================
const TABS = [
  { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { id: 'movements', label: 'Movement log', icon: ScrollText },
  { id: 'trace', label: 'Invoice trace', icon: FileSearch },
  { id: 'count', label: 'Stock count', icon: ListChecks },
  { id: 'reports', label: 'Saved counts', icon: Archive },
];

export default function Audit({ user }) {
  const [tab, setTab] = useState('exceptions');
  const [counts, setCounts] = useState({}); // typed shelf counts, kept in memory until saved as a report
  const [savedId, setSavedId] = useState(null); // the report just saved, opened on the Saved counts tab

  // The menu and App.jsx already hide this page from staff; this is a second guard.
  if (user?.role !== 'owner') {
    return <EmptyState icon={ClipboardCheck} title="Owner only" text="The audit page is only for the owner." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Audit" subtitle="Read-only checks on your books, stock and documents. The only thing you can save here is a copy of a stock count, and it changes no record." />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Audit sections">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border cursor-pointer transition-colors ${
                active ? 'bg-[#1f1b12] text-[#e3bf5a] border-[#3a3014]' : 'text-[#a8a090] border-[#2a2622] hover:bg-[#1a1816] hover:text-[#ece6d8]'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'exceptions' && <Exceptions />}
      {tab === 'movements' && <MovementLog />}
      {tab === 'trace' && <InvoiceTrace />}
      {tab === 'count' && (
        <StockCount
          counts={counts}
          setCounts={setCounts}
          onSaved={(id) => {
            setCounts({});
            setSavedId(id);
            setTab('reports');
          }}
        />
      )}
      {tab === 'reports' && <SavedReports highlight={savedId} />}
    </div>
  );
}
