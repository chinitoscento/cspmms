import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageX, PlusCircle, Ban, Trash2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso, fmtDate } from './ui';
import FieldSearch, { emptyFieldFilter, hasFieldFilter, textMatch, numberMatch, dateMatch } from './FieldSearch';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const pad = (n) => String(n).padStart(8, '0');
const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });

const REASONS = [
  { id: 'spilled', label: 'Spilled' },
  { id: 'broken', label: 'Broken / damaged' },
  { id: 'expired', label: 'Expired' },
  { id: 'contaminated', label: 'Contaminated' },
  { id: 'other', label: 'Other (describe)' },
];
const reasonLabel = (id) => REASONS.find((r) => r.id === id)?.label || id;

// The four stages stock can be in. juice is by perfume; bottled and finished are by perfume size.
const SECTIONS = [
  { id: 'material', label: 'Raw material', short: 'Raw material', hint: 'Oils, solvent, bottles, stickers, boxes and wrap' },
  { id: 'juice', label: 'Produced juice', short: 'Juice', hint: 'Matured juice, in ml' },
  { id: 'bottled', label: 'Bottled', short: 'Bottled', hint: 'Bottled perfume not yet packed, in pieces' },
  { id: 'finished', label: 'Packed (finished goods)', short: 'Packed', hint: 'Packed and ready to sell, in pieces' },
];
const sectionOf = (id) => SECTIONS.find((s) => s.id === id);

const SEARCH_FIELDS = [
  { id: 'wo', label: 'WO number', type: 'text', placeholder: 'e.g. WO-00000012 or 12' },
  { id: 'date', label: 'Date', type: 'date' },
  { id: 'item', label: 'Item', type: 'text', placeholder: 'e.g. Aurelius, bottle, oil' },
];

const lineItem = (l) =>
  l.stock_kind === 'material'
    ? l.materials?.name
    : l.stock_kind === 'juice'
      ? l.perfumes?.name
      : `${l.perfume_sizes?.perfumes?.name || 'Perfume'} \u00b7 ${qty(l.perfume_sizes?.size_ml)} ml`;
const lineUnit = (l) => (l.stock_kind === 'material' ? l.materials?.unit : l.stock_kind === 'juice' ? 'ml' : 'pcs');

