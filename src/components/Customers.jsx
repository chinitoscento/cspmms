import React, { useCallback, useEffect, useState } from 'react';
import { Users, PlusCircle, Pencil, Search } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, Field, SelectField, ErrorNote, Modal, nz, peso } from './ui';

const BLANK = {
  name: '',
  contact_person: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
  status: 'Active',
  credit_allowed: false,
  credit_limit: '0',
  credit_days: '0',
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

export default function Customers({ user }) {
  const isOwner = user?.role === 'owner';
  const [rows, setRows] = useState([]);
  const [credit, setCredit] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | customer row
  const [f, setF] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase.from('customers').select('*').order('name');
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    setRows(data || []);
    if (isOwner) {
      const { data: cr } = await supabase.from('customer_credit').select('*');
      setCredit(Object.fromEntries((cr || []).map((c) => [c.customer_id, c])));
    }
    setLoading(false);
  }, [isOwner]);

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
    const c = credit[row.id];
    setF({
      name: row.name || '',
      contact_person: row.contact_person || '',
      email: row.email || '',
      phone: row.phone || '',
      address: row.address || '',
      notes: row.notes || '',
      status: row.status || 'Active',
      credit_allowed: !!c?.credit_allowed,
      credit_limit: String(c?.credit_limit ?? 0),
      credit_days: String(c?.credit_days ?? 0),
    });
    setFormError('');
    setEditing(row);
  };

  const close = () => setEditing(null);

  const save = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return setFormError('Customer name is required.');
    setSaving(true);
    setFormError('');

    const payload = {
      name: f.name.trim(),
      contact_person: nz(f.contact_person),
      email: nz(f.email),
      phone: nz(f.phone),
      address: nz(f.address),
      notes: nz(f.notes),
      status: f.status,
    };

    let id = editing === 'new' ? null : editing.id;
    if (editing === 'new') {
      const { data, error } = await supabase.from('customers').insert(payload).select('id').single();
      if (error) {
        setSaving(false);
        return setFormError(error.code === '23505' ? 'A customer with this name already exists.' : error.message);
      }
      id = data.id;
    } else {
      const { error } = await supabase.from('customers').update(payload).eq('id', id);
      if (error) {
        setSaving(false);
        return setFormError(error.code === '23505' ? 'A customer with this name already exists.' : error.message);
      }
    }

    if (isOwner) {
      const allowed = f.credit_allowed;
      const { error } = await supabase.from('customer_credit').upsert({
        customer_id: id,
        credit_allowed: allowed,
        credit_limit: allowed ? Math.max(0, Number(f.credit_limit) || 0) : 0,
        credit_days: allowed ? Math.max(0, parseInt(f.credit_days, 10) || 0) : 0,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        setSaving(false);
        await load();
        return setFormError(`Customer saved, but credit terms failed: ${error.message}`);
      }
    }

    setSaving(false);
    close();
    load();
  };

  const q = query.trim().toLowerCase();
  const shown = q
    ? rows.filter((r) =>
        [r.name, r.contact_person, r.phone, r.email].some((v) => (v || '').toLowerCase().includes(q))
      )
    : rows;

  return (
    <div>
      <PageHeader title="Customers" subtitle="Buyers, contacts and credit terms">
        <button onClick={openNew} className="cs-btn cs-btn-gold px-4 py-2.5">
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          <span>Add Customer</span>
        </button>
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading customers...</p>
      ) : rows.length === 0 ? (
        <div className="cs-card">
          <EmptyState
            icon={Users}
            title="No customers yet"
            text="Add your first customer to start recording sales."
            actionLabel="Add Customer"
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
              placeholder="Search name, contact, phone or email"
              aria-label="Search customers"
              className="cs-input px-3.5 py-2 text-sm flex-1"
            />
            <span className="text-xs text-[#a8a090] whitespace-nowrap">{shown.length} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                <tr>
                  <th className="px-6 py-3 font-medium">Customer</th>
                  <th className="px-6 py-3 font-medium">Contact</th>
                  {isOwner && <th className="px-6 py-3 font-medium">Credit</th>}
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                {shown.map((r) => {
                  const c = credit[r.id];
                  return (
                    <tr key={r.id} className="hover:bg-[#1c1916] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium">{r.name}</div>
                        {r.contact_person && <div className="text-xs text-[#a8a090]">{r.contact_person}</div>}
                      </td>
                      <td className="px-6 py-4 text-xs text-[#a8a090]">
                        <div>{r.phone || '-'}</div>
                        <div>{r.email || ''}</div>
                      </td>
                      {isOwner && (
                        <td className="px-6 py-4 text-xs">
                          {c?.credit_allowed ? (
                            <>
                              <div className="font-mono text-[#e3bf5a]">{peso(c.credit_limit)}</div>
                              <div className="text-[#a8a090]">{c.credit_days} days</div>
                            </>
                          ) : (
                            <span className="text-[#a8a090]">Cash only</span>
                          )}
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-6 py-4 text-right">
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Add Customer' : 'Edit Customer'} onClose={close}>
          <form onSubmit={save} className="space-y-4">
            <Field id="c-name" label="Customer name" value={f.name} onChange={set('name')} required autoFocus />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="c-contact" label="Contact person" value={f.contact_person} onChange={set('contact_person')} />
              <Field id="c-phone" label="Phone" value={f.phone} onChange={set('phone')} />
            </div>
            <Field id="c-email" label="Email" type="email" value={f.email} onChange={set('email')} />
            <Field id="c-address" label="Address" value={f.address} onChange={set('address')} />
            <Field id="c-notes" label="Notes" value={f.notes} onChange={set('notes')} />
            <SelectField id="c-status" label="Status" value={f.status} onChange={set('status')}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </SelectField>

            {isOwner && (
              <fieldset className="rounded-xl border border-[#2a2622] p-4 space-y-4">
                <legend className="px-2 text-xs uppercase tracking-wider text-[#e3bf5a]">Credit terms (owner only)</legend>
                <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={f.credit_allowed}
                    onChange={(e) => set('credit_allowed')(e.target.checked)}
                    className="w-4 h-4 accent-[#d9b24c]"
                  />
                  <span>Allow credit sales to this customer</span>
                </label>
                {f.credit_allowed && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      id="c-limit"
                      label="Credit limit (₱)"
                      type="number"
                      min="0"
                      step="0.01"
                      value={f.credit_limit}
                      onChange={set('credit_limit')}
                    />
                    <Field
                      id="c-days"
                      label="Payment terms (days)"
                      type="number"
                      min="0"
                      step="1"
                      value={f.credit_days}
                      onChange={set('credit_days')}
                    />
                  </div>
                )}
              </fieldset>
            )}

            <ErrorNote>{formError}</ErrorNote>

            <div className="pt-2 flex justify-end gap-3">
              <button type="button" onClick={close} className="cs-btn cs-btn-ghost px-4 py-2.5">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">
                {saving ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
