import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PackageCheck, PlusCircle, Ban } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso, fmtDate, ModalActions, STICKY_TH, STICKY_TD } from './ui';
import SearchBar, { EMPTY_FILTERS, matchesFilters } from './SearchBar';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const pad = (n) => String(n).padStart(8, '0');
const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });

function Badge({ tone, children }) {
  const tones = {
    green: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    amber: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
    red: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
    gray: 'bg-[#1c1916] text-[#a8a090] border-[#2a2622]',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${tones[tone]}`}>{children}</span>;
}

function MaterialSelect({ id, label, cat, value, onChange, mats, hideLabel }) {
  const options = mats.filter((m) => (Array.isArray(cat) ? cat.includes(m.group_name) : m.group_name === cat));
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'cs-label'}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="cs-input px-3 py-2.5">
        <option value="">Select...</option>
        {options.map((m) => (
          <option key={m.item_id} value={m.item_id} disabled={Number(m.on_hand || 0) <= 0 && m.item_id !== value}>
            {m.item_name} - {qty(m.on_hand)} {m.unit} on hand{Number(m.on_hand || 0) <= 0 ? ' (out of stock)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">{label}</div>
      <div className={`font-mono ${tone || ''}`}>{value}</div>
    </div>
  );
}

export default function Packaging({ user, onChanged, prefill }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sizes, setSizes] = useState([]);
  const [stock, setStock] = useState([]); // inventory_status rows
  const [runs, setRuns] = useState([]);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS); // search by perfume, run no. and date

  // packaging
  const [pkOpen, setPkOpen] = useState(false);
  const [pk, setPk] = useState({ date: todayLocal(), size: '', qty: '', spoiled: '0', pack: 'box', box: '', box_sticker: '', pouch: '', pouch_sticker: '', wrap: '', notes: '' });
  const [pkError, setPkError] = useState('');
  const prefillDone = useRef(false);

  // void
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [sz, inv, rn] = await Promise.all([
      supabase.from('perfume_sizes').select('id, size_ml, perfume_id, perfumes(name, status)').eq('is_active', true),
      supabase.from('inventory_status').select('*'),
      supabase.from('packaging_runs').select('*, perfume_sizes(size_ml, perfumes(name))').order('run_no', { ascending: false }).limit(100),
    ]);
    const err = [sz, inv, rn].find((r) => r.error);
    if (err) setLoadError(err.error.message);
    setSizes((sz.data || []).filter((s) => s.perfumes && s.perfumes.status !== 'Discontinued'));
    setStock(inv.data || []);
    setRuns(rn.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Arrived from Bottling: open the form with that perfume and size selected
  useEffect(() => {
    if (loading || !prefill?.sizeId || prefillDone.current) return;
    prefillDone.current = true;
    const known = sizes.some((s) => s.id === prefill.sizeId);
    setPk({ date: todayLocal(), size: known ? prefill.sizeId : '', qty: '', spoiled: '0', pack: 'box', box: '', box_sticker: '', pouch: '', pouch_sticker: '', wrap: '', notes: '' });
    setPkError('');
    setPkOpen(true);
  }, [loading, prefill, sizes]);

  const afterChange = async () => {
    await load();
    onChanged && onChanged();
  };

  const mats = useMemo(() => stock.filter((r) => r.kind === 'material'), [stock]);
  const matById = useMemo(() => Object.fromEntries(mats.map((m) => [m.item_id, m])), [mats]);
  const shownRuns = useMemo(
    () => runs.filter((r) => matchesFilters(filters, { perfume: r.perfume_sizes?.perfumes?.name, runNo: r.run_no, prefix: 'PK', date: r.run_date })),
    [runs, filters]
  );
  const finishedBySize = useMemo(() => Object.fromEntries(stock.filter((r) => r.kind === 'finished').map((r) => [r.item_id, r])), [stock]);
  const sizeOptions = useMemo(
    () => [...sizes].sort((a, b) => a.perfumes.name.localeCompare(b.perfumes.name) || Number(a.size_ml) - Number(b.size_ml)),
    [sizes]
  );
  const sizeName = (r) => (r.perfume_sizes ? `${r.perfume_sizes.perfumes?.name} · ${qty(r.perfume_sizes.size_ml)} ml` : '-');

  // ---------- packaging ----------
  const openPackaging = () => {
    setPk({ date: todayLocal(), size: '', qty: '', spoiled: '0', pack: 'box', box: '', box_sticker: '', pouch: '', pouch_sticker: '', wrap: '', notes: '' });
    setPkError('');
    setPkOpen(true);
  };
  const pkStock = finishedBySize[pk.size];
  const pkQty = parseInt(pk.qty, 10) || 0;
  const pkSpoiled = parseInt(pk.spoiled, 10) || 0;
  const pkNeed = pkQty + pkSpoiled; // boxes, stickers etc. used, spoiled included
  const pkWaiting = Number(pkStock?.pipeline_units || 0);
  const pkChosen = (pk.pack === 'pouch' ? [pk.pouch, pk.pouch_sticker, pk.wrap] : [pk.box, pk.box_sticker, pk.wrap])
    .filter(Boolean)
    .map((id) => matById[id])
    .filter(Boolean);
  const pkShort = [];
  if (pk.size && pkQty > pkWaiting) pkShort.push(`Only ${qty(pkWaiting)} bottled pieces are waiting to be packaged, but ${qty(pkQty)} entered.`);
  pkChosen.forEach((m) => {
    if (pkNeed > Number(m.on_hand || 0)) pkShort.push(`Not enough ${m.item_name}: ${qty(pkNeed)} needed (spoiled included), ${qty(m.on_hand)} on hand.`);
  });
  const pkBlocked = pkShort.length > 0;

  const savePackaging = async (e) => {
    e.preventDefault();
    if (!pk.size) return setPkError('Choose the perfume and size.');
    if (!(pkQty > 0)) return setPkError('Enter how many pieces were packaged.');
    // Only the box or the pouch is required. The sticker and the wrap are optional.
    const pkMats = (pk.pack === 'pouch' ? [pk.pouch, pk.pouch_sticker, pk.wrap] : [pk.box, pk.box_sticker, pk.wrap]).filter(Boolean);
    if (pk.pack === 'pouch') {
      if (!pk.pouch) return setPkError('Choose the pouch.');
    } else if (!pk.box) {
      return setPkError('Choose the box.');
    }
    if (pkQty > Number(pkStock?.pipeline_units || 0)) return setPkError(`Only ${qty(pkStock?.pipeline_units)} bottled pieces are waiting to be packaged.`);
    for (const id of pkMats) {
      if (pkQty + pkSpoiled > Number(matById[id]?.on_hand || 0)) return setPkError(`Not enough ${matById[id]?.item_name} in stock.`);
    }
    setSaving(true);
    setPkError('');
    const { error } = await supabase.rpc('record_packaging', {
      p_date: pk.date || todayLocal(),
      p_size: pk.size,
      p_qty: pkQty,
      p_box: pk.pack === 'box' ? pk.box : null,
      p_box_sticker: pk.pack === 'box' ? pk.box_sticker || null : null,
      p_pouch: pk.pack === 'pouch' ? pk.pouch : null,
      p_pouch_sticker: pk.pack === 'pouch' ? pk.pouch_sticker || null : null,
      p_wrap: pk.wrap || null,
      p_spoiled: pkSpoiled,
      p_notes: nz(pk.notes),
    });
    setSaving(false);
    if (error) return setPkError(error.message);
    setPkOpen(false);
    await afterChange();
  };


  // ---------- void ----------
  const openVoid = (row) => {
    setVoiding(row);
    setReason('');
    setVoidError('');
  };
  const doVoid = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return setVoidError('Please give a reason.');
    setSaving(true);
    setVoidError('');
    const { error } = await supabase.rpc('void_packaging', { p_id: voiding.id, p_reason: reason.trim() });
    setSaving(false);
    if (error) return setVoidError(error.message);
    setVoiding(null);
    await afterChange();
  };

  return (
    <div>
      <PageHeader title="Packaging" subtitle="Bottled perfume packed with boxes or pouches into finished goods, costed from the oldest stock first">
        <button onClick={openPackaging} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Record Packaging</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : (
        <div className="cs-card overflow-hidden">
          {runs.length > 0 && (
            <SearchBar
              idPrefix="pk-search"
              filters={filters}
              onChange={setFilters}
              runLabel="Run"
              runPlaceholder="e.g. PK-00000012 or 12"
              dateLabel="Date"
              shown={shownRuns.length}
              total={runs.length}
            />
          )}
          {runs.length === 0 ? (
            <EmptyState icon={PackageCheck} title="No packaging yet" text="Packaging uses bottled perfume with either a box set or a pouch set." actionLabel="Record Packaging" onAction={openPackaging} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Run</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Perfume</th>
                    <th className="px-4 py-3 font-medium text-right">Packaged</th>
                    <th className="px-4 py-3 font-medium text-right">Spoiled</th>
                    <th className="px-4 py-3 font-medium text-right">Cost per piece</th>
                    <th className="px-4 py-3 font-medium text-right">Total cost</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    {isOwner && <th className={`px-4 py-3 ${STICKY_TH}`}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {shownRuns.map((r) => (
                    <tr key={r.id} className={`bg-[#141210] hover:bg-[#1c1916] transition-colors ${r.status === 'Voided' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a]">PK-{pad(r.run_no)}</td>
                      <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(r.run_date)}</td>
                      <td className="px-4 py-3">{sizeName(r)}</td>
                      <td className="px-4 py-3 text-right font-mono">{qty(r.qty)}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.spoiled_qty > 0 ? `${r.spoiled_qty} (${peso(r.spoiled_cost)})` : '-'}</td>
                      <td className="px-4 py-3 text-right font-mono">{peso(Number(r.finished_cost) / r.qty)}</td>
                      <td className="px-4 py-3 text-right font-mono">{peso(r.finished_cost)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={r.status === 'Voided' ? 'red' : 'green'}>{r.status || 'Posted'}</Badge>
                        {r.status === 'Voided' && r.void_reason && <div className="text-[10px] text-[#a8a090] mt-1">{r.void_reason}</div>}
                      </td>
                      {isOwner && (
                        <td className={`px-4 py-3 text-right ${STICKY_TD}`}>
                          {(r.status || 'Posted') === 'Posted' && (
                            <button onClick={() => openVoid(r)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs" aria-label={`Void PK-${pad(r.run_no)}`}>
                              <Ban className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                              <span>Void</span>
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {shownRuns.length === 0 && (
                    <tr>
                      <td colSpan={isOwner ? 9 : 8} className="px-4 py-8 text-center text-sm text-[#a8a090]">No runs match your search.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}


      {/* ---------- Packaging ---------- */}
      {pkOpen && (
        <Modal title="Record Packaging" wide onClose={() => setPkOpen(false)}>
          <form onSubmit={savePackaging} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
            <div className="space-y-4">
              <div>
                <label htmlFor="pk-size" className="cs-label">Perfume and size</label>
                <select id="pk-size" value={pk.size} onChange={(e) => setPk((p) => ({ ...p, size: e.target.value }))} className="cs-input px-3 py-2.5">
                  <option value="">Select...</option>
                  {sizeOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.perfumes.name} · {qty(s.size_ml)} ml</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pk-date" className="cs-label">Date</label>
                <input id="pk-date" type="date" value={pk.date} onChange={(e) => setPk((p) => ({ ...p, date: e.target.value }))} required className="cs-input px-3 py-2.5" />
              </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="pk-qty" className="cs-label">Pieces packaged</label>
                <input id="pk-qty" type="number" min="1" step="1" value={pk.qty} onChange={(e) => setPk((p) => ({ ...p, qty: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
              </div>
              <div>
                <label htmlFor="pk-sp" className="cs-label">Spoiled packs (optional)</label>
                <input id="pk-sp" type="number" min="0" step="1" value={pk.spoiled} onChange={(e) => setPk((p) => ({ ...p, spoiled: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
              </div>
            </div>

            <fieldset>
              <legend className="cs-label">Pack type</legend>
              <div className="flex gap-3">
                {[['box', 'Box set'], ['pouch', 'Pouch set']].map(([val, label]) => (
                  <label key={val} className={`flex-1 cursor-pointer rounded-xl border px-4 py-2.5 text-sm text-center transition-colors ${pk.pack === val ? 'border-[#d9b24c] bg-[#1f1b12] text-[#e3bf5a]' : 'border-[#2a2622] text-[#a8a090] hover:bg-[#1a1816]'}`}>
                    <input type="radio" name="pk-pack" value={val} checked={pk.pack === val} onChange={() => setPk((p) => ({ ...p, pack: val }))} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="pk-notes" className="cs-label">Notes (optional)</label>
              <input id="pk-notes" value={pk.notes} onChange={(e) => setPk((p) => ({ ...p, notes: e.target.value }))} className="cs-input px-3 py-2.5" />
            </div>
            </div>
            <div className="space-y-4">
            {pk.pack === 'box' ? (
              <>
                <MaterialSelect id="pk-box" label="Box" cat="box" value={pk.box} onChange={(v) => setPk((p) => ({ ...p, box: v }))} mats={mats} />
                <MaterialSelect id="pk-box-sticker" label="Box sticker (optional)" cat="box_sticker" value={pk.box_sticker} onChange={(v) => setPk((p) => ({ ...p, box_sticker: v }))} mats={mats} />
                <MaterialSelect id="pk-wrap" label="Wrap (optional)" cat="wrap" value={pk.wrap} onChange={(v) => setPk((p) => ({ ...p, wrap: v }))} mats={mats} />
              </>
            ) : (
              <>
                <MaterialSelect id="pk-pouch" label="Pouch" cat="pouch" value={pk.pouch} onChange={(v) => setPk((p) => ({ ...p, pouch: v }))} mats={mats} />
                <MaterialSelect id="pk-pouch-sticker" label="Pouch sticker (optional)" cat="pouch_sticker" value={pk.pouch_sticker} onChange={(v) => setPk((p) => ({ ...p, pouch_sticker: v }))} mats={mats} />
                <MaterialSelect id="pk-wrap" label="Wrap (optional)" cat="wrap" value={pk.wrap} onChange={(v) => setPk((p) => ({ ...p, wrap: v }))} mats={mats} />
              </>
            )}

            {pk.size && (
              <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 text-sm space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Pieces to package" value={qty(pkQty)} />
                  <Stat label="Bottled, waiting" value={qty(pkWaiting)} tone={pkQty > pkWaiting ? 'text-[#e5736d]' : 'text-[#3ecf8e]'} />
                  {pkChosen.map((m) => (
                    <Stat key={m.item_id} label={`${m.item_name} (need ${qty(pkNeed)})`} value={`${qty(m.on_hand)} on hand`} tone={pkNeed > Number(m.on_hand || 0) ? 'text-[#e5736d]' : 'text-[#3ecf8e]'} />
                  ))}
                </div>
                {pkBlocked && (
                  <ul className="text-xs text-[#e5736d] space-y-1 border-t border-[#2a2622] pt-3" role="alert">
                    {pkShort.map((m) => <li key={m}>{m}</li>)}
                    <li className="text-[#a8a090]">Restock or lower the quantity to continue.</li>
                  </ul>
                )}
              </div>
            )}

            </div>
            </div>
            <p className="text-[11px] text-[#a8a090]">Spoiled boxes, pouches, stickers and wrap are charged to Production Loss, not to the perfume&rsquo;s cost.</p>
            <ModalActions error={pkError}>
              <button type="button" onClick={() => setPkOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving || pkBlocked} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">{saving ? 'Posting...' : 'Post Packaging'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Void ---------- */}
      {voiding && (
        <Modal title={`Void PK-${pad(voiding.run_no)}`} onClose={() => setVoiding(null)}>
          <form onSubmit={doVoid} className="space-y-4">
            <p className="text-sm text-[#a8a090]">This puts the bottled perfume and packaging materials back in stock, removes the finished goods it created and reverses the journal entry. It only works if none of these pieces have been sold or used.</p>
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
