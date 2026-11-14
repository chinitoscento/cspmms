import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Droplets, PlusCircle, Ban, PackageCheck, Check, X } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso, fmtDate, ModalActions, STICKY_TH, STICKY_TD } from './ui';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const pad = (n) => String(n).padStart(8, '0');
const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const blankBt = () => ({ date: todayLocal(), size: '', qty: '', spoiled: '0', bottle: '', sticker: '', notes: '', actual: '', confirm: false });

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

export default function Bottling({ user, onChanged, onNavigate, prefill }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sizes, setSizes] = useState([]);
  const [stock, setStock] = useState([]); // inventory_status rows
  const [runs, setRuns] = useState([]);
  const [saving, setSaving] = useState(false);

  // bottling
  const [btOpen, setBtOpen] = useState(false);
  const [bt, setBt] = useState(blankBt);
  const [requests, setRequests] = useState([]);
  const [threshold, setThreshold] = useState(15);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [rejReason, setRejReason] = useState('');
  const [rejError, setRejError] = useState('');
  const [btError, setBtError] = useState('');
  const [btPerfume, setBtPerfume] = useState(''); // limits the size list to one perfume when coming from Maceration
  const prefillDone = useRef(false);

  // void
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [sz, inv, rn, rq, bs] = await Promise.all([
      supabase.from('perfume_sizes').select('id, size_ml, perfume_id, perfumes(name, status)').eq('is_active', true),
      supabase.from('inventory_status').select('*'),
      supabase.from('bottling_runs').select('*, perfume_sizes(id, size_ml, perfumes(name))').order('run_no', { ascending: false }).limit(100),
      supabase.from('bottling_requests').select('*, perfume_sizes(id, size_ml, perfumes(name))').in('status', ['Pending', 'Rejected']).order('request_no', { ascending: false }).limit(20),
      supabase.from('business_settings').select('bottling_variance_pct').limit(1),
    ]);
    const err = [sz, inv, rn, rq].find((r) => r.error);
    if (err) setLoadError(err.error.message);
    setRequests(rq.data || []);
    const thr = Number(bs.data?.[0]?.bottling_variance_pct);
    setThreshold(Number.isFinite(thr) ? thr : 15);
    setSizes((sz.data || []).filter((s) => s.perfumes && s.perfumes.status !== 'Discontinued'));
    setStock(inv.data || []);
    setRuns(rn.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Arrived from Maceration: open the form with that perfume ready
  useEffect(() => {
    if (loading || !prefill || prefillDone.current) return;
    prefillDone.current = true;
    const forPerfume = prefill.perfumeId ? sizes.filter((s) => s.perfume_id === prefill.perfumeId) : [];
    setBt({ ...blankBt(), size: forPerfume.length === 1 ? forPerfume[0].id : '' });
    setBtPerfume(forPerfume.length > 0 ? prefill.perfumeId : '');
    setBtError('');
    setBtOpen(true);
  }, [loading, prefill, sizes]);

  const afterChange = async () => {
    await load();
    onChanged && onChanged();
  };

  const mats = useMemo(() => stock.filter((r) => r.kind === 'material'), [stock]);
  const matById = useMemo(() => Object.fromEntries(mats.map((m) => [m.item_id, m])), [mats]);
  const finishedBySize = useMemo(() => Object.fromEntries(stock.filter((r) => r.kind === 'finished').map((r) => [r.item_id, r])), [stock]);
  const sizeOptions = useMemo(
    () => [...sizes].sort((a, b) => a.perfumes.name.localeCompare(b.perfumes.name) || Number(a.size_ml) - Number(b.size_ml)),
    [sizes]
  );
  const visibleSizes = btPerfume ? sizeOptions.filter((s) => s.perfume_id === btPerfume) : sizeOptions;
  const waiting = sizeOptions.filter((s) => Number(finishedBySize[s.id]?.pipeline_units || 0) > 0);
  const goPackage = (sizeId) => onNavigate && onNavigate('packaging', { sizeId });
  const sizeName = (r) => (r.perfume_sizes ? `${r.perfume_sizes.perfumes?.name} · ${qty(r.perfume_sizes.size_ml)} ml` : '-');

  // ---------- bottling ----------
  const openBottling = () => {
    setBt(blankBt());
    setNotice('');
    setBtPerfume('');
    setBtError('');
    setBtOpen(true);
  };
  const btSize = sizes.find((s) => s.id === bt.size);
  const btStock = finishedBySize[bt.size];
  const btQty = parseInt(bt.qty, 10) || 0;
  const btSpoiled = parseInt(bt.spoiled, 10) || 0;
  const btJuiceHave = Number(btStock?.juice_ml || 0);
  const btStd = btSize ? btQty * Number(btSize.size_ml) : 0;
  const btActualNum = bt.actual.trim() === '' ? null : Number(bt.actual);
  const btActualBad = btActualNum !== null && !(btActualNum > 0);
  const btAuto = btActualNum === null && btStd > btJuiceHave && btJuiceHave > 0;
  const btJuiceNeed = btActualNum !== null && btActualNum > 0 ? btActualNum : btAuto ? btJuiceHave : btStd;
  const btPerBottle = btQty > 0 ? btJuiceNeed / btQty : 0;
  const btVar = btStd > 0 ? (Math.abs(btJuiceNeed - btStd) * 100) / btStd : 0;
  const btOver = btStd > 0 && btVar > threshold;
  const btNeedsApproval = btOver && !isOwner;
  const btNeed = btQty + btSpoiled; // bottles and stickers used, spoiled ones included
  const btBottle = matById[bt.bottle];
  const btSticker = matById[bt.sticker];
  const btShort = [];
  if (btSize && btJuiceNeed > btJuiceHave) btShort.push(`Not enough matured juice: ${qty(btJuiceNeed)} ml needed, ${qty(btJuiceHave)} ml available (enough for ${Math.floor(btJuiceHave / Number(btSize.size_ml))} bottles).`);
  if (btBottle && btNeed > Number(btBottle.on_hand || 0)) btShort.push(`Not enough ${btBottle.item_name}: ${qty(btNeed)} needed (spoiled included), ${qty(btBottle.on_hand)} on hand.`);
  if (btSticker && btNeed > Number(btSticker.on_hand || 0)) btShort.push(`Not enough ${btSticker.item_name}: ${qty(btNeed)} needed (spoiled included), ${qty(btSticker.on_hand)} on hand.`);
  const btBlocked = btShort.length > 0;

  const saveBottling = async (e) => {
    e.preventDefault();
    if (!bt.size) return setBtError('Choose the perfume and size.');
    if (!(btQty > 0)) return setBtError('Enter how many bottles were filled.');
    if (!bt.bottle || !bt.sticker) return setBtError('Choose the bottle and the bottle sticker.');
    if (btActualBad) return setBtError('The actual juice used must be more than zero.');
    if (btOver && isOwner && !bt.confirm) return setBtError('Tick the confirmation box to continue.');
    if (!btNeedsApproval && btJuiceNeed > Number(btStock?.juice_ml || 0)) return setBtError(`Not enough matured juice: ${qty(btJuiceNeed)} ml needed, ${qty(btStock?.juice_ml)} ml available.`);
    for (const id of [bt.bottle, bt.sticker]) {
      if (btQty + btSpoiled > Number(matById[id]?.on_hand || 0)) return setBtError(`Not enough ${matById[id]?.item_name} in stock.`);
    }
    setSaving(true);
    setBtError('');
    const { data, error } = await supabase.rpc('record_bottling', {
      p_date: bt.date || todayLocal(),
      p_size: bt.size,
      p_qty: btQty,
      p_bottle: bt.bottle,
      p_sticker: bt.sticker,
      p_spoiled: btSpoiled,
      p_notes: nz(bt.notes),
      p_actual_ml: btActualNum,
      p_confirm: !!bt.confirm,
    });
    setSaving(false);
    if (error) return setBtError(error.message);
    setBtOpen(false);
    setNotice(data?.status === 'Pending' ? 'Sent to the owner for approval. Nothing is posted until it is approved.' : '');
    await afterChange();
  };

  // ---------- approval of requests ----------
  const approveRequest = async (row) => {
    setSaving(true);
    setActionError('');
    const { error } = await supabase.rpc('approve_bottling_request', { p_id: row.id });
    setSaving(false);
    if (error) return setActionError(error.message);
    await afterChange();
  };
  const openReject = (row) => {
    setRejecting(row);
    setRejReason('');
    setRejError('');
  };
  const doReject = async (e) => {
    e.preventDefault();
    if (!rejReason.trim()) return setRejError('Please give a reason.');
    setSaving(true);
    setRejError('');
    const { error } = await supabase.rpc('reject_bottling_request', { p_id: rejecting.id, p_reason: rejReason.trim() });
    setSaving(false);
    if (error) return setRejError(error.message);
    setRejecting(null);
    await afterChange();
  };
  const fourteenDaysAgo = Date.now() - 14 * 24 * 3600 * 1000;
  const shownRequests = requests.filter((r) => r.status === 'Pending' || (r.decided_at && new Date(r.decided_at).getTime() >= fourteenDaysAgo));

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
    const { error } = await supabase.rpc('void_bottling', { p_id: voiding.id, p_reason: reason.trim() });
    setSaving(false);
    if (error) return setVoidError(error.message);
    setVoiding(null);
    await afterChange();
  };

  return (
    <div>
      <PageHeader title="Bottling" subtitle="Matured juice, bottles and stickers turned into bottled perfume, costed from the oldest stock first">
        <button onClick={openBottling} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Record Bottling</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {!loading && waiting.length > 0 && (
        <div className="cs-card px-4 py-3 mb-5">
          <div className="text-[10px] uppercase tracking-wider text-[#a8a090] mb-2">Bottled, waiting to be packaged</div>
          <ul className="divide-y divide-[#24201c]">
            {waiting.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>
                  {s.perfumes.name} · {qty(s.size_ml)} ml
                  <span className="ml-3 font-mono text-[#e3bf5a]">{qty(finishedBySize[s.id].pipeline_units)} pcs</span>
                </span>
                {onNavigate && (
                  <button onClick={() => goPackage(s.id)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
                    <PackageCheck className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                    <span>Package</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && <p role="status" className="text-sm text-[#e5a93d] bg-[#2a2010] border border-[#4a3a18] rounded-lg px-3.5 py-2.5 mb-5">{notice}</p>}
      <ErrorNote>{actionError}</ErrorNote>

      {!loading && shownRequests.length > 0 && (
        <div className="cs-card px-4 py-3 mb-5">
          <div className="text-[10px] uppercase tracking-wider text-[#a8a090] mb-2">Bottling requests (juice used differs from the catalogue amount)</div>
          <ul className="divide-y divide-[#24201c]">
            {shownRequests.map((r) => (
              <li key={r.id} className={`py-3 text-sm ${r.status === 'Rejected' ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-mono text-xs text-[#e3bf5a] mr-2">REQ-{pad(r.request_no)}</span>
                    {sizeName(r)} · {qty(r.qty)} bottles
                    <Badge tone={r.status === 'Pending' ? 'amber' : 'red'}>{r.status}</Badge>
                  </div>
                  {isOwner && r.status === 'Pending' && (
                    <div className="inline-flex gap-2">
                      <button onClick={() => approveRequest(r)} disabled={saving} className="cs-btn cs-btn-gold px-3 py-1.5 text-xs" aria-label={`Approve REQ-${pad(r.request_no)}`}>
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Approve</span>
                      </button>
                      <button onClick={() => openReject(r)} disabled={saving} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs" aria-label={`Reject REQ-${pad(r.request_no)}`}>
                        <X className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-[#a8a090] mt-1">
                  {fmtDate(r.run_date)} · juice {qty(r.actual_juice_ml)} ml against {qty(r.std_juice_ml)} ml catalogue ({qty(r.variance_pct)}% off, {qty(Number(r.actual_juice_ml) / r.qty)} ml per bottle)
                  {r.spoiled_qty > 0 ? ` · ${r.spoiled_qty} spoiled` : ''}
                  {matById[r.bottle_material_id] ? ` · ${matById[r.bottle_material_id].item_name}` : ''}
                  {r.notes ? ` · ${r.notes}` : ''}
                </div>
                {r.status === 'Rejected' && r.reject_reason && <div className="text-xs text-[#e5736d] mt-1">Rejected: {r.reject_reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : (
        <div className="cs-card overflow-hidden">
          {runs.length === 0 ? (
            <EmptyState icon={Droplets} title="No bottling yet" text="Bottling uses matured juice, a bottle and a bottle sticker." actionLabel="Record Bottling" onAction={openBottling} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Run</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Perfume</th>
                    <th className="px-4 py-3 font-medium text-right">Bottles</th>
                    <th className="px-4 py-3 font-medium text-right">Juice used</th>
                    <th className="px-4 py-3 font-medium text-right">Spoiled</th>
                    <th className="px-4 py-3 font-medium text-right">Cost per bottle</th>
                    <th className="px-4 py-3 font-medium text-right">Total cost</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className={`px-4 py-3 ${STICKY_TH}`}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {runs.map((r) => (
                    <tr key={r.id} className={`bg-[#141210] hover:bg-[#1c1916] transition-colors ${r.status === 'Voided' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a]">BT-{pad(r.run_no)}</td>
                      <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(r.run_date)}</td>
                      <td className="px-4 py-3">{sizeName(r)}</td>
                      <td className="px-4 py-3 text-right font-mono">{qty(r.qty)}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {qty(r.juice_ml)} ml
                        {r.std_juice_ml != null && Number(r.std_juice_ml) !== Number(r.juice_ml) && (
                          <div className="text-[10px] text-[#a8a090]">catalogue {qty(r.std_juice_ml)} ml</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{r.spoiled_qty > 0 ? `${r.spoiled_qty} (${peso(r.spoiled_cost)})` : '-'}</td>
                      <td className="px-4 py-3 text-right font-mono">{peso(Number(r.bottled_cost) / r.qty)}</td>
                      <td className="px-4 py-3 text-right font-mono">{peso(r.bottled_cost)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={r.status === 'Voided' ? 'red' : 'green'}>{r.status || 'Posted'}</Badge>
                        {r.status === 'Voided' && r.void_reason && <div className="text-[10px] text-[#a8a090] mt-1">{r.void_reason}</div>}
                      </td>
                      <td className={`px-4 py-3 text-right whitespace-nowrap ${STICKY_TD}`}>
                        <div className="inline-flex gap-2">
                          {(r.status || 'Posted') === 'Posted' && onNavigate && Number(finishedBySize[r.perfume_sizes?.id]?.pipeline_units || 0) > 0 && (
                            <button onClick={() => goPackage(r.perfume_sizes.id)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs" aria-label={`Package ${sizeName(r)}`}>
                              <PackageCheck className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                              <span>Package</span>
                            </button>
                          )}
                          {isOwner && (r.status || 'Posted') === 'Posted' && (
                            <button onClick={() => openVoid(r)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs" aria-label={`Void BT-${pad(r.run_no)}`}>
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

      {/* ---------- Bottling ---------- */}
      {btOpen && (
        <Modal title="Record Bottling" wide onClose={() => setBtOpen(false)}>
          <form onSubmit={saveBottling} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
            <div className="space-y-4">
              <div>
                <label htmlFor="bt-size" className="cs-label">Perfume and size</label>
                <select id="bt-size" value={bt.size} onChange={(e) => setBt((p) => ({ ...p, size: e.target.value }))} className="cs-input px-3 py-2.5">
                  <option value="">Select...</option>
                  {visibleSizes.map((s) => (
                    <option key={s.id} value={s.id}>{s.perfumes.name} · {qty(s.size_ml)} ml</option>
                  ))}
                </select>
                {btPerfume && (
                  <button type="button" onClick={() => setBtPerfume('')} className="mt-1.5 text-[11px] text-[#e3bf5a] hover:underline cursor-pointer">
                    Show all perfumes
                  </button>
                )}
              </div>
              <div>
                <label htmlFor="bt-date" className="cs-label">Date</label>
                <input id="bt-date" type="date" value={bt.date} onChange={(e) => setBt((p) => ({ ...p, date: e.target.value }))} required className="cs-input px-3 py-2.5" />
              </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="bt-qty" className="cs-label">Bottles filled</label>
                <input id="bt-qty" type="number" min="1" step="1" value={bt.qty} onChange={(e) => setBt((p) => ({ ...p, qty: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
              </div>
              <div>
                <label htmlFor="bt-sp" className="cs-label">Spoiled bottles (optional)</label>
                <input id="bt-sp" type="number" min="0" step="1" value={bt.spoiled} onChange={(e) => setBt((p) => ({ ...p, spoiled: e.target.value }))} className="cs-input px-3 py-2.5 text-right" />
              </div>
            </div>
            <div>
              <label htmlFor="bt-actual" className="cs-label">Actual juice used, in ml (optional)</label>
              <input id="bt-actual" type="number" min="0" step="0.1" value={bt.actual} onChange={(e) => setBt((p) => ({ ...p, actual: e.target.value, confirm: false }))} placeholder={btAuto ? `Leave empty to use all ${qty(btJuiceHave)} ml` : btStd > 0 ? `Leave empty to use ${qty(btStd)} ml` : 'Leave empty'} className="cs-input px-3 py-2.5 text-right" />
              <p className="text-[11px] text-[#a8a090] mt-1">
                Leave empty and the system uses bottles x size. If that is more than the juice available, it uses all the available juice and shares its full cost across the bottles filled.
                {btSize && btJuiceHave > 0 && (
                  <button type="button" onClick={() => setBt((p) => ({ ...p, actual: String(btJuiceHave), confirm: false }))} className="ml-2 text-[#e3bf5a] hover:underline cursor-pointer">
                    Use all available juice ({qty(btJuiceHave)} ml)
                  </button>
                )}
              </p>
            </div>
            <div>
              <label htmlFor="bt-notes" className="cs-label">Notes (optional)</label>
              <input id="bt-notes" value={bt.notes} onChange={(e) => setBt((p) => ({ ...p, notes: e.target.value }))} className="cs-input px-3 py-2.5" />
            </div>
            </div>
            <div className="space-y-4">
            <MaterialSelect id="bt-bottle" label="Bottle" cat="bottle" value={bt.bottle} onChange={(v) => setBt((p) => ({ ...p, bottle: v }))} mats={mats} />
            <MaterialSelect id="bt-sticker" label="Bottle sticker" cat="bottle_sticker" value={bt.sticker} onChange={(v) => setBt((p) => ({ ...p, sticker: v }))} mats={mats} />
            {btSize && (
              <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 text-sm space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Juice needed" value={`${qty(btJuiceNeed)} ml`} />
                  <Stat label="Matured juice available" value={`${qty(btJuiceHave)} ml`} tone={btJuiceNeed > btJuiceHave ? 'text-[#e5736d]' : 'text-[#3ecf8e]'} />
                  {btBottle && (
                    <>
                      <Stat label="Bottles needed" value={qty(btNeed)} />
                      <Stat label="Bottles on hand" value={qty(btBottle.on_hand)} tone={btNeed > Number(btBottle.on_hand || 0) ? 'text-[#e5736d]' : 'text-[#3ecf8e]'} />
                    </>
                  )}
                  {btSticker && (
                    <>
                      <Stat label="Stickers needed" value={qty(btNeed)} />
                      <Stat label="Stickers on hand" value={qty(btSticker.on_hand)} tone={btNeed > Number(btSticker.on_hand || 0) ? 'text-[#e5736d]' : 'text-[#3ecf8e]'} />
                    </>
                  )}
                </div>
                {btBlocked && (
                  <ul className="text-xs text-[#e5736d] space-y-1 border-t border-[#2a2622] pt-3" role="alert">
                    {btShort.map((m) => <li key={m}>{m}</li>)}
                    <li className="text-[#a8a090]">Restock or lower the quantity to continue.</li>
                  </ul>
                )}
              </div>
            )}
            {btSize && btQty > 0 && btStd > 0 && btJuiceNeed !== btStd && (
              <div className={`rounded-xl border px-4 py-3 text-sm space-y-2 ${btOver ? 'border-[#4a3a18] bg-[#2a2010]' : 'border-[#2a2622] bg-[#14120f]'}`}>
                {btAuto && (
                  <div className="text-xs text-[#e5a93d]">Only {qty(btJuiceHave)} ml of matured juice is available, so all of it is used for these {qty(btQty)} bottles and its full cost is shared across them.</div>
                )}
                <div className="text-xs text-[#a8a090]">
                  {qty(btJuiceNeed)} ml for {qty(btQty)} bottles is {qty(btPerBottle)} ml per bottle, {qty(btVar)}% {btJuiceNeed < btStd ? 'under' : 'over'} the catalogue {qty(btSize.size_ml)} ml.
                </div>
                {btOver && isOwner && (
                  <label className="flex items-start gap-2 text-xs text-[#e5a93d] cursor-pointer">
                    <input type="checkbox" checked={bt.confirm} onChange={(e) => setBt((p) => ({ ...p, confirm: e.target.checked }))} className="mt-0.5" />
                    <span>This is more than {qty(threshold)}% away from the catalogue amount. I confirm the juice used is correct.</span>
                  </label>
                )}
                {btNeedsApproval && (
                  <p className="text-xs text-[#e5a93d]">This is more than {qty(threshold)}% away from the catalogue amount, so it will be sent to the owner for approval. Nothing is posted until it is approved.</p>
                )}
              </div>
            )}
            </div>
            </div>
            <p className="text-[11px] text-[#a8a090]">Spoiled bottles and their stickers are charged to Production Loss, not to the perfume&rsquo;s cost.</p>
            <ModalActions error={btError}>
              <button type="button" onClick={() => setBtOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving || (btBlocked && !btNeedsApproval) || (btOver && isOwner && !bt.confirm)} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">{saving ? 'Posting...' : btNeedsApproval ? 'Send for Approval' : 'Post Bottling'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}


      {/* ---------- Void ---------- */}
      {voiding && (
        <Modal title={`Void BT-${pad(voiding.run_no)}`} onClose={() => setVoiding(null)}>
          <form onSubmit={doVoid} className="space-y-4">
            <p className="text-sm text-[#a8a090]">This puts the juice, bottles and stickers back in stock, removes the bottled perfume it created and reverses the journal entry. It only works if none of these bottles have been packaged yet.</p>
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

      {/* ---------- Reject request ---------- */}
      {rejecting && (
        <Modal title={`Reject REQ-${pad(rejecting.request_no)}`} onClose={() => setRejecting(null)}>
          <form onSubmit={doReject} className="space-y-4">
            <p className="text-sm text-[#a8a090]">Nothing was posted for this request. Rejecting it keeps stock and the books as they are.</p>
            <div>
              <label htmlFor="rej-reason" className="cs-label">Reason</label>
              <input id="rej-reason" value={rejReason} onChange={(e) => setRejReason(e.target.value)} placeholder="e.g. Recount the juice" required autoFocus className="cs-input px-3.5 py-2.5" />
            </div>
            <ModalActions error={rejError}>
              <button type="button" onClick={() => setRejecting(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Rejecting...' : 'Reject'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}