function Badge({ tone, children }) {
  const tones = {
    green: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    red: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${tones[tone]}`}>{children}</span>;
}

let keySeed = 0;
const BLANK_DRAFT = { kind: 'material', item: '', qty: '', reason: 'spilled', notes: '' };

export default function StockWriteoffs({ user, onChanged }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stock, setStock] = useState([]); // raw materials on hand
  const [layers, setLayers] = useState([]); // juice, bottled and finished stock layers
  const [sizes, setSizes] = useState([]);
  const [perfumes, setPerfumes] = useState([]);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState(() => emptyFieldFilter('wo'));

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: todayLocal(), notes: '' });
  const [lines, setLines] = useState([]); // the items already added to this entry
  const [draft, setDraft] = useState(BLANK_DRAFT); // the item being entered
  const [draftError, setDraftError] = useState('');
  const [formError, setFormError] = useState('');

  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [inv, lay, szs, pfs, wo] = await Promise.all([
      supabase.from('inventory_status').select('*').eq('kind', 'material'),
      supabase.from('stock_layers').select('stock_kind, perfume_id, size_id, qty_remaining, cost_remaining').in('stock_kind', ['juice', 'bottled', 'finished']).gt('qty_remaining', 0).limit(5000),
      supabase.from('perfume_sizes').select('id, size_ml, perfumes(name)'),
      supabase.from('perfumes').select('id, name'),
      supabase
        .from('stock_writeoffs')
        .select('*, stock_writeoff_lines(*, materials(name, unit), perfumes(name), perfume_sizes(size_ml, perfumes(name)))')
        .order('writeoff_no', { ascending: false })
        .limit(200),
    ]);
    const err = [inv, lay, szs, pfs, wo].find((r) => r.error);
    if (err) setLoadError(err.error.message);
    setStock(inv.data || []);
    setLayers(lay.data || []);
    setSizes(szs.data || []);
    setPerfumes(pfs.data || []);
    setRows(wo.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const afterChange = async () => {
    await load();
    onChanged && onChanged();
  };

  // What can be written off in each section: id, label, unit, quantity on hand and what it cost
  const options = useMemo(() => {
    const out = { material: [], juice: [], bottled: [], finished: [] };
    const sizeById = new Map(sizes.map((s) => [s.id, s]));
    const pfById = new Map(perfumes.map((p) => [p.id, p]));
    const agg = (kind, keyField) => {
      const m = new Map();
      layers
        .filter((l) => l.stock_kind === kind)
        .forEach((l) => {
          const k = l[keyField];
          const cur = m.get(k) || { qty: 0, val: 0 };
          cur.qty += Number(l.qty_remaining);
          cur.val += Number(l.cost_remaining);
          m.set(k, cur);
        });
      return m;
    };
    stock
      .filter((m) => Number(m.on_hand) > 0)
      .forEach((m) => out.material.push({ id: m.item_id, label: m.item_name, unit: m.unit, onHand: Number(m.on_hand), value: Number(m.value) }));
    agg('juice', 'perfume_id').forEach((v, k) => out.juice.push({ id: k, label: pfById.get(k)?.name || 'Perfume', unit: 'ml', onHand: v.qty, value: v.val }));
    ['bottled', 'finished'].forEach((kind) =>
      agg(kind, 'size_id').forEach((v, k) => {
        const s = sizeById.get(k);
        out[kind].push({ id: k, label: `${s?.perfumes?.name || 'Perfume'} \u00b7 ${qty(s?.size_ml)} ml`, unit: 'pcs', onHand: v.qty, value: v.val });
      })
    );
    Object.values(out).forEach((arr) => arr.sort((a, b) => a.label.localeCompare(b.label)));
    return out;
  }, [stock, layers, sizes, perfumes]);

  const optionOf = (kind, id) => options[kind]?.find((o) => o.id === id);
  const listedQty = (kind, id) => lines.filter((l) => l.kind === kind && l.item === id).reduce((s, l) => s + l.qty, 0);
  const leftFor = (kind, id) => (optionOf(kind, id)?.onHand || 0) - listedQty(kind, id);
  const lineCost = (l) => {
    const o = optionOf(l.kind, l.item);
    return o && o.onHand > 0 ? (l.qty * o.value) / o.onHand : 0;
  };
  const totalCost = lines.reduce((s, l) => s + lineCost(l), 0);

  const draftOpt = draft.item ? optionOf(draft.kind, draft.item) : null;

  const openForm = () => {
    setF({ date: todayLocal(), notes: '' });
    setLines([]);
    setDraft(BLANK_DRAFT);
    setDraftError('');
    setFormError('');
    setOpen(true);
  };

  const addLine = () => {
    const o = optionOf(draft.kind, draft.item);
    const q = Number(draft.qty);
    if (!o) return setDraftError('Choose the item.');
    if (!(q > 0)) return setDraftError('Enter the quantity lost.');
    if ((draft.kind === 'bottled' || draft.kind === 'finished') && !Number.isInteger(q)) return setDraftError('Enter whole pieces.');
    const left = leftFor(draft.kind, draft.item);
    if (q > left + 1e-9) return setDraftError(`Only ${qty(left)} ${o.unit} of ${o.label} left to write off.`);
    if (draft.reason === 'other' && !draft.notes.trim()) return setDraftError('Describe what happened.');
    setLines((prev) => [...prev, { key: `w${++keySeed}`, kind: draft.kind, item: draft.item, qty: q, reason: draft.reason, notes: draft.notes.trim() }]);
    setDraft((d) => ({ ...d, item: '', qty: '', notes: '' }));
    setDraftError('');
  };

  const save = async (e) => {
    e.preventDefault();
    setFormError('');
    if (draft.item || draft.qty) return setFormError('Click Add to list for the item you entered, or clear it.');
    if (lines.length === 0) return setFormError('Add at least one item to the list.');
    setSaving(true);
    const { error } = await supabase.rpc('record_writeoff', {
      p_date: f.date || todayLocal(),
      p_notes: nz(f.notes),
      p_lines: lines.map((l) => ({ kind: l.kind, item: l.item, qty: l.qty, reason: l.reason, notes: nz(l.notes) })),
    });
    setSaving(false);
    if (error) return setFormError(error.message);
    setOpen(false);
    await afterChange();
  };

  const doVoid = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return setVoidError('Please give a reason.');
    setSaving(true);
    setVoidError('');
    const { error } = await supabase.rpc('void_stock_writeoff', { p_id: voiding.id, p_reason: reason.trim() });
    setSaving(false);
    if (error) return setVoidError(error.message);
    setVoiding(null);
    await afterChange();
  };

  const sortedLines = (r) => [...(r.stock_writeoff_lines || [])].sort((a, b) => a.line_no - b.line_no);

  const shown = useMemo(() => {
    if (!hasFieldFilter(filter)) return rows;
    return rows.filter((r) => {
      switch (filter.field) {
        case 'wo':
          return numberMatch(filter.text, 'WO', r.writeoff_no);
        case 'date':
          return dateMatch(filter.from, filter.to, r.writeoff_date);
        case 'item':
          return (r.stock_writeoff_lines || []).some((l) => textMatch(lineItem(l), filter.text));
        default:
          return true;
      }
    });
  }, [rows, filter]);

  return (
    <div>
      <PageHeader title="Stock Write-offs" subtitle="Stock spilled, broken, expired or contaminated: raw materials, juice, bottled or packed perfume">
        <button onClick={openForm} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Record Write-off</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : (
        <div className="cs-card overflow-hidden">
          {rows.length > 0 && (
            <FieldSearch idPrefix="wo-search" fields={SEARCH_FIELDS} filter={filter} onChange={setFilter} shown={shown.length} total={rows.length} loadedLimit={200} />
          )}
          {rows.length === 0 ? (
            <EmptyState
              icon={PackageX}
              title="No write-offs yet"
              text="Record raw materials, juice, bottled or packed perfume that was spilled or damaged."
              actionLabel="Record Write-off"
              onAction={openForm}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 font-medium">No.</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Items</th>
                    <th className="px-4 py-3 font-medium text-right">Cost</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    {isOwner && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {shown.map((r) => (
                    <tr key={r.id} className={`hover:bg-[#1c1916] transition-colors ${r.status === 'Voided' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a] whitespace-nowrap align-top">WO-{pad(r.writeoff_no)}</td>
                      <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap align-top">{fmtDate(r.writeoff_date)}</td>
                      <td className="px-4 py-3 align-top">
                        <ul className="space-y-1">
                          {sortedLines(r).map((l) => (
                            <li key={l.id} className="text-xs">
                              <span className="text-[#a8a090]">{sectionOf(l.stock_kind)?.short} &middot; </span>
                              <span className="text-sm">{lineItem(l)}</span>{' '}
                              <span className="font-mono">{qty(l.qty)} {lineUnit(l)}</span>{' '}
                              <span className="text-[#a8a090]">&middot; {reasonLabel(l.reason)}{l.notes ? ` (${l.notes})` : ''}</span>
                            </li>
                          ))}
                        </ul>
                        {r.notes && <div className="text-xs text-[#a8a090] mt-1">{r.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono align-top">{peso(r.cost)}</td>
                      <td className="px-4 py-3 align-top">
                        <Badge tone={r.status === 'Voided' ? 'red' : 'green'}>{r.status}</Badge>
                        {r.status === 'Voided' && r.void_reason && <div className="text-[10px] text-[#a8a090] mt-1">{r.void_reason}</div>}
                      </td>
                      {isOwner && (
                        <td className="px-4 py-3 text-right align-top">
                          {r.status === 'Posted' && (
                            <button
                              onClick={() => { setVoiding(r); setReason(''); setVoidError(''); }}
                              className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs"
                              aria-label={`Void WO-${pad(r.writeoff_no)}`}
                            >
                              <Ban className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                              <span>Void</span>
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={isOwner ? 6 : 5} className="px-4 py-8 text-center text-sm text-[#a8a090]">No write-offs match your search.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- Record write-off ---------- */}
      {open && (
        <Modal title="Record Write-off" onClose={() => setOpen(false)} wide>
          <form onSubmit={save}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
              {/* Left: encode */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="wo-date" className="cs-label">Date</label>
                    <input id="wo-date" type="date" value={f.date} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} required className="cs-input px-3 py-2.5" />
                  </div>
                  <div>
                    <label htmlFor="wo-notes" className="cs-label">Notes for the whole entry (optional)</label>
                    <input id="wo-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="e.g. Shelf collapsed in storage" className="cs-input px-3 py-2.5" />
                  </div>
                </div>

                <div className="rounded-xl border border-[#2a2622] bg-[#14120f] p-4 space-y-3">
                  <div className="text-xs uppercase tracking-wider text-[#a8a090]">Add an item</div>
                  <div role="radiogroup" aria-label="Section" className="grid grid-cols-2 gap-2">
                    {SECTIONS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={draft.kind === s.id}
                        onClick={() => { setDraft((d) => ({ ...d, kind: s.id, item: '', qty: '' })); setDraftError(''); }}
                        className={`px-3 py-2 rounded-xl text-xs font-medium border cursor-pointer transition-colors text-left ${
                          draft.kind === s.id ? 'bg-[#1f1b12] text-[#e3bf5a] border-[#3a3014]' : 'text-[#a8a090] border-[#2a2622] hover:bg-[#1a1816]'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-[#a8a090]">{sectionOf(draft.kind).hint}</p>

                  <div>
                    <label htmlFor="wo-item" className="cs-label">Item</label>
                    <select
                      id="wo-item"
                      value={draft.item}
                      onChange={(e) => { setDraft((d) => ({ ...d, item: e.target.value })); setDraftError(''); }}
                      className="cs-input px-3 py-2.5"
                    >
                      <option value="">Select item...</option>
                      {options[draft.kind].map((o) => (
                        <option key={o.id} value={o.id} disabled={leftFor(draft.kind, o.id) <= 0}>
                          {o.label} - {qty(leftFor(draft.kind, o.id))} {o.unit} {leftFor(draft.kind, o.id) <= 0 ? '(all on the list)' : 'on hand'}
                        </option>
                      ))}
                    </select>
                    {options[draft.kind].length === 0 && <p className="text-[11px] text-[#a8a090] mt-1">Nothing in stock in this section.</p>}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="wo-qty" className="cs-label">Quantity lost{draftOpt ? ` (${draftOpt.unit})` : ''}</label>
                      <input
                        id="wo-qty"
                        type="number"
                        min="0"
                        step="any"
                        value={draft.qty}
                        onChange={(e) => { setDraft((d) => ({ ...d, qty: e.target.value })); setDraftError(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }}
                        className="cs-input px-3 py-2.5 text-right"
                      />
                    </div>
                    <div>
                      <label htmlFor="wo-reason" className="cs-label">What happened</label>
                      <select id="wo-reason" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} className="cs-input px-3 py-2.5">
                        {REASONS.map((r) => (
                          <option key={r.id} value={r.id}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="wo-line-notes" className="cs-label">Note for this item {draft.reason === 'other' ? '' : '(optional)'}</label>
                    <input id="wo-line-notes" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="e.g. Bottle dropped while moving stock" className="cs-input px-3 py-2.5" />
                  </div>
                  {draftError && <p className="text-xs text-[#e5736d]" role="alert">{draftError}</p>}
                  <button type="button" onClick={addLine} className="cs-btn cs-btn-gold px-4 py-2.5">
                    <PlusCircle className="w-4 h-4" aria-hidden="true" />
                    <span>Add to list</span>
                  </button>
                </div>
              </div>

              {/* Right: the items in this entry */}
              <div className="rounded-xl border border-[#2a2622] overflow-hidden">
                <div className="px-4 py-3 bg-[#1a1816] border-b border-[#2a2622] flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[#a8a090]">Items written off</span>
                  <span className="text-[11px] text-[#a8a090]">{lines.length} {lines.length === 1 ? 'item' : 'items'}</span>
                </div>
                {lines.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-[#a8a090]">No items yet. Choose a section and an item, enter the quantity, then click Add to list.</p>
                ) : (
                  <ul className="divide-y divide-[#24201c]">
                    {lines.map((l, i) => {
                      const o = optionOf(l.kind, l.item);
                      return (
                        <li key={l.key} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                          <span className="w-5 text-xs text-[#a8a090]">{i + 1}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate">{o?.label}</span>
                            <span className="block text-[11px] text-[#a8a090]">
                              {sectionOf(l.kind).short} &middot; {reasonLabel(l.reason)}{l.notes ? ` (${l.notes})` : ''}
                            </span>
                          </span>
                          <span className="font-mono text-xs w-24 text-right">{qty(l.qty)} {o?.unit}</span>
                          <span className="font-mono text-xs w-24 text-right text-[#a8a090]">{peso(lineCost(l))}</span>
                          <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="text-[#a8a090] hover:text-[#e5736d] cursor-pointer" aria-label={`Remove ${o?.label}`}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="px-4 py-3 bg-[#14120f] border-t border-[#2a2622] flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[#a8a090]">Estimated loss (average cost)</span>
                  <span className="font-mono text-lg text-[#e3bf5a]">{peso(totalCost)}</span>
                </div>
                <p className="px-4 py-3 border-t border-[#2a2622] text-[11px] text-[#a8a090]">
                  Each item is taken out of stock, oldest first, and its exact cost is charged to Inventory Write-off. One entry gets one WO number. If any
                  item cannot be saved, none are. Spoilage while bottling or packaging is entered on those pages.
                </p>
              </div>
            </div>

            <ErrorNote>{formError}</ErrorNote>
            <div className="pt-4 flex justify-end gap-3">
              <button type="button" onClick={() => setOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving || lines.length === 0} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">{saving ? 'Posting...' : 'Post Write-off'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Void ---------- */}
      {voiding && (
        <Modal title={`Void WO-${pad(voiding.writeoff_no)}`} onClose={() => setVoiding(null)}>
          <form onSubmit={doVoid} className="space-y-4">
            <p className="text-sm text-[#a8a090]">This puts every item of this write-off back in stock and reverses the journal entry.</p>
            <div>
              <label htmlFor="void-reason" className="cs-label">Reason</label>
              <input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" required autoFocus className="cs-input px-3.5 py-2.5" />
            </div>
            <ErrorNote>{voidError}</ErrorNote>
            <div className="pt-2 flex justify-end gap-3">
              <button type="button" onClick={() => setVoiding(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Voiding...' : 'Void'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
