import React, { useEffect, useState } from 'react';
import { Shield, UserCheck, UserX, AlertCircle, UserPlus, RefreshCw, Copy, X } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { generateTempPassword, passwordProblem } from '../passwordRules';

const STATUS_STYLE = {
  Active: 'bg-[#3ecf8e]/10 border-[#3ecf8e]/30 text-[#3ecf8e]',
  Pending: 'bg-[#e5a93d]/10 border-[#e5a93d]/30 text-[#e5a93d]',
  Revoked: 'bg-[#f0716b]/10 border-[#f0716b]/30 text-[#f0908b]',
};

const USERNAME_RE = /^[A-Za-z0-9._]{3,30}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;
const todayStr = () => new Date().toISOString().split('T')[0];

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'N/A';

function Field({ id, label, hint, ...inputProps }) {
  return (
    <div>
      <label htmlFor={id} className="cs-label">{label}</label>
      <input id={id} className="cs-input px-3.5 py-2.5" {...inputProps} />
      {hint && <p className="text-[11px] text-[#a8a090] mt-1">{hint}</p>}
    </div>
  );
}

const emptyForm = () => ({
  firstName: '',
  lastName: '',
  username: '',
  email: '',
  contact: '',
  birthdate: '',
  role: 'user',
  password: '',
});

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null); // { name, username, password }
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, first_name, last_name, email, contact_number, role, status, date_joined, must_change_password')
      .order('date_joined', { ascending: false });

    if (error) setError(error.message);
    else setUsers(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const validate = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) return 'First and last name are required.';
    if (!USERNAME_RE.test(form.username.trim())) return 'Username must be 3-30 characters: letters, numbers, dot or underscore.';
    if (!EMAIL_RE.test(form.email.trim())) return 'Enter a valid email address.';
    if (!PHONE_RE.test(form.contact.trim())) return 'Enter a valid contact number.';
    if (!form.birthdate || form.birthdate > todayStr()) return 'Enter a valid birthdate.';
    return passwordProblem(form.password, form.username.trim());
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setError('');
    setCreated(null);

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-user', {
        body: {
          username: form.username.trim(),
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          email: form.email.trim(),
          contact_number: form.contact.trim(),
          birthdate: form.birthdate,
          role: form.role,
          password: form.password,
        },
      });

      if (fnError) {
        let message = fnError.message;
        try {
          const body = await fnError.context.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep default message */
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);

      setCreated({
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        username: form.username.trim(),
        password: form.password,
      });
      setForm(emptyForm());
      fetchUsers();
    } catch (err) {
      setError(err.message || 'Failed to create user account.');
    }
    setSaving(false);
  };

  const handleUpdateStatus = async (userId, newStatus) => {
    setError('');
    const { error } = await supabase.rpc('set_user_status', { p_user: userId, p_status: newStatus });
    if (error) setError(error.message);
    else fetchUsers();
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(created.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the password is visible on screen */
    }
  };

  if (loading) {
    return <div className="p-6 text-[#a8a090] text-sm">Loading user directory...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="pb-5 border-b border-[#2a2622]">
        <h2 className="font-serif text-3xl font-semibold">User Management &amp; Access Control</h2>
        <p className="text-sm text-[#a8a090] mt-0.5">
          Register personnel with their details, share a temporary password, and control access.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-[#f0716b]/10 border border-[#f0716b]/30 text-[#f0908b] text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {created && (
        <div role="status" className="p-4 rounded-xl bg-[#3ecf8e]/10 border border-[#3ecf8e]/30 text-sm space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[#3ecf8e]">
              Account created for {created.name}. Share these details privately. The password is shown only now, and they will be asked to replace it at first sign in.
            </p>
            <button onClick={() => setCreated(null)} aria-label="Dismiss" className="text-[#a8a090] hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-[#a8a090]">Username</span>
            <span className="font-mono text-[#ece6d8]">{created.username}</span>
            <span className="text-[#a8a090]">Temporary password</span>
            <span className="font-mono text-[#ece6d8]">{created.password}</span>
            <button onClick={copyPassword} className="cs-btn cs-btn-ghost px-2.5 py-1 text-xs">
              <Copy className="w-3 h-3" aria-hidden="true" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Add user */}
        <div className="cs-card p-6 h-fit">
          <h3 className="font-serif text-xl font-semibold text-[#e3bf5a] flex items-center gap-2 mb-5">
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            <span>Add New User Account</span>
          </h3>
          <form onSubmit={handleAddUser} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field id="um-first" label="First name" value={form.firstName} onChange={setField('firstName')} autoComplete="off" required />
              <Field id="um-last" label="Last name" value={form.lastName} onChange={setField('lastName')} autoComplete="off" required />
            </div>
            <Field
              id="um-username"
              label="Username"
              hint="Must be unique. Letters, numbers, dot or underscore."
              value={form.username}
              onChange={setField('username')}
              autoComplete="off"
              placeholder="e.g. romel.cruz"
              required
            />
            <Field id="um-email" label="Email" type="email" value={form.email} onChange={setField('email')} autoComplete="off" required />
            <Field id="um-contact" label="Contact number" type="tel" value={form.contact} onChange={setField('contact')} autoComplete="off" placeholder="09XX XXX XXXX" required />
            <div className="grid grid-cols-2 gap-3">
              <Field id="um-birth" label="Birthdate" type="date" max={todayStr()} value={form.birthdate} onChange={setField('birthdate')} required />
              <div>
                <label htmlFor="um-role" className="cs-label">Role</label>
                <select id="um-role" value={form.role} onChange={setField('role')} className="cs-input px-3.5 py-2.5">
                  <option value="user">Staff</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="um-password" className="cs-label">Temporary password</label>
              <div className="flex gap-2">
                <input
                  id="um-password"
                  type="text"
                  autoComplete="off"
                  value={form.password}
                  onChange={setField('password')}
                  className="cs-input px-3.5 py-2.5 font-mono"
                  required
                />
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, password: generateTempPassword() }))}
                  className="cs-btn cs-btn-ghost px-3 shrink-0"
                  aria-label="Generate a random password"
                  title="Generate"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <p className="text-[11px] text-[#a8a090] mt-1">They must replace it the first time they sign in.</p>
            </div>
            <button type="submit" disabled={saving} className="cs-btn cs-btn-gold w-full justify-center py-3">
              {saving ? 'Creating...' : 'Create & Authorize User'}
            </button>
          </form>
        </div>

        {/* Directory */}
        <div className="cs-card xl:col-span-2 overflow-hidden h-fit">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left border-collapse">
              <thead>
                <tr className="border-b border-[#2a2622] bg-[#1a1816] text-[11px] uppercase tracking-wider text-[#a8a090]">
                  <th className="p-4 font-medium">Person</th>
                  <th className="p-4 font-medium">Contact</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c] text-sm">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="p-8 text-center text-[#a8a090]">
                      No user accounts found in directory.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="hover:bg-[#1c1916] transition-colors align-top">
                      <td className="p-4">
                        <div className="flex items-center gap-2 font-medium">
                          <Shield
                            className={`w-3.5 h-3.5 ${u.role === 'owner' ? 'text-[#d9b24c]' : 'text-[#7a7364]'}`}
                            aria-label={u.role === 'owner' ? 'Owner' : 'Staff'}
                          />
                          <span>{u.first_name} {u.last_name}</span>
                        </div>
                        <div className="text-xs text-[#a8a090] mt-0.5">
                          @{u.username} · Joined {formatDate(u.date_joined)}
                        </div>
                      </td>
                      <td className="p-4 text-xs text-[#cfc8b8]">
                        <div>{u.email}</div>
                        <div className="text-[#a8a090] mt-0.5">{u.contact_number}</div>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium border ${STATUS_STYLE[u.status] || STATUS_STYLE.Revoked}`}>
                          {u.status}
                        </span>
                        {u.must_change_password && (
                          <div className="text-[10px] text-[#e5a93d] mt-1.5">Temporary password</div>
                        )}
                      </td>
                      <td className="p-4 text-right whitespace-nowrap space-x-2">
                        {u.role !== 'owner' && (
                          <>
                            {u.status !== 'Active' && (
                              <button
                                onClick={() => handleUpdateStatus(u.id, 'Active')}
                                className="px-3 py-1.5 rounded-lg text-xs bg-[#3ecf8e]/15 hover:bg-[#3ecf8e]/25 text-[#3ecf8e] border border-[#3ecf8e]/30 transition-colors cursor-pointer inline-flex items-center gap-1"
                              >
                                <UserCheck className="w-3 h-3" aria-hidden="true" />
                                <span>Approve</span>
                              </button>
                            )}
                            {u.status !== 'Revoked' && (
                              <button
                                onClick={() => handleUpdateStatus(u.id, 'Revoked')}
                                className="px-3 py-1.5 rounded-lg text-xs bg-[#f0716b]/15 hover:bg-[#f0716b]/25 text-[#f0908b] border border-[#f0716b]/30 transition-colors cursor-pointer inline-flex items-center gap-1"
                              >
                                <UserX className="w-3 h-3" aria-hidden="true" />
                                <span>Revoke</span>
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
