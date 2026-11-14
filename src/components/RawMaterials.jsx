import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, PlusCircle, Pencil, Search, Power, ShoppingCart } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso } from './ui';
import { MATERIAL_CATEGORIES, CAT_ONE } from './materialCategories';

const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const unitCost = (v) =>
  `\u20B1${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

const STATUS_STYLE = {
  OK: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
  Low: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
  Out: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
  'No level': 'bg-[#1c1916] text-[#a8a090] border-[#2a2622]',
  Inactive: 'bg-[#1c1916] text-[#a8a090] border-[#2a2622]',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_STYLE[status] || STATUS_STYLE['No level']}`}>
      {status}
    </span>
  );
}

const emptyForm = { name: '', category: 'oil', unit: 'ml', supplier_id: '', reorder: '', notes: '' };

export default function RawMaterials({ user, onNavigate, onChanged }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [materials, setMaterials] = useState([]);
  const [inv, setInv] = useState({});
  const [layers, setLayers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const [cat, setCat] = useState('all');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [mat, st, lay, sup] = await Promise.all([
      supabase.from('materials').select('*, suppliers(name)').order('name'),
      supabase.from('inventory_status').select('item_id, on_hand, value, reorder_level, status').eq('kind', 'material'),
      supabase
        .from('stock_layers')
        .select('material_id, received_date, created_at, source, qty_in, cost_in, qty_remaining, cost_remaining')
        .eq('stock_kind', 'material')
        .order('received_date', { ascending: false })
        .limit(5000),
      supabase.from('suppliers').select('id, name').eq('status', 'Active').order('name'),
    ]);
    const err = [mat, st, lay, sup].find((r) => r.error);
    if (err) setLoadError(err.error.message);
    setMaterials(mat.data || []);
    setInv(Object.fromEntries((st.data || []).map((r) => [r.item_id, r])));
    setLayers(lay.data || []);
    setSuppliers(sup.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Per material: cost of the oldest layer still in stock (what the next use is costed at),
  // the latest purchase price, and whether it has any stock history.
  const costs = useMemo(() => {
    const map = {};
    layers.forEach((l) => {
      const m = (map[l.material_id] = map[l.material_id] || { history: true, fifo: null, latest: null });
      if (l.source === 'purchase' && Number(l.qty_in) > 0) {
        const t = `${l.received_date}|${l.created_at}`;
        if (!m.latest || t > m.latest.t) m.latest = { t, unit: Number(l.cost_in) / Number(l.qty_in) };
      }
      if (Number(l.qty_remaining) > 0) {
        const t = `${l.received_date}|${l.created_at}`;
        if (!m.fifo || t < m.fifo.t) m.fifo = { t, unit: Number(l.cost_remaining) / Number(l.qty_remaining) };
      }
    });
    return map;
  }, [layers]);

  const rows = useMemo(
    () =>
      materials
        .map((m) => {
          const s = inv[m.id];
          return {
            ...m,
            on_hand: Number(s?.on_hand || 0),
            value: Number(s?.value || 0),
            reorder_level: Number(s?.reorder_level || 0),
            status: m.is_active ? s?.status || 'No level' : 'Inactive',
            cost: costs[m.id] || { history: false, fifo: null, latest: null },
          };
        })
        .sort(
          (a, b) =>
            MATERIAL_CATEGORIES.findIndex((c) => c.id === a.category) - MATERIAL_CATEGORIES.findIndex((c) => c.id === b.category) ||
            a.name.localeCompare(b.name)
        ),
    [materials, inv, costs]
  );

  const visible = rows.filter(
    (r) =>
      (showInactive || r.is_active) &&
      (cat === 'all' || r.category === cat) &&
      (!search.trim() || `${r.name} ${r.code}`.toLowerCase().includes(search.trim().toLowerCase()))
  );

  const active = rows.filter((r) => r.is_active);
  const totalValue = active.reduce((s, r) => s + r.value, 0);
  const needAttention = active.filter((r) => r.status === 'Low' || r.status === 'Out').length;
  const countByCat = (id) => active.filter((r) => r.category === id).length;

  // ---------- add / edit ----------
  const openAdd = () => {
    setEditing(null);
    setF({ ...emptyForm, category: cat !== 'all' ? cat : 'oil', unit: cat !== 'all' ? MATERIAL_CATEGORIES.find((c) => c.id === cat).unit : 'ml' });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    setF({
      name: r.name,
      category: r.category,
      unit: r.unit,
      supplier_id: r.supplier_id || '',
      reorder: r.reorder_level ? String(r.reorder_level) : '',
      notes: r.notes || '',
    });
    setFormError('');
    setFormOpen(true);
  };

  const pickCategory = (category) => {
    const c = MATERIAL_CATEGORIES.find((x) => x.id === category);
    setF((p) => ({ ...p, category, unit: c.fixedUnit || !p.unit || p.unit === 'ml' ? c.unit : p.unit }));
  };

  const catInfo = MATERIAL_CATEGORIES.find((c) => c.id === f.category);
  const locked = !!editing && editing.cost.history; // the category is fixed once stock has moved; the owner may still correct the unit

  const saveMaterial = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return setFormError('Material name is required.');
    if (!f.unit.trim()) return setFormError('Unit is required.');
    if (f.reorder !== '' && !(Number(f.reorder) >= 0)) return setFormError('The reorder level cannot be negative.');
    setSaving(true);
    setFormError('');

    const payload = {
      name: f.name.trim(),
      category: f.category,
      unit: catInfo.fixedUnit ? 'ml' : f.unit.trim(),
      supplier_id: f.supplier_id || null,
      notes: nz(f.notes),
    };

    let id = editing?.id;
    if (editing) {
      const { error } = await supabase.from('materials').update(payload).eq('id', editing.id);
      if (error) {
        setSaving(false);
        return setFormError(error.code === '23505' ? 'A material with this name already exists.' : error.message);
      }
    } else {
      const { data, error } = await supabase.from('materials').insert(payload).select('id').single();
      if (error) {
        setSaving(false);
        return setFormError(error.code === '23505' ? 'A material with this name already exists.' : error.message);
      }
      id = data.id;
    }

    if (isOwner && (f.reorder !== '' || (editing && editing.reorder_level))) {
      const { error } = await supabase.from('stock_thresholds').upsert(
        { item_kind: 'material', item_id: id, reorder_level: Number(f.reorder || 0), updated_at: new Date().toISOString() },
        { onConflict: 'item_kind,item_id' }
      );
      if (error) {
        setSaving(false);
        return setFormError(`Saved, but the reorder level failed: ${error.message}`);
      }
    }

    setSaving(false);
    setFormOpen(false);
    await load();
    onChanged && onChanged();
  };

  const toggleActive = async (r) => {
    setLoadError('');
    const { error } = await supabase.from('materials').update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) setLoadError(error.message);
    await load();
    onChanged && onChanged();
  };

  return (
    <div>
      <PageHeader title="Raw Materials" subtitle="Oils, solvent, bottles, stickers, boxes, pouches, wrap and other materials you buy and use">
        {onNavigate && (
          <button onClick={() => onNavigate('procurement')} className="cs-btn cs-btn-ghost px-4 py-2.5">
            <ShoppingCart className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" />
            <span>Buy materials</span>
          </button>
        )}
        <button onClick={openAdd} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Add Material</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="cs-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">Active materials</div>
          <div className="font-serif text-2xl mt-1">{active.length}</div>
        </div>
        <div className="cs-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">Raw materials in stock (at cost)</div>
          <div className="font-serif text-2xl mt-1">{peso(totalValue)}</div>
        </div>
        <div className="cs-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">Low or out of stock</div>
          <div className={`font-serif text-2xl mt-1 ${needAttention > 0 ? 'text-[#e5a93d]' : 'text-[#3ecf8e]'}`}>{needAttention}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4" role="group" aria-label="Filter by category">
        {[{ id: 'all', label: 'All' }, ...MATERIAL_CATEGORIES].map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            aria-pressed={cat === c.id}
            className={`px-3 py-1.5 rounded-full text-xs border cursor-pointer transition-colors ${
              cat === c.id ? 'bg-[#1f1b12] text-[#e3bf5a] border-[#3a3014]' : 'text-[#a8a090] border-[#2a2622] hover:text-[#ece6d8]'
            }`}
          >
            {c.label}
            {c.id !== 'all' && countByCat(c.id) > 0 && <span className="ml-1.5 text-[#a8a090]">{countByCat(c.id)}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-[#a8a090] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <label htmlFor="rm-search" className="sr-only">Search materials</label>
          <input id="rm-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code" className="cs-input pl-9 pr-3 py-2.5" />
        </div>
        <label className="flex items-center gap-2 text-xs text-[#a8a090] cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : (
        <div className="cs-card overflow-hidden">
          {visible.length === 0 ? (
            <EmptyState
              icon={Layers}
              title={rows.length === 0 ? 'No raw materials yet' : 'Nothing matches'}
              text={
                rows.length === 0
                  ? 'Add each oil, solvent, bottle, sticker, box, pouch and wrap you buy. Purchases and production use this list.'
                  : 'Try another category or search.'
              }
              actionLabel={rows.length === 0 ? 'Add Material' : undefined}
              onAction={openAdd}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Material</th>
                    <th className="px-4 py-3 font-medium">Supplier</th>
                    <th className="px-4 py-3 font-medium text-right">On hand</th>
                    <th className="px-4 py-3 font-medium text-right">Cost in use</th>
                    <th className="px-4 py-3 font-medium text-right">Latest buy</th>
                    <th className="px-4 py-3 font-medium text-right">Value</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {visible.map((r) => {
                    const dearer = r.cost.fifo && r.cost.latest && r.cost.latest.unit > r.cost.fifo.unit + 0.00005;
                    const cheaper = r.cost.fifo && r.cost.latest && r.cost.latest.unit < r.cost.fifo.unit - 0.00005;
                    return (
                      <tr key={r.id} className={`hover:bg-[#1c1916] transition-colors ${r.is_active ? '' : 'opacity-60'}`}>
                        <td className="px-4 py-3">
                          <div>{r.name}</div>
                          <div className="text-[10px] text-[#a8a090]">
                            <span className="font-mono">{r.code}</span> · {CAT_ONE[r.category] || r.category}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">{r.suppliers?.name || <span className="text-[#a8a090]">-</span>}</td>
                        <td className="px-4 py-3 text-right font-mono">
                          {qty(r.on_hand)} <span className="text-[10px] text-[#a8a090]">{r.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {r.cost.fifo ? unitCost(r.cost.fifo.unit) : <span className="text-[#a8a090]">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {r.cost.latest ? unitCost(r.cost.latest.unit) : <span className="text-[#a8a090]">-</span>}
                          {dearer && <div className="text-[10px] text-[#e5736d]">costs more now</div>}
                          {cheaper && <div className="text-[10px] text-[#3ecf8e]">costs less now</div>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{peso(r.value)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={r.status} />
                          {r.is_active && r.reorder_level > 0 && (
                            <div className="text-[10px] text-[#a8a090] mt-1">reorder at {qty(r.reorder_level)}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button onClick={() => openEdit(r)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs mr-2" aria-label={`Edit ${r.name}`}>
                            <Pencil className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          <button onClick={() => toggleActive(r)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs" aria-label={`${r.is_active ? 'Deactivate' : 'Reactivate'} ${r.name}`}>
                            <Power className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                            <span>{r.is_active ? 'Deactivate' : 'Reactivate'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-[#a8a090] mt-3">
        Cost in use is the price of the oldest stock still on hand (what the next batch is costed at). Latest buy is the most recent purchase price.
        Oils and solvent are priced per ml.
      </p>

      {formOpen && (
        <Modal title={editing ? 'Edit Raw Material' : 'Add Raw Material'} onClose={() => setFormOpen(false)}>
          <form onSubmit={saveMaterial} className="space-y-4">
            <div>
              <label htmlFor="rm-name" className="cs-label">Name</label>
              <input id="rm-name" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Sandalwood oil, 50 ml frosted bottle" required autoFocus className="cs-input px-3.5 py-2.5" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="rm-cat" className="cs-label">Category</label>
                <select id="rm-cat" value={f.category} onChange={(e) => pickCategory(e.target.value)} disabled={locked} className="cs-input px-3 py-2.5 disabled:opacity-60">
                  {MATERIAL_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="rm-unit" className="cs-label">Unit</label>
                <input
                  id="rm-unit"
                  list="rm-units"
                  value={catInfo.fixedUnit ? 'ml' : f.unit}
                  onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))}
                  disabled={catInfo.fixedUnit || (locked && !isOwner)}
                  className="cs-input px-3 py-2.5 disabled:opacity-60"
                />
                <datalist id="rm-units">
                  {['pcs', 'roll', 'meter', 'sheet', 'pack', 'kg', 'g', 'l'].map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </div>
            </div>
            <p className="text-[11px] text-[#a8a090]">
              {catInfo.use}.{catInfo.fixedUnit ? ' Counted in ml, and priced per ml when you buy.' : ''}
              {locked ? (isOwner ? ' The category is fixed because this material already has stock history. You can still correct the unit: the quantities already recorded stay as they are and are simply read in the new unit.' : ' Category and unit are fixed because this material already has stock history. Ask the owner to correct the unit.') : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="rm-sup" className="cs-label">Usual supplier (optional)</label>
                <select id="rm-sup" value={f.supplier_id} onChange={(e) => setF((p) => ({ ...p, supplier_id: e.target.value }))} className="cs-input px-3 py-2.5">
                  <option value="">None</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              {isOwner && (
                <div>
                  <label htmlFor="rm-level" className="cs-label">Reorder level ({catInfo.fixedUnit ? 'ml' : f.unit || 'units'})</label>
                  <input id="rm-level" type="number" min="0" step="any" value={f.reorder} onChange={(e) => setF((p) => ({ ...p, reorder: e.target.value }))} placeholder="Alert when stock falls to this" className="cs-input px-3 py-2.5 text-right" />
                </div>
              )}
            </div>
            <div>
              <label htmlFor="rm-notes" className="cs-label">Notes (optional)</label>
              <input id="rm-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} className="cs-input px-3.5 py-2.5" />
            </div>
            <ErrorNote>{formError}</ErrorNote>
            <div className="pt-2 flex justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">Cancel</button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">{saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Material'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
