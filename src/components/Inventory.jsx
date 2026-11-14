import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, PlusCircle, AlertTriangle, Pencil, Check, X, ShoppingCart, FlaskConical } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso } from './ui';
import { MATERIAL_CATEGORIES } from './materialCategories';

const CATEGORIES = MATERIAL_CATEGORIES;
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const STATUS_STYLE = {
  OK: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
  Low: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
  Out: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
  'No level': 'bg-[#1c1916] text-[#a8a090] border-[#2a2622]',
};

const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_STYLE[status] || STATUS_STYLE['No level']}`}>
      {status}
    </span>
  );
}

// Reorder level cell: the owner can click the pencil to change it
function LevelCell({ row, isOwner, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);

  const start = () => {
    setVal(String(Number(row.reorder_level) || ''));
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    await onSave(row, Number(val) || 0);
    setBusy(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <input
          type="number"
          min="0"
          step="any"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          autoFocus
          aria-label={`Reorder level for ${row.item_name}`}
          className="cs-input px-2 py-1.5 w-24 text-right text-xs"
        />
        <button onClick={save} disabled={busy} className="text-[#3ecf8e] cursor-pointer" aria-label="Save level">
          <Check className="w-4 h-4" />
        </button>
        <button onClick={() => setEditing(false)} className="text-[#a8a090] cursor-pointer" aria-label="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="font-mono text-xs">{Number(row.reorder_level) > 0 ? qty(row.reorder_level) : '-'}</span>
      {isOwner && (
        <button onClick={start} className="text-[#a8a090] hover:text-[#e3bf5a] cursor-pointer" aria-label={`Set level for ${row.item_name}`}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// Small banner for the dashboard. Usage: <InventoryAlertBanner onOpen={() => setActiveTab('inventory')} />
export function InventoryAlertBanner({ onOpen }) {
  const [alerts, setAlerts] = useState([]);
  useEffect(() => {
    supabase
      .from('inventory_status')
      .select('item_name, size_ml, status, action')
      .in('status', ['Low', 'Out'])
      .then(({ data }) => setAlerts(data || []));
  }, []);
  if (alerts.length === 0) return null;
  const buy = alerts.filter((a) => a.action === 'Purchase').length;
  const make = alerts.filter((a) => a.action === 'Produce').length;
  return (
    <button
      onClick={onOpen}
      className="w-full mb-5 flex items-center gap-3 rounded-xl border border-[#e5a93d]/40 bg-[#e5a93d]/10 px-4 py-3 text-left cursor-pointer hover:bg-[#e5a93d]/15 transition-colors"
    >
      <AlertTriangle className="w-5 h-5 text-[#e5a93d] shrink-0" aria-hidden="true" />
      <span className="text-sm">
        <strong className="text-[#e5a93d]">{alerts.length} stock alert{alerts.length > 1 ? 's' : ''}</strong>
        <span className="text-[#a8a090]">
          {' '}
          {buy > 0 && `${buy} to purchase`}
          {buy > 0 && make > 0 && ' · '}
          {make > 0 && `${make} to produce`}. Click to review.
        </span>
      </span>
    </button>
  );
}

export default function Inventory({ user, onNavigate, onChanged }) {
  const isOwner = user?.role === 'owner';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [f, setF] = useState({ name: '', category: 'oil', unit: 'ml', notes: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase.from('inventory_status').select('*');
    if (error) setLoadError(error.message);
    else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const materials = useMemo(
    () =>
      rows
        .filter((r) => r.kind === 'material')
        .sort((a, b) => CATEGORIES.findIndex((c) => c.id === a.group_name) - CATEGORIES.findIndex((c) => c.id === b.group_name) || a.item_name.localeCompare(b.item_name)),
    [rows]
  );
  const perfumes = useMemo(
    () => rows.filter((r) => r.kind === 'finished').sort((a, b) => a.item_name.localeCompare(b.item_name) || Number(a.size_ml) - Number(b.size_ml)),
    [rows]
  );
  const alerts = useMemo(
    () => rows.filter((r) => r.status === 'Low' || r.status === 'Out').sort((a, b) => (a.status === b.status ? 0 : a.status === 'Out' ? -1 : 1)),
    [rows]
  );
  const unset = rows.filter((r) => r.status === 'No level').length;
  const materialsValue = materials.reduce((s, r) => s + Number(r.value), 0);
  const finishedUnits = perfumes.reduce((s, r) => s + Number(r.on_hand), 0);
  const finishedValue = perfumes.reduce((s, r) => s + Number(r.value), 0);

  const saveLevel = async (row, level) => {
    const { error } = await supabase.from('stock_thresholds').upsert(
      {
        item_kind: row.kind === 'material' ? 'material' : 'size',
        item_id: row.item_id,
        reorder_level: level,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'item_kind,item_id' }
    );
    if (error) setLoadError(error.message);
    await load();
    onChanged && onChanged();
  };

  const openForm = () => {
    setF({ name: '', category: 'oil', unit: 'ml', notes: '' });
    setFormError('');
    setFormOpen(true);
  };

  const pickCategory = (category) => {
    const c = CATEGORIES.find((x) => x.id === category);
    setF((p) => ({ ...p, category, unit: c.unit }));
  };

  const saveMaterial = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return setFormError('Material name is required.');
    if (!f.unit.trim()) return setFormError('Unit is required.');
    setSaving(true);
    setFormError('');
    const { error } = await supabase.from('materials').insert({
      name: f.name.trim(),
      category: f.category,
      unit: f.unit.trim(),
      notes: nz(f.notes),
    });
    setSaving(false);
    if (error) return setFormError(error.code === '23505' ? 'A material with this name already exists.' : error.message);
    setFormOpen(false);
    await load();
  };

  const go = (action) => {
    if (!onNavigate) return;
    onNavigate(action === 'Purchase' ? 'procurement' : 'maceration');
  };

  const renderTable = ({ title, icon: Icon, list, perfume }) => (
    <div key={title} className="cs-card overflow-hidden mb-6">
      <div className="p-4 border-b border-[#2a2622] flex items-center gap-2 text-sm">
        <Icon className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" />
        <span>{title}</span>
      </div>
      {list.length === 0 ? (
        <p className="p-6 text-sm text-[#a8a090]">
          {perfume ? 'Add perfumes with sizes in the Signature Collection to see them here.' : 'No materials yet. Use Add Material to start your catalog.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
              <tr>
                <th className="px-4 py-3 font-medium">{perfume ? 'Perfume' : 'Material'}</th>
                <th className="px-4 py-3 font-medium text-right">On hand</th>
                {perfume && <th className="px-4 py-3 font-medium text-right">Bottled (to package)</th>}
                {perfume && <th className="px-4 py-3 font-medium text-right">Juice / maceration</th>}
                <th className="px-4 py-3 font-medium text-right">Value</th>
                <th className="px-4 py-3 font-medium text-right">Reorder level</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#24201c]">
              {list.map((r) => (
                <tr key={`${r.kind}-${r.item_id}`} className="hover:bg-[#1c1916] transition-colors">
                  <td className="px-4 py-3">
                    <div>{perfume ? `${r.item_name} · ${qty(r.size_ml)} ml` : r.item_name}</div>
                    <div className="text-[10px] text-[#a8a090]">
                      <span className="font-mono">{r.sku}</span>
                      {!perfume && ` · ${CAT_LABEL[r.group_name] || r.group_name}`}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {qty(r.on_hand)} <span className="text-[10px] text-[#a8a090]">{r.unit}</span>
                  </td>
                  {perfume && <td className="px-4 py-3 text-right font-mono">{qty(r.pipeline_units)}</td>}
                  {perfume && (
                    <td className="px-4 py-3 text-right font-mono text-xs text-[#a8a090]">
                      {qty(r.juice_ml)} ml matured
                      <br />
                      {qty(r.macerating_ml)} ml macerating
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-mono">{peso(r.value)}</td>
                  <td className="px-4 py-3">
                    <LevelCell row={r} isOwner={isOwner} onSave={saveLevel} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="Inventory Overview" subtitle="Raw materials and goods available for sale, valued at FIFO cost">
        <button onClick={openForm} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Add Material</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading inventory...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              ['Needs attention', alerts.length, alerts.length > 0 ? 'text-[#e5a93d]' : 'text-[#3ecf8e]'],
              ['Raw materials value', peso(materialsValue), ''],
              ['Finished goods (pcs)', qty(finishedUnits), ''],
              ['Finished goods value', peso(finishedValue), ''],
            ].map(([label, value, tone]) => (
              <div key={label} className="cs-card p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">{label}</div>
                <div className={`font-serif text-2xl mt-1 ${tone}`}>{value}</div>
              </div>
            ))}
          </div>

          <div className="cs-card mb-6 overflow-hidden">
            <div className="p-4 border-b border-[#2a2622] flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-[#e5a93d]" aria-hidden="true" />
              <span>Needs attention</span>
            </div>
            {alerts.length === 0 ? (
              <p className="p-5 text-sm text-[#a8a090]">
                {unset > 0
                  ? `Nothing is low right now. ${unset} item${unset > 1 ? 's have' : ' has'} no reorder level yet${isOwner ? ': click the pencil in the tables below to set one.' : '; the owner sets these.'}`
                  : 'Everything is above its reorder level.'}
              </p>
            ) : (
              <ul className="divide-y divide-[#24201c]">
                {alerts.map((a) => {
                  const isBuy = a.action === 'Purchase';
                  return (
                    <li key={`${a.kind}-${a.item_id}`} className="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
                      <div className="min-w-0">
                        <div className="text-sm">
                          {a.item_name}
                          {a.kind === 'finished' && ` · ${qty(a.size_ml)} ml`}
                        </div>
                        <div className="text-xs text-[#a8a090]">
                          {qty(a.on_hand)} {a.unit} on hand, level {qty(a.reorder_level)}
                          {a.kind === 'finished' &&
                            ` · ${qty(a.pipeline_units)} bottled, ${qty(a.juice_ml)} ml juice, ${qty(a.macerating_ml)} ml macerating`}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={a.status} />
                        <button onClick={() => go(a.action)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs">
                          {isBuy ? <ShoppingCart className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" /> : <FlaskConical className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />}
                          <span>{isBuy ? 'Purchase' : 'Produce'}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="cs-card">
              <EmptyState
                icon={Boxes}
                title="No inventory items yet"
                text="Add your raw materials, then record a purchase to bring stock in."
                actionLabel="Add Material"
                onAction={openForm}
              />
            </div>
          ) : (
            <>
              {renderTable({ title: 'Raw materials and packaging', icon: Boxes, list: materials })}
              {renderTable({ title: 'Perfumes available for sale', icon: Boxes, list: perfumes, perfume: true })}
            </>
          )}
          <p className="text-[11px] text-[#a8a090]">
            Levels are set by the owner. A perfume counts as Low when finished, packaged pieces fall to its level; bottled stock, matured juice and
            maceration in progress are shown beside it so you can see what is already on the way.
          </p>
        </>
      )}

      {formOpen && (
        <Modal title="Add Material" onClose={() => setFormOpen(false)}>
          <form onSubmit={saveMaterial} className="space-y-4">
            <div>
              <label htmlFor="mat-name" className="cs-label">Material name</label>
              <input id="mat-name" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Sandalwood oil" required autoFocus className="cs-input px-3.5 py-2.5" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="mat-cat" className="cs-label">Category</label>
                <select id="mat-cat" value={f.category} onChange={(e) => pickCategory(e.target.value)} className="cs-input px-3 py-2.5">
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mat-unit" className="cs-label">Unit</label>
                <input
                  id="mat-unit"
                  value={f.unit}
                  onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))}
                  disabled={f.category === 'oil' || f.category === 'solvent'}
                  className="cs-input px-3.5 py-2.5"
                />
              </div>
            </div>
            <div>
              <label htmlFor="mat-notes" className="cs-label">Notes (optional)</label>
              <input id="mat-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} className="cs-input px-3.5 py-2.5" />
            </div>
            <p className="text-[11px] text-[#a8a090]">Oils and solvent are always counted in ml so batches add up correctly.</p>
            <ErrorNote>{formError}</ErrorNote>
            <div className="pt-2 flex justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Saving...' : 'Save Material'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
