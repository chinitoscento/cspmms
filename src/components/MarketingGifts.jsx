import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gift, PlusCircle, Ban } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, ModalActions, nz, peso, fmtDate } from './ui';
import { LateEntryNotice, isLateEntry, withLateNote } from './lateEntry';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const pad = (n) => String(n).padStart(8, '0');
const pcs = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });
const sizeText = (ml) => Number(ml).toLocaleString('en-PH', { maximumFractionDigits: 2 });

function Badge({ tone, children }) {
  const tones = {
    green: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    red: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${tones[tone]}`}>{children}</span>;
}

const emptyForm = () => ({ date: todayLocal(), size: '', qty: '', recipient: '', notes: '' });

export default function MarketingGifts({ user, onChanged }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stock, setStock] = useState([]); // finished goods on hand, one row per perfume size
  const [sizes, setSizes] = useState([]);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [f, setF] = useState(emptyForm());
  const [lateReason, setLateReason] = useState('');
  const [formError, setFormError] = useState('');

  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [inv, sz, gf] = await Promise.all([
      supabase.from('inventory_status').select('*').eq('kind', 'finished'),
      supabase.from('perfume_sizes').select('id, size_ml, perfumes(name, status)'),
      supabase.from('marketing_gifts').select('*').order('gift_no', { ascending: false }).limit(200),
    ]);
    const err = [inv, sz, gf].find((r) => r.error);
    if (err) setLoadError(err.error.message);
    setStock(inv.data || []);
    setSizes(sz.data || []);
    setRows(gf.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const afterChange = async () => {
    await load();
    onChanged && onChanged();
  };

  const sizeById = useMemo(() => Object.fromEntries(sizes.map((s) => [s.id, s])), [sizes]);
  const perfumeLabel = (sizeId) => {
    const s = sizeById[sizeId];
    return s?.perfumes ? `${s.perfumes.name} · ${sizeText(s.size_ml)} ml` : 'Perfume';
  };

  // Only perfumes that are in stock can be given away
  const options = useMemo(
    () =>
      stock
        .filter((r) => Number(r.on_hand) > 0 && sizeById[r.item_id])
        .map((r) => ({ id: r.item_id, label: perfumeLabel(r.item_id), onHand: Number(r.on_hand), value: Number(r.value || 0) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stock, sizeById]
  );
  const sel = options.find((o) => o.id === f.size);
  const q = Number(f.qty) || 0;
  const estCost = sel && sel.onHand > 0 ? (q * sel.value) / sel.onHand : 0;

  const openForm = () => {
    setF(emptyForm());
    setLateReason('');
    setFormError('');
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!sel) return setFormError('Choose the perfume.');
    if (!(q > 0) || !Number.isInteger(q)) return setFormError('Enter a whole number of pieces.');
    if (q > sel.onHand) return setFormError(`Only ${pcs(sel.onHand)} pcs of ${sel.label} on hand.`);
    if (!f.recipient.trim()) return setFormError('Enter who received the gift.');
    if (isLateEntry(f.date) && !lateReason.trim()) return setFormError('This is a late entry. Enter why it was not recorded on the day.');
    setSaving(true);
    setFormError('');
    const { error } = await supabase.rpc('record_marketing_gift', {
      p_date: f.date || todayLocal(),
      p_size: f.size,
      p_qty: q,
      p_recipient: f.recipient.trim(),
      p_notes: withLateNote(nz(f.notes), f.date, lateReason),
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
    const { error } = await supabase.rpc('void_marketing_gift', { p_id: voiding.id, p_reason: reason.trim() });
    setSaving(false);
    if (error) return setVoidError(error.message);
    setVoiding(null);
    await afterChange();
  };

  return (
    <div>
      <PageHeader title="Marketing Gifts" subtitle="Finished perfumes given to influencers and partners. Booked as marketing expense, not as sales">
        <button onClick={openForm} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Record Gift</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : (
        <div className="cs-card overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              icon={Gift}
              title="No gifts yet"
              text="Record perfumes you gave away for marketing. They leave stock at cost and go to Marketing and Advertising."
              actionLabel="Record Gift"
              onAction={openForm}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 font-medium">No.</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Perfume</th>
                    <th className="px-4 py-3 font-medium text-right">Pieces</th>
                    <th className="px-4 py-3 font-medium">Given to</th>
                    <th className="px-4 py-3 font-medium text-right">Cost</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    {isOwner && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {rows.map((r) => (
                    <tr key={r.id} className={`hover:bg-[#1c1916] transition-colors ${r.status === 'Voided' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a] whitespace-nowrap">GF-{pad(r.gift_no)}</td>
                      <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(r.gift_date)}</td>
                      <td className="px-4 py-3">{perfumeLabel(r.size_id)}</td>
                      <td className="px-4 py-3 text-right font-mono">{pcs(r.qty)}</td>
                      <td className="px-4 py-3 text-xs">
                        {r.recipient}
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
                              aria-label={`Void GF-${pad(r.gift_no)}`}
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

      {/* ---------- Record gift ---------- */}
      {open && (
        <Modal title="Record Marketing Gift" onClose={() => setOpen(false)}>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="gf-size" className="cs-label">Perfume</label>
                <select id="gf-size" value={f.size} onChange={(e) => setF((p) => ({ ...p, size: e.target.value }))} className="cs-input px-3 py-2.5">
                  <option value="">Select perfume...</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label} - {pcs(o.onHand)} pcs on hand</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="gf-date" className="cs-label">Date given</label>
                <input id="gf-date" type="date" value={f.date} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} required className="cs-input px-3 py-2.5" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="gf-qty" className="cs-label">Pieces</label>
                <input id="gf-qty" type="number" min="1" step="1" value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="gf-to" className="cs-label">Given to</label>
                <input id="gf-to" value={f.recipient} onChange={(e) => setF((p) => ({ ...p, recipient: e.target.value }))} placeholder="e.g. Influencer name" className="cs-input px-3 py-2.5" />
              </div>
            </div>
            <div>
              <label htmlFor="gf-notes" className="cs-label">Notes (optional)</label>
              <input id="gf-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="e.g. Payment for a video review" className="cs-input px-3 py-2.5" />
            </div>

            <LateEntryNotice date={f.date} reason={lateReason} onReason={setLateReason} id="gf-late" />

            {sel && q > 0 && (
              <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 text-sm flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#a8a090]">Estimated cost (average)</span>
                <span className={`font-mono ${q > sel.onHand ? 'text-[#e5736d]' : ''}`}>{peso(estCost)}</span>
              </div>
            )}
            <p className="text-[11px] text-[#a8a090]">
              The pieces leave finished goods, oldest stock first, and the exact cost is charged to Marketing and Advertising.
              Nothing is recorded as a sale, and no customer balance changes.
            </p>
            <ModalActions error={formError}>
              <button type="button" onClick={() => setOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">{saving ? 'Posting...' : 'Post Gift'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Void ---------- */}
      {voiding && (
        <Modal title={`Void GF-${pad(voiding.gift_no)}`} onClose={() => setVoiding(null)}>
          <form onSubmit={doVoid} className="space-y-4">
            <p className="text-sm text-[#a8a090]">This puts the pieces back in stock and reverses the journal entry.</p>
            <div>
              <label htmlFor="gf-void-reason" className="cs-label">Reason</label>
              <input id="gf-void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" required autoFocus className="cs-input px-3.5 py-2.5" />
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
