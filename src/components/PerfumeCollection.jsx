import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, PlusCircle, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, Field, SelectField, ErrorNote, Modal, ModalActions, nz, peso } from './ui';

const STATUS_TONE = {
  'Active Stock': 'text-[#3ecf8e]',
  'In Production': 'text-[#e5a93d]',
  Formulation: 'text-[#a8a090]',
  Discontinued: 'text-[#e5736d]',
};

const BLANK = {
  name: '',
  collection: 'Signature',
  gender: 'Unisex',
  bottle_style: '',
  lettering_color: '',
  liquid_color: '',
  description: '',
  status: 'Active Stock',
};

let keySeed = 0;
const newKey = () => `k${++keySeed}`;
const blankSize = () => ({ key: newKey(), id: null, size_ml: '50', price: '0', is_active: true });

export default function PerfumeCollection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | perfume row
  const [f, setF] = useState(BLANK);
  const [sizes, setSizes] = useState([blankSize()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase
      .from('perfumes')
      .select('*, perfume_sizes(*)')
      .order('created_at', { ascending: false });
    if (error) setLoadError(error.message);
    else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key) => (value) => setF((prev) => ({ ...prev, [key]: value }));

  const openNew = () => {
    setF(BLANK);
    setSizes([blankSize()]);
    setFormError('');
    setEditing('new');
  };

  const openEdit = (row) => {
    setF({
      name: row.name || '',
      collection: row.collection || '',
      gender: row.gender || 'Unisex',
      bottle_style: row.bottle_style || '',
      lettering_color: row.lettering_color || '',
      liquid_color: row.liquid_color || '',
      description: row.description || '',
      status: row.status || 'Active Stock',
    });
    const existing = [...(row.perfume_sizes || [])]
      .sort((a, b) => Number(a.size_ml) - Number(b.size_ml))
      .map((s) => ({ key: newKey(), id: s.id, size_ml: String(Number(s.size_ml)), price: String(Number(s.price)), is_active: s.is_active }));
    setSizes(existing);
    setFormError('');
    setEditing(row);
  };

  const close = () => setEditing(null);

  const updateSize = (key, patch) => setSizes((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const save = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return setFormError('Fragrance name is required.');

    const seen = new Set();
    for (const s of sizes) {
      const ml = Number(s.size_ml);
      if (!(ml > 0)) return setFormError('Every size needs an amount in ml greater than zero.');
      if (seen.has(ml)) return setFormError(`The ${ml} ml size is listed twice.`);
      seen.add(ml);
      if (Number(s.price) < 0) return setFormError('Prices cannot be negative.');
    }
    if (editing === 'new' && sizes.length === 0) return setFormError('Add at least one size.');

    setSaving(true);
    setFormError('');

    const payload = {
      name: f.name.trim().toUpperCase(),
      collection: nz(f.collection),
      gender: f.gender,
      bottle_style: nz(f.bottle_style),
      lettering_color: nz(f.lettering_color),
      liquid_color: nz(f.liquid_color),
      description: nz(f.description),
      status: f.status,
    };

    const dupMsg = 'A perfume with this name already exists.';
    let perfumeId = editing === 'new' ? null : editing.id;

    if (editing === 'new') {
      const { data, error } = await supabase.from('perfumes').insert(payload).select('id').single();
      if (error) {
        setSaving(false);
        return setFormError(error.code === '23505' ? dupMsg : error.message);
      }
      perfumeId = data.id;
    } else {
      const { error } = await supabase.from('perfumes').update(payload).eq('id', perfumeId);
      if (error) {
        setSaving(false);
        return setFormError(error.code === '23505' ? dupMsg : error.message);
      }
    }

    let sizeError = '';
    const toInsert = sizes
      .filter((s) => !s.id)
      .map((s) => ({ perfume_id: perfumeId, size_ml: Number(s.size_ml), price: Number(s.price) || 0, is_active: s.is_active }));
    if (toInsert.length) {
      const { error } = await supabase.from('perfume_sizes').insert(toInsert);
      if (error) sizeError = error.message;
    }
    for (const s of sizes.filter((x) => x.id)) {
      const { error } = await supabase
        .from('perfume_sizes')
        .update({ price: Number(s.price) || 0, is_active: s.is_active })
        .eq('id', s.id);
      if (error) sizeError = error.message;
    }

    setSaving(false);
    await load();
    if (sizeError) {
      setEditing(null);
      setLoadError(`The perfume was saved, but some sizes failed: ${sizeError}`);
      return;
    }
    close();
  };

  return (
    <div>
      <PageHeader title="Perfume Collection" subtitle="Retail line with sizes and prices">
        <button onClick={openNew} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Add Fragrance</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading collection...</p>
      ) : rows.length === 0 ? (
        <div className="cs-card">
          <EmptyState
            icon={Sparkles}
            title="No perfumes in the collection yet"
            text="Add your first fragrance to start building the perfume collection."
            actionLabel="Add Fragrance"
            onAction={openNew}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {rows.map((p) => {
            const activeSizes = [...(p.perfume_sizes || [])]
              .filter((s) => s.is_active)
              .sort((a, b) => Number(a.size_ml) - Number(b.size_ml));
            return (
              <div key={p.id} className="cs-card cs-card-hover p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase tracking-widest text-[#e3bf5a] font-semibold px-2 py-0.5 rounded bg-[#d9b24c]/10 border border-[#d9b24c]/20">
                      {p.collection || 'Uncategorized'}
                    </span>
                    <span className={`text-xs font-medium ${STATUS_TONE[p.status] || 'text-[#a8a090]'}`}>{p.status}</span>
                  </div>
                  <h3 className="font-serif text-2xl font-semibold mb-3">{p.name}</h3>
                  <dl className="space-y-1.5 text-xs text-[#a8a090] mb-4">
                    {[
                      ['Made for', p.gender],
                      ['Bottle style', p.bottle_style],
                      ['Lettering', p.lettering_color],
                      ['Liquid color', p.liquid_color],
                    ].map(([label, val]) => (
                      <div key={label} className="flex justify-between">
                        <dt>{label}</dt>
                        <dd className="text-[#ece6d8] font-medium">{val || '-'}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="space-y-1.5 mb-5">
                    {activeSizes.length === 0 ? (
                      <p className="text-xs text-[#a8a090]">No active sizes</p>
                    ) : (
                      activeSizes.map((s) => (
                        <div key={s.id} className="flex justify-between text-xs rounded-lg bg-[#1c1916] border border-[#2a2622] px-3 py-2">
                          <span>{Number(s.size_ml)} ml</span>
                          <span className="font-mono text-[#e3bf5a]">{peso(s.price)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="pt-4 border-t border-[#2a2622] flex items-center justify-between text-xs">
                  <span className="font-mono text-[#e3bf5a]">{p.sku}</span>
                  <button
                    onClick={() => openEdit(p)}
                    className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs"
                    aria-label={`Edit ${p.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Add New Signature Fragrance' : 'Edit Fragrance'} onClose={close}>
          <form onSubmit={save} className="space-y-4">
            <Field id="p-name" label="Fragrance name" value={f.name} onChange={set('name')} placeholder="e.g. DWIGHT" required autoFocus />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field id="p-collection" label="Collection" value={f.collection} onChange={set('collection')} />
              <SelectField id="p-gender" label="Made for" value={f.gender} onChange={set('gender')}>
                <option value="Men">Men</option>
                <option value="Women">Women</option>
                <option value="Unisex">Unisex</option>
              </SelectField>
              <SelectField id="p-status" label="Status" value={f.status} onChange={set('status')}>
                <option value="Active Stock">Active Stock</option>
                <option value="In Production">In Production</option>
                <option value="Formulation">Formulation</option>
                <option value="Discontinued">Discontinued</option>
              </SelectField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field id="p-bottle" label="Bottle style" value={f.bottle_style} onChange={set('bottle_style')} />
              <Field id="p-lettering" label="Lettering color" value={f.lettering_color} onChange={set('lettering_color')} />
              <Field id="p-liquid" label="Liquid color" value={f.liquid_color} onChange={set('liquid_color')} />
            </div>
            <Field id="p-desc" label="Description" value={f.description} onChange={set('description')} />

            <fieldset className="rounded-xl border border-[#2a2622] p-4 space-y-3">
              <legend className="px-2 text-xs uppercase tracking-wider text-[#e3bf5a]">Sizes and prices</legend>
              {sizes.map((s, i) => (
                <div key={s.key} className="grid grid-cols-12 gap-3 items-end">
                  <div className="col-span-4">
                    <label htmlFor={`sz-ml-${s.key}`} className="cs-label">{i === 0 ? 'Size (ml)' : <span className="sr-only">Size (ml)</span>}</label>
                    <input
                      id={`sz-ml-${s.key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={s.size_ml}
                      onChange={(e) => updateSize(s.key, { size_ml: e.target.value })}
                      disabled={!!s.id}
                      className="cs-input px-3 py-2.5"
                    />
                  </div>
                  <div className="col-span-5">
                    <label htmlFor={`sz-price-${s.key}`} className="cs-label">{i === 0 ? 'Selling price (₱)' : <span className="sr-only">Selling price</span>}</label>
                    <input
                      id={`sz-price-${s.key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={s.price}
                      onChange={(e) => updateSize(s.key, { price: e.target.value })}
                      className="cs-input px-3 py-2.5"
                    />
                  </div>
                  <div className="col-span-3 flex items-center justify-end pb-2.5">
                    {s.id ? (
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={s.is_active}
                          onChange={(e) => updateSize(s.key, { is_active: e.target.checked })}
                          className="w-4 h-4 accent-[#d9b24c]"
                        />
                        <span>Active</span>
                      </label>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSizes((prev) => prev.filter((x) => x.key !== s.key))}
                        className="text-[#a8a090] hover:text-[#e5736d] cursor-pointer"
                        aria-label="Remove this size"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSizes((prev) => [...prev, { ...blankSize(), size_ml: '' }])}
                className="cs-btn cs-btn-ghost px-3 py-2 text-xs"
              >
                <PlusCircle className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                <span>Add another size</span>
              </button>
              <p className="text-[11px] text-[#a8a090]">
                A saved size cannot be deleted or changed in ml. Untick Active to stop selling it.
              </p>
            </fieldset>

            <ModalActions error={formError}>
              <button type="button" onClick={close} className="cs-btn cs-btn-ghost px-4 py-2.5">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">
                {saving ? 'Saving...' : 'Save Fragrance'}
              </button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}
