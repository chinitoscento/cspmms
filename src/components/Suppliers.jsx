import React, { useCallback, useEffect, useState } from 'react';
import { Truck, PlusCircle, Pencil, Search } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, Field, SelectField, ErrorNote, Modal, nz, ModalActions, STICKY_TH, STICKY_TD } from './ui';

const BLANK = {
  name: '',
  contact_person: '',
  email: '',
  phone: '',
  address: '',
  tin: '',
  payment_terms_days: '0',
  supplies: '',
  notes: '',
  status: 'Active',
};

function StatusBadge({ status }) {
  const active = status === 'Active';
  return (
    <span
      className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${
        active
          ? 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30'
          : 'bg-[#2a2622] text-[#a8a090] border-[#3a352e]'
      }`}
    >
      {status}
    </span>
  );
}

export default function Suppliers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase.from('suppliers').select('*').order('name');
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
    setFormError('');
    setEditing('new');
  };

  const openEdit = (row) => {
    setF({
      name: row.name || '',
      contact_person: row.contact_person || '',
      email: row.email || '',
      phone: row.phone || '',
      address: row.address || '',
      tin: row.tin || '',
      payment_terms_days: String(row.payment_terms_days ?? 0),
      supplies: row.supplies || '',
      notes: row.notes || '',
      status: row.status || 'Active',
    });
    setFormError('');
    setEditing(row);
  };

  const close = () => setEditing(null);

  const save = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return setFormError('Supplier name is required.');
    setSaving(true);
    setFormError('');

    const payload = {
      name: f.name.trim(),
      contact_person: nz(f.contact_person),
      email: nz(f.email),
      phone: nz(f.phone),
      address: nz(f.address),
      tin: nz(f.tin),
      payment_terms_days: Math.max(0, parseInt(f.payment_terms_days, 10) || 0),
      supplies: nz(f.supplies),
      notes: nz(f.notes),
      status: f.status,
    };

    const { error } =
      editing === 'new'
        ? await supabase.from('suppliers').insert(payload)
        : await supabase.from('suppliers').update(payload).eq('id', editing.id);

    setSaving(false);
    if (error) {
      return setFormError(error.code === '23505' ? 'A supplier with this name already exists.' : error.message);
    }
    close();
    load();
  };

  const q = query.trim().toLowerCase();
  const shown = q
    ? rows.filter((r) =>
        [r.name, r.contact_person, r.phone, r.email, r.supplies].some((v) => (v || '').toLowerCase().includes(q))
      )
    : rows;

  return (
    <div>
      <PageHeader title="Suppliers" subtitle="Sources of oils, solvent, bottles, boxes and other materials">
        <button onClick={openNew} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Add Supplier</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading suppliers...</p>
      ) : rows.length === 0 ? (
        <div className="cs-card">
          <EmptyState
            icon={Truck}
            title="No suppliers yet"
            text="Add the suppliers you buy oils, solvent and packaging from."
            actionLabel="Add Supplier"
            onAction={openNew}
          />
        </div>
      ) : (
        <div className="cs-card overflow-hidden">
          <div className="p-4 border-b border-[#2a2622] flex items-center gap-3">
            <Search className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, contact, phone, email or what they supply"
              aria-label="Search suppliers"
              className="cs-input px-3.5 py-2 text-sm flex-1"
            />
            <span className="text-xs text-[#a8a090] whitespace-nowrap">{shown.length} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                <tr>
                  <th className="px-6 py-3 font-medium">Supplier</th>
                  <th className="px-6 py-3 font-medium">Contact</th>
                  <th className="px-6 py-3 font-medium">Supplies</th>
                  <th className="px-6 py-3 font-medium">Terms</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className={`px-6 py-3 font-medium text-right ${STICKY_TH}`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                {shown.map((r) => (
                  <tr key={r.id} className="bg-[#141210] hover:bg-[#1c1916] transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium">{r.name}</div>
                      {r.tin && <div className="text-xs text-[#a8a090]">TIN {r.tin}</div>}
                    </td>
                    <td className="px-6 py-4 text-xs text-[#a8a090]">
                      <div>{r.contact_person || ''}</div>
                      <div>{r.phone || '-'}</div>
                      <div>{r.email || ''}</div>
                    </td>
                    <td className="px-6 py-4 text-xs">{r.supplies || '-'}</td>
                    <td className="px-6 py-4 text-xs text-[#a8a090]">
                      {r.payment_terms_days > 0 ? `${r.payment_terms_days} days` : 'Pay on delivery'}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={`px-6 py-4 text-right ${STICKY_TD}`}>
                      <button
                        onClick={() => openEdit(r)}
                        className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs"
                        aria-label={`Edit ${r.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Add Supplier' : 'Edit Supplier'} onClose={close}>
          <form onSubmit={save} className="space-y-4">
            <Field id="s-name" label="Supplier name" value={f.name} onChange={set('name')} required autoFocus />
            <Field
              id="s-supplies"
              label="What they supply"
              value={f.supplies}
              onChange={set('supplies')}
              placeholder="e.g. Fragrance oils, bottles, boxes"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="s-contact" label="Contact person" value={f.contact_person} onChange={set('contact_person')} />
              <Field id="s-phone" label="Phone" value={f.phone} onChange={set('phone')} />
            </div>
            <Field id="s-email" label="Email" type="email" value={f.email} onChange={set('email')} />
            <Field id="s-address" label="Address" value={f.address} onChange={set('address')} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="s-tin" label="TIN" value={f.tin} onChange={set('tin')} />
              <Field
                id="s-terms"
                label="Payment terms (days)"
                type="number"
                min="0"
                step="1"
                value={f.payment_terms_days}
                onChange={set('payment_terms_days')}
                hint="0 means pay on delivery"
              />
            </div>
            <Field id="s-notes" label="Notes" value={f.notes} onChange={set('notes')} />
            <SelectField id="s-status" label="Status" value={f.status} onChange={set('status')}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </SelectField>

            <ErrorNote>{formError}</ErrorNote>

            <ModalActions>
              <button type="button" onClick={close} className="cs-btn cs-btn-ghost px-4 py-2.5">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">
                {saving ? 'Saving...' : 'Save Supplier'}
              </button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}
