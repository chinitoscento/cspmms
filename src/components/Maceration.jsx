import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, PlusCircle, Trash2, CheckCircle2, Settings2, Droplets, Ban } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso, fmtDate, ModalActions, STICKY_TH, STICKY_TD } from './ui';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const pad = (n) => String(n).padStart(8, '0');
const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const daysUntil = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(`${todayLocal()}T00:00:00`)) / 86400000);

let keySeed = 0;
const newInput = () => ({ key: `m${++keySeed}`, material_id: '', qty: '' });

function Badge({ tone, children }) {
  const tones = {
    green: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    amber: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
    gray: 'bg-[#1c1916] text-[#a8a090] border-[#2a2622]',
    blue: 'bg-[#6ea8fe]/10 text-[#6ea8fe] border-[#6ea8fe]/30',
    red: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
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

export default function Maceration({ user, onChanged, onNavigate }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [settings, setSettings] = useState({ maceration_days: null, normal_loss_pct: null }); // read from business_settings, no built-in numbers
  const [perfumes, setPerfumes] = useState([]);
  const [stock, setStock] = useState([]); // inventory_status rows
  const [batches, setBatches] = useState([]);
  const [bottledIds, setBottledIds] = useState(() => new Set()); // matured batches whose juice has all been bottled

  const [saving, setSaving] = useState(false);

  // settings editor (owner)
  const [setOpen, setSetOpen] = useState(false);
  const [setDays, setSetDays] = useState('60');
  const [setLoss, setSetLoss] = useState('3');
  const [setError, setSetError] = useState('');

  // new batch
  const [bOpen, setBOpen] = useState(false);
  const [bPerfume, setBPerfume] = useState('');
  const [bDate, setBDate] = useState(todayLocal());
  const [bNotes, setBNotes] = useState('');
  const [bInputs, setBInputs] = useState([newInput(), newInput()]);
  const [bError, setBError] = useState('');

  // complete batch
  const [completing, setCompleting] = useState(null);
  const [cDate, setCDate] = useState(todayLocal());
  const [cYield, setCYield] = useState('');
  const [cError, setCError] = useState('');
  const [done, setDone] = useState(null); // last completed batch, offers the jump to Bottling

  // void batch (owner)
  const [voiding, setVoiding] = useState(null);
  const [vReason, setVReason] = useState('');
  const [vError, setVError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [st, pf, inv, mb, mx, br] = await Promise.all([
      supabase.from('business_settings').select('maceration_days, normal_loss_pct').eq('id', true).maybeSingle(),
      supabase.from('perfumes').select('id, name, status').neq('status', 'Discontinued').order('name'),
      supabase.from('inventory_status').select('*'),
      supabase.from('maceration_batches').select('*, perfumes(id, name), maceration_inputs(qty, cost, materials(name, category))').order('batch_no', { ascending: false }).limit(100),
      // Bottling takes juice from a perfume-wide pool, oldest batch first, so a batch counts as Bottled once the saved
      // (not voided) bottling runs for its perfume have used up its yield. A voided run frees the juice again.
      supabase.from('maceration_batches').select('id, batch_no, actual_yield_ml, perfumes(id)').eq('status', 'Matured'),
      supabase.from('bottling_runs').select('juice_ml, status, perfume_sizes(perfume_id)'),
    ]);
    const err = [st, pf, inv, mb].find((r) => r.error);
    if (err) setLoadError(err.error.message);
    else if (!st.data) setLoadError('Maceration settings were not found. Ask the owner to set the maceration time and normal loss.');
    if (st.data) {
      setSettings({ maceration_days: st.data.maceration_days, normal_loss_pct: Number(st.data.normal_loss_pct) });
    }
    setPerfumes(pf.data || []);
    setStock(inv.data || []);
    setBatches(mb.data || []);

    // Not fatal: if these two reads fail, batches simply keep showing Matured.
    const juiceUsed = {};
    (br.data || []).forEach((r) => {
      if ((r.status || 'Posted') !== 'Posted') return;
      const pid = r.perfume_sizes?.perfume_id;
      if (pid) juiceUsed[pid] = (juiceUsed[pid] || 0) + Number(r.juice_ml || 0);
    });
    const bottledSet = new Set();
    [...(mx.data || [])]
      .sort((a, b) => a.batch_no - b.batch_no)
      .forEach((b) => {
        const pid = b.perfumes?.id;
        const y = Number(b.actual_yield_ml || 0);
        if (!pid || !(y > 0)) return;
        if ((juiceUsed[pid] || 0) >= y - 0.0005) {
          juiceUsed[pid] -= y;
          bottledSet.add(b.id);
        } else {
          juiceUsed[pid] = 0; // this batch is only partly bottled, so no later batch can be
        }
      });
    setBottledIds(bottledSet);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const afterChange = async () => {
    await load();
    onChanged && onChanged();
  };

  const mats = useMemo(() => stock.filter((r) => r.kind === 'material'), [stock]);
  const matById = useMemo(() => Object.fromEntries(mats.map((m) => [m.item_id, m])), [mats]);
  // ---------- settings ----------
  const openSettings = () => {
    setSetDays(settings.maceration_days == null ? '' : String(settings.maceration_days));
    setSetLoss(settings.normal_loss_pct == null ? '' : String(+(settings.normal_loss_pct * 100).toFixed(2)));
    setSetError('');
    setSetOpen(true);
  };
  const saveSettings = async (e) => {
    e.preventDefault();
    const days = parseInt(setDays, 10);
    const loss = Number(setLoss);
    if (!(days > 0)) return setSetError('Days must be more than zero.');
    if (!(loss >= 0 && loss < 100)) return setSetError('Normal loss must be between 0 and 99.99 percent.');
    setSaving(true);
    const { error } = await supabase.from('business_settings').update({ maceration_days: days, normal_loss_pct: loss / 100 }).eq('id', true);
    setSaving(false);
    if (error) return setSetError(error.message);
    setSetOpen(false);
    await load();
  };

  // ---------- new batch ----------
  const openBatch = () => {
    setBPerfume('');
    setBDate(todayLocal());
    setBNotes('');
    setBInputs([newInput(), newInput()]);
    setBError('');
    setBOpen(true);
  };
  const updateInput = (key, patch) => setBInputs((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const bTotals = useMemo(() => {
    let oil = 0;
    let solvent = 0;
    bInputs.forEach((i) => {
      const m = matById[i.material_id];
      const q = Number(i.qty) || 0;
      if (!m) return;
      if (m.group_name === 'oil') oil += q;
      else solvent += q;
    });
    return { oil, solvent, total: oil + solvent, expected: (oil + solvent) * (1 - (settings.normal_loss_pct || 0)) };
  }, [bInputs, matById, settings.normal_loss_pct]);

  // Ingredients the stock cannot cover (the same material may be used on more than one line)
  const bShort = useMemo(() => {
    const need = {};
    bInputs.forEach((i) => {
      if (i.material_id) need[i.material_id] = (need[i.material_id] || 0) + (Number(i.qty) || 0);
    });
    return Object.entries(need)
      .filter(([id, q]) => q > Number(matById[id]?.on_hand || 0))
      .map(([id, q]) => `Not enough ${matById[id]?.item_name}: ${qty(q)} ml needed, ${qty(matById[id]?.on_hand)} ml on hand.`);
  }, [bInputs, matById]);

  const saveBatch = async (e) => {
    e.preventDefault();
    if (!bPerfume) return setBError('Choose the perfume.');
    const used = bInputs.filter((i) => i.material_id || Number(i.qty));
    if (used.some((i) => !i.material_id || !(Number(i.qty) > 0))) return setBError('Every ingredient needs a material and a quantity.');
    if (bTotals.oil <= 0 || bTotals.solvent <= 0) return setBError('A batch needs at least one oil and one solvent.');
    const need = {};
    used.forEach((i) => {
      need[i.material_id] = (need[i.material_id] || 0) + Number(i.qty);
    });
    const short = Object.entries(need).find(([id, q]) => q > Number(matById[id]?.on_hand || 0));
    if (short) return setBError(`Not enough ${matById[short[0]]?.item_name} in stock (${qty(matById[short[0]]?.on_hand)} ml on hand).`);

    setSaving(true);
    setBError('');
    const { error } = await supabase.rpc('start_maceration', {
      p_perfume: bPerfume,
      p_date: bDate || todayLocal(),
      p_notes: nz(bNotes),
      p_inputs: used.map((i) => ({ material_id: i.material_id, qty: Number(i.qty) })),
    });
    setSaving(false);
    if (error) return setBError(error.message);
    setBOpen(false);
    await afterChange();
  };

  // ---------- complete batch ----------
  const openComplete = (b) => {
    setCompleting(b);
    setCDate(todayLocal());
    setCYield(''); // never assume the expected amount: enter what was actually recovered
    setCError('');
  };
  // ---------- void batch ----------
  const openVoid = (b) => {
    setVoiding(b);
    setVReason('');
    setVError('');
  };
  const doVoid = async (e) => {
    e.preventDefault();
    if (!vReason.trim()) return setVError('Please give a reason.');
    setSaving(true);
    setVError('');
    const { error } = await supabase.rpc('void_maceration', { p_id: voiding.id, p_reason: vReason.trim() });
    setSaving(false);
    if (error) return setVError(error.message);
    setVoiding(null);
    await afterChange();
  };

  const cYieldNum = Number(cYield) || 0;
  const cAbnormal = completing && cYieldNum > 0 ? Math.max(0, Number(completing.expected_ml) - cYieldNum) : 0;

  const saveComplete = async (e) => {
    e.preventDefault();
    if (!(cYieldNum > 0)) return setCError('Enter the juice yield in ml.');
    if (cYieldNum > Number(completing.total_input_ml)) return setCError(`The yield cannot be more than the ${qty(completing.total_input_ml)} ml put in.`);
    setSaving(true);
    setCError('');
    const { error } = await supabase.rpc('complete_maceration', { p_batch: completing.id, p_date: cDate || todayLocal(), p_yield_ml: cYieldNum });
    setSaving(false);
    if (error) return setCError(error.message);
    setDone({ no: completing.batch_no, perfumeId: completing.perfumes?.id, name: completing.perfumes?.name, yieldMl: cYieldNum });
    setCompleting(null);
    await afterChange();
  };

  return (
    <div>
      <PageHeader title="Maceration Lab" subtitle="Oils and solvent turned into matured juice, costed from the oldest stock first">
        <button onClick={openBatch} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Start Maceration Batch</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : (
        <div>
          {done && (
            <div className="rounded-xl border border-[#3ecf8e]/30 bg-[#3ecf8e]/10 px-4 py-3 mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-[#3ecf8e]">
                MB-{pad(done.no)} completed. {qty(done.yieldMl)} ml of {done.name} juice is ready for bottling.
              </span>
              <span className="flex items-center gap-2">
                {onNavigate && (
                  <button onClick={() => onNavigate('bottling', { perfumeId: done.perfumeId })} className="cs-btn cs-btn-gold px-3 py-1.5 text-xs">
                    <Droplets className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Bottle now</span>
                  </button>
                )}
                <button onClick={() => setDone(null)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">Dismiss</button>
              </span>
            </div>
          )}
          <div className="cs-card px-4 py-3 mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-[#a8a090]">
              Maceration time <strong className="text-[#ece6d8]">{settings.maceration_days ?? '-'} days</strong> · Normal loss{' '}
              <strong className="text-[#ece6d8]">{settings.normal_loss_pct == null ? '-' : +(settings.normal_loss_pct * 100).toFixed(2)}%</strong>
            </span>
            {isOwner && (
              <button onClick={openSettings} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
                <Settings2 className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                <span>Change</span>
              </button>
            )}
          </div>

          <div className="cs-card overflow-hidden">
            {batches.length === 0 ? (
              <EmptyState
                icon={FlaskConical}
                title="No maceration batches yet"
                text="Start a batch from oils and solvent. After the maceration time, record the actual juice yield."
                actionLabel="Start Maceration Batch"
                onAction={openBatch}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Batch</th>
                      <th className="px-4 py-3 font-medium">Perfume</th>
                      <th className="px-4 py-3 font-medium">Started</th>
                      <th className="px-4 py-3 font-medium">Ready</th>
                      <th className="px-4 py-3 font-medium text-right">Put in</th>
                      <th className="px-4 py-3 font-medium text-right">Yield</th>
                      <th className="px-4 py-3 font-medium text-right">Cost</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className={`px-4 py-3 ${STICKY_TH}`}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {batches.map((b) => {
                      const left = daysUntil(b.ready_date);
                      const ready = b.status === 'Macerating' && left <= 0;
                      const bottled = b.status === 'Matured' && bottledIds.has(b.id);
                      return (
                        <tr key={b.id} className={`bg-[#141210] hover:bg-[#1c1916] transition-colors ${b.status === 'Voided' ? 'opacity-60' : ''}`}>
                          <td className="px-4 py-3 font-mono text-xs text-[#e3bf5a]">MB-{pad(b.batch_no)}</td>
                          <td className="px-4 py-3">{b.perfumes?.name}</td>
                          <td className="px-4 py-3 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(b.start_date)}</td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {fmtDate(b.ready_date)}
                            {b.status === 'Macerating' && (
                              <div className={ready ? 'text-[#3ecf8e]' : 'text-[#a8a090]'}>{ready ? 'Ready now' : `${left} day${left === 1 ? '' : 's'} left`}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{qty(b.total_input_ml)} ml</td>
                          <td className="px-4 py-3 text-right font-mono">
                            {b.status === 'Matured' ? `${qty(b.actual_yield_ml)} ml` : b.status === 'Voided' ? <span className="text-[#a8a090]">-</span> : <span className="text-[#a8a090]">~{qty(b.expected_ml)} ml</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{peso(b.total_cost)}</td>
                          <td className="px-4 py-3">
                            <Badge tone={b.status === 'Voided' ? 'red' : bottled ? 'blue' : b.status === 'Matured' ? 'green' : ready ? 'green' : 'amber'}>{bottled ? 'Bottled' : b.status === 'Macerating' && ready ? 'Ready' : b.status}</Badge>
                            {b.status === 'Voided' && b.void_reason && <div className="text-[10px] text-[#a8a090] mt-1">{b.void_reason}</div>}
                          </td>
                          <td className={`px-4 py-3 text-right ${STICKY_TD}`}>
                            {b.status === 'Macerating' && (isOwner || ready) && (
                              <button onClick={() => openComplete(b)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                                <span>Complete</span>
                              </button>
                            )}
                            {b.status === 'Matured' && !bottled && onNavigate && (
                              <button
                                onClick={() => onNavigate('bottling', { perfumeId: b.perfumes?.id })}
                                className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs"
                                aria-label={`Bottle ${b.perfumes?.name} from MB-${pad(b.batch_no)}`}
                              >
                                <Droplets className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                                <span>Bottle</span>
                              </button>
                            )}
                            {isOwner && b.status !== 'Voided' && !bottled && (
                              <button
                                onClick={() => openVoid(b)}
                                className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs ml-2"
                                title="Void batch"
                                aria-label={`Void MB-${pad(b.batch_no)}`}
                              >
                                <Ban className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                                <span className="sr-only">Void</span>
                              </button>
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
        </div>
      )}

      {/* ---------- Settings ---------- */}
      {setOpen && (
        <Modal title="Maceration settings" onClose={() => setSetOpen(false)}>
          <form onSubmit={saveSettings} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="st-days" className="cs-label">Maceration time (days)</label>
                <input id="st-days" type="number" min="1" step="1" value={setDays} onChange={(e) => setSetDays(e.target.value)} className="cs-input px-3 py-2.5" />
              </div>
              <div>
                <label htmlFor="st-loss" className="cs-label">Normal loss (%)</label>
                <input id="st-loss" type="number" min="0" max="99.99" step="0.01" value={setLoss} onChange={(e) => setSetLoss(e.target.value)} className="cs-input px-3 py-2.5" />
              </div>
            </div>
            <p className="text-[11px] text-[#a8a090]">
              Normal loss is the evaporation you expect over the maceration. It stays inside the juice cost. Loss above it is booked to Maceration
              Loss. Changes apply to new batches only.
            </p>
            <ModalActions error={setError}>
              <button type="button" onClick={() => setSetOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Saving...' : 'Save'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- New batch ---------- */}
      {bOpen && (
        <Modal title="Start Maceration Batch" onClose={() => setBOpen(false)} wide>
          <form onSubmit={saveBatch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
            <div className="space-y-4">
              <div>
                <label htmlFor="mb-perfume" className="cs-label">Perfume</label>
                <select id="mb-perfume" value={bPerfume} onChange={(e) => setBPerfume(e.target.value)} className="cs-input px-3 py-2.5">
                  <option value="">Select perfume...</option>
                  {perfumes.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mb-date" className="cs-label">Start date</label>
                <input id="mb-date" type="date" value={bDate} onChange={(e) => setBDate(e.target.value)} required className="cs-input px-3 py-2.5" />
              </div>
            <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 grid grid-cols-2 sm:grid-cols-2 gap-3 text-sm">
              <Stat label="Oils" value={`${qty(bTotals.oil)} ml`} />
              <Stat label="Solvent" value={`${qty(bTotals.solvent)} ml`} />
              <Stat label="Total in" value={`${qty(bTotals.total)} ml`} />
              <Stat label="Estimated yield" value={`~${qty(bTotals.expected)} ml`} tone="text-[#e3bf5a]" />
            </div>

            {bShort.length > 0 && (
              <ul className="text-xs text-[#e5736d] space-y-1 rounded-xl border border-[#e5736d]/30 bg-[#e5736d]/5 px-4 py-3" role="alert">
                {bShort.map((m) => <li key={m}>{m}</li>)}
                <li className="text-[#a8a090]">Restock or lower the quantity to continue.</li>
              </ul>
            )}

            <div>
              <label htmlFor="mb-notes" className="cs-label">Notes (optional)</label>
              <input id="mb-notes" value={bNotes} onChange={(e) => setBNotes(e.target.value)} className="cs-input px-3 py-2.5" />
            </div>
            </div>
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-12 gap-3 text-xs uppercase tracking-wider text-[#a8a090]">
                <span className="col-span-8">Oil or solvent</span>
                <span className="col-span-3 text-right">Quantity (ml)</span>
                <span className="col-span-1" />
              </div>
              {bInputs.map((i, n) => (
                <div key={i.key} className="grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-12 sm:col-span-8">
                    <MaterialSelect id={`bi-${i.key}`} label={`Ingredient ${n + 1}`} cat={['oil', 'solvent']} value={i.material_id} onChange={(v) => updateInput(i.key, { material_id: v })} mats={mats} hideLabel />
                  </div>
                  <div className="col-span-10 sm:col-span-3">
                    <label htmlFor={`bq-${i.key}`} className="sr-only">Quantity for ingredient {n + 1}</label>
                    <input id={`bq-${i.key}`} type="number" min="0" step="any" placeholder="ml" value={i.qty} onChange={(e) => updateInput(i.key, { qty: e.target.value })} className="cs-input px-3 py-2.5 text-right" />
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-end">
                    {bInputs.length > 2 && (
                      <button type="button" onClick={() => setBInputs((prev) => prev.filter((x) => x.key !== i.key))} className="text-[#a8a090] hover:text-[#e5736d] cursor-pointer" aria-label={`Remove ingredient ${n + 1}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setBInputs((prev) => [...prev, newInput()])} className="cs-btn cs-btn-ghost px-3 py-2 text-xs">
                <PlusCircle className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                <span>Add ingredient</span>
              </button>
            </div>

            </div>
            <p className="text-[11px] text-[#a8a090]">Ready on day {settings.maceration_days ?? '-'}. The oils and solvent are taken from stock now, oldest first, and held as work in process.</p>
            <ModalActions error={bError}>
              <button type="button" onClick={() => setBOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving || bShort.length > 0 || settings.maceration_days == null} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">{saving ? 'Starting...' : 'Start Batch'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Complete batch ---------- */}
      {completing && (
        <Modal title={`Complete MB-${pad(completing.batch_no)}`} onClose={() => setCompleting(null)}>
          <form onSubmit={saveComplete} className="space-y-4">
            <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 grid grid-cols-3 gap-3 text-sm">
              <Stat label="Perfume" value={completing.perfumes?.name} />
              <Stat label="Put in" value={`${qty(completing.total_input_ml)} ml`} />
              <Stat label="Expected" value={`~${qty(completing.expected_ml)} ml`} tone="text-[#e3bf5a]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cm-date" className="cs-label">Completion date</label>
                <input id="cm-date" type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} required className="cs-input px-3 py-2.5" />
              </div>
              <div>
                <label htmlFor="cm-yield" className="cs-label">Actual juice yield (ml)</label>
                <input id="cm-yield" type="number" min="0" step="any" placeholder="Measured amount" value={cYield} onChange={(e) => setCYield(e.target.value)} required autoFocus className="cs-input px-3 py-2.5 text-right" />
              </div>
            </div>
            <p className="text-[11px] text-[#a8a090]">Measure the juice you actually recovered. The expected amount is only an estimate based on the normal loss setting.</p>
            {cYieldNum > 0 && (
              <p className="text-xs text-[#a8a090]">
                Actual loss{' '}
                <span className="font-mono text-[#ece6d8]">
                  {qty(Number(completing.total_input_ml) - cYieldNum)} ml ({(((Number(completing.total_input_ml) - cYieldNum) / Number(completing.total_input_ml)) * 100).toFixed(1)}%)
                </span>
                , against about {qty(completing.expected_ml)} ml expected.
              </p>
            )}
            {cAbnormal > 0 && (
              <p className="text-xs text-[#e5a93d]">
                {qty(cAbnormal)} ml is below the expected yield. That part of the cost will be booked to Maceration Loss.
              </p>
            )}
            {daysUntil(completing.ready_date) > 0 && (
              <p className="text-xs text-[#e5a93d]">This batch is not due until {fmtDate(completing.ready_date)}. Only the owner can complete it early.</p>
            )}
            <ModalActions error={cError}>
              <button type="button" onClick={() => setCompleting(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Posting...' : 'Complete Batch'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* ---------- Void batch ---------- */}
      {voiding && (
        <Modal title={`Void MB-${pad(voiding.batch_no)}`} onClose={() => setVoiding(null)}>
          <form onSubmit={doVoid} className="space-y-4">
            <p className="text-sm text-[#a8a090]">
              {voiding.status === 'Matured'
                ? 'This puts the oils and solvent back in stock, removes the matured juice and reverses the journal entries. It only works if none of the juice has been bottled; if it has, void the bottling run first.'
                : 'This puts the oils and solvent back in stock at their original cost and reverses the journal entry.'}{' '}
              The batch stays in the list, marked Voided.
            </p>
            <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 grid grid-cols-3 gap-3 text-sm">
              <Stat label="Perfume" value={voiding.perfumes?.name} />
              <Stat label="Put in" value={`${qty(voiding.total_input_ml)} ml`} />
              <Stat label="Cost" value={peso(voiding.total_cost)} tone="text-[#e3bf5a]" />
            </div>
            <div>
              <label htmlFor="mv-reason" className="cs-label">Reason</label>
              <input id="mv-reason" value={vReason} onChange={(e) => setVReason(e.target.value)} placeholder="e.g. Entered twice" required autoFocus className="cs-input px-3.5 py-2.5" />
            </div>
            <ModalActions error={vError}>
              <button type="button" onClick={() => setVoiding(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Voiding...' : 'Void'}</button>
            </ModalActions>
          </form>
        </Modal>
      )}

    </div>
  );
}
