import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageX, PlusCircle, Ban } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso, fmtDate } from './ui';

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

function Badge({ tone, children }) {
  const tones = {
    green: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    red: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${tones[tone]}`}>{children}</span>;
}

export default function StockWriteoffs({ user, onChanged }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stock, setStock] = useState([]);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: todayLocal(), material: '', qty: '', reason: 'spilled', notes: '' });
  const [formError, setFormError] = useState('');

  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [inv, wo] = await Promise.all([
      supabase.from('inventory_status').select('*').eq('kind', 'material'),
      supabase.from('stock_writeoffs').select('*, materials(name, unit)').order('writeoff_no', { ascending: false }).limit(200),
    ]);
    const err = [inv, wo].find((r) => r.error);
    if (err) setLoadError(err.error.message);
    setStock(inv.data || []);
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

  const mats = useMemo(() => [...stock].sort((a, b) => a.item_name.localeCompare(b.item_name)), [stock]);
  const matById = useMemo(() => Object.fromEntries(mats.map((m) => [m.item_id, m])), [mats]);
  const sel = matById[f.material];
  const q = Number(f.qty) || 0;
  const avgCost = sel && Number(sel.on_hand) > 0 ? Number(sel.value) / Number(sel.on_hand) : 0;

  const openForm = () => {
    setF({ date: todayLocal(), material: '', qty: '', reason: 'spilled', notes: '' });
    setFormError('');
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!sel) return setFormError('Choose the material.');
    if (!(q > 0)) return setFormError('Enter the quantity lost.');
    if (q > Number(sel.on_hand)) return setFormError(`Only ${qty(sel.on_hand)} ${sel.unit} of ${sel.item_name} on hand.`);
    if (f.reason === 'other' && !f.notes.trim()) return setFormError('Describe what happened.');
    setSaving(true);
    setFormError('');
    const { error } = await supabase.rpc('record_stock_writeoff', {
      p_date: f.date || todayLocal(),
      p_material: f.material,
      p_qty: q,
      p_reason: f.reason,
      p_notes: nz(f.notes),
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

  return (
    <div>
      <PageHeader title="Stock Write-offs" subtitle="Raw materials spilled, broken, expired or contaminated before production">
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
          {rows.length === 0 ? (
            <EmptyState
              icon={PackageX}
              title="No write-offs yet"
              text="Record oils, solvent, bottles or packaging that were spilled or damaged before they were used."
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
                    <th className="px-4 py-3 font-medium">Material</th>
                    <th className="px-4 py-3 font-medium text-right">Quantity</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 font-medium text-right">Cost</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    {isOwner && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {rows.map((r) => (
                    <tr key={r.id} className={`hover:bg-[#1c1916] transition-colors ${r.status === 'Voided' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a] whitespace-nowrap">WO-{pad(r.writeoff_no)}</td>
                      <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(r.writeoff_date)}</td>
                      <td className="px-4 py-3">{r.materials?.name}</td>
                      <td className="px-4 py-3 text-right font-mono">{qty(r.qty)} {r.materials?.unit}</td>
                      <td className="px-4 py-3 text-xs">
                        {reasonLabel(r.reason)}
                        {r.notes && <div className="text-[#a8a090]">{r.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{peso(r.cost)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={r.status === 'Voided' ? 'red' : 'green'}>{r.status}</Badge>
                        {r.status === 'Voided' && r.void_reason && <div className="text-[10px] text-[#a8a090] mt-1">{r.void_reason}</div>}
                      </td>
                      {isOwner && (
                        <td className="px-4 py-3 text-right">
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
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- Record write-off ---------- */}
      {open && (
        <Modal title="Record Write-off" onClose={() => setOpen(false)}>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="wo-mat" className="cs-label">Material</label>
                <select id="wo-mat" value={f.material} onChange={(e) => setF((p) => ({ ...p, material: e.target.value }))} className="cs-input px-3 py-2.5">
                  <option value="">Select material...</option>
                  {mats.map((m) => (
                    <option key={m.item_id} value={m.item_id}>
                      {m.item_name} - {qty(m.on_hand)} {m.unit} on hand
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="wo-date" className="cs-label">Date</label>
                <input id="wo-date" type="date" value={f.date} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} required className="cs-input px-3 py-2.5" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="wo-qty" className="cs-label">Quantity lost{sel ? ` (${sel.unit})` : ''}</label>
                <input id="wo-qty" type="number" min="0" step="any" value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
              </div>
              <div>
                <label htmlFor="wo-reason" className="cs-label">What happened</label>
                <select id="wo-reason" value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))} className="cs-input px-3 py-2.5">
                  {REASONS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="wo-notes" className="cs-label">Notes {f.reason === 'other' ? '' : '(optional)'}</label>
              <input id="wo-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="e.g. Bottle dropped while moving stock" className="cs-input px-3 py-2.5" />
            </div>
            {sel && q > 0 && (
              <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 text-sm flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#a8a090]">Estimated loss (average cost)</span>
                <span className={`font-mono ${q > Number(sel.on_hand) ? 'text-[#e5736d]' : ''}`}>{peso(q * avgCost)}</span>
              </div>
            )}
            <p className="text-[11px] text-[#a8a090]">
              The quantity is taken out of stock, oldest first, and the exact cost is charged to Inventory Write-off. Use this only for materials lost
              before production; spoilage while bottling or packaging is entered on those pages.
            </p>
            <ErrorNote>{formError}</ErrorNote>
            <div className="pt-2 flex justify-end gap-3">
              <button type="button" onClick={() => setOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Posting...' : 'Post Write-off'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Void ---------- */}
      {voiding && (
        <Modal title={`Void WO-${pad(voiding.writeoff_no)}`} onClose={() => setVoiding(null)}>
          <form onSubmit={doVoid} className="space-y-4">
            <p className="text-sm text-[#a8a090]">This puts the quantity back in stock and reverses the journal entry.</p>
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
