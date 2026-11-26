import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  PlusCircle,
  CheckCircle2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Trash2,
  Search,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, Modal, nz, peso, fmtDate } from './ui';

const PAGE = 100;
const todayLocal = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const entryLabel = (n) => `JE-${String(n).padStart(8, '0')}`;
const cents = (v) => Math.round((Number(v) || 0) * 100);
const stamp = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
const posterOf = (e) => e.posted_by_name || e.posted_by_username || 'System';

let keySeed = 0;
const newLine = () => ({ key: `l${++keySeed}`, account_code: '', debit: '', credit: '', memo: '', party: '' });

// Accounts whose lines should name who they belong to: the balance of each customer (Accounts Receivable)
// and each supplier (Accounts Payable and Interest Payable) is worked out from these tags.
const PARTY_KIND = { '1100': 'customer', '2000': 'supplier', '2310': 'supplier' };

function StatusBadge({ kind }) {
  const styles = {
    Posted: 'bg-[#3ecf8e]/10 text-[#3ecf8e] border-[#3ecf8e]/30',
    Reversed: 'bg-[#e5736d]/10 text-[#e5736d] border-[#e5736d]/30',
    Reversal: 'bg-[#e5a93d]/10 text-[#e5a93d] border-[#e5a93d]/30',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${styles[kind]}`}>
      {kind === 'Posted' && <CheckCircle2 className="w-3 h-3" aria-hidden="true" />}
      <span>{kind}</span>
    </span>
  );
}

export default function Ledger({ user, onChanged }) {
  const isOwner = user?.role === 'owner';
  const [entries, setEntries] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');

  // filters
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const hasFilters = !!(search.trim() || from || to);

  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({});

  const [formOpen, setFormOpen] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([newLine(), newLine()]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [partyWarned, setPartyWarned] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');
  const [reverseError, setReverseError] = useState('');

  const fetchPage = useCallback(
    (offset) => {
      let q = supabase
        .from('journal_feed')
        .select('*', { count: 'exact' })
        .order('entry_no', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (from) q = q.gte('entry_date', from);
      if (to) q = q.lte('entry_date', to);
      const t = search.trim().replace(/[,()%*\\]/g, ' ').trim();
      if (t) {
        const parts = [`description.ilike.%${t}%`, `reference.ilike.%${t}%`];
        // accepts 8, 00000008 or JE-00000008
        const m = t.match(/^(?:je-?)?0*(\d+)$/i);
        if (m) parts.push(`entry_no.eq.${m[1]}`);
        q = q.or(parts.join(','));
      }
      return q;
    },
    [search, from, to]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { data, error, count } = await fetchPage(0);
    if (error) setLoadError(error.message);
    else {
      setEntries(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  }, [fetchPage]);

  // Reload shortly after the filters change
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    const { data, error } = await fetchPage(entries.length);
    if (error) setLoadError(error.message);
    else setEntries((prev) => [...prev, ...(data || [])]);
    setLoadingMore(false);
  };

  useEffect(() => {
    supabase
      .from('accounts')
      .select('code, name, type')
      .eq('is_active', true)
      .order('code')
      .then(({ data }) => setAccounts(data || []));
    supabase.from('customers').select('id, name').order('name').then(({ data }) => setCustomers(data || []));
    supabase.from('suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data || []));
  }, []);

  const partyName = (l) =>
    (l.customer_id && customers.find((c) => c.id === l.customer_id)?.name) ||
    (l.supplier_id && suppliers.find((x) => x.id === l.supplier_id)?.name) ||
    '';

  const clearFilters = () => {
    setSearch('');
    setFrom('');
    setTo('');
  };

  const toggle = async (id) => {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    if (!details[id]) {
      // the customer / supplier of each line is shown when the view provides it
      let res = await supabase
        .from('ledger_lines')
        .select('id, account_code, account_name, debit, credit, memo, customer_id, supplier_id')
        .eq('entry_id', id)
        .order('debit', { ascending: false });
      if (res.error) {
        res = await supabase
          .from('ledger_lines')
          .select('id, account_code, account_name, debit, credit, memo')
          .eq('entry_id', id)
          .order('debit', { ascending: false });
      }
      setDetails((prev) => ({ ...prev, [id]: res.error ? [] : res.data || [] }));
    }
  };

  // ---- Record entry ----
  const openForm = () => {
    setDate(todayLocal());
    setReference('');
    setDescription('');
    setLines([newLine(), newLine()]);
    setPartyWarned(false);
    setFormError('');
    setFormOpen(true);
  };

  const updateLine = (key, patch) => {
    setPartyWarned(false);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const totalDebit = lines.reduce((s, l) => s + cents(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + cents(l.credit), 0);
  const difference = totalDebit - totalCredit;
  const balanced = totalDebit > 0 && difference === 0;

  const post = async (e) => {
    e.preventDefault();
    if (!description.trim()) return setFormError('Description is required.');

    const used = lines.filter((l) => l.account_code || cents(l.debit) > 0 || cents(l.credit) > 0);
    if (used.some((l) => !l.account_code)) return setFormError('Choose an account for every line that has an amount.');
    if (used.some((l) => cents(l.debit) > 0 && cents(l.credit) > 0)) {
      return setFormError('A line can have a debit or a credit, not both.');
    }
    const payloadLines = used
      .filter((l) => cents(l.debit) > 0 || cents(l.credit) > 0)
      .map((l) => ({
        account_code: l.account_code,
        debit: cents(l.debit) / 100,
        credit: cents(l.credit) / 100,
        memo: nz(l.memo),
        ...(PARTY_KIND[l.account_code] === 'customer' && l.party ? { customer_id: l.party } : {}),
        ...(PARTY_KIND[l.account_code] === 'supplier' && l.party ? { supplier_id: l.party } : {}),
      }));
    if (payloadLines.length < 2) return setFormError('An entry needs at least two lines with amounts.');
    if (!balanced) return setFormError('Debits must equal credits before you can post.');

    // Receivable and payable lines should name the customer or supplier. Warn once; posting again goes ahead.
    const untagged = used.filter((l) => PARTY_KIND[l.account_code] && !l.party && (cents(l.debit) > 0 || cents(l.credit) > 0));
    if (untagged.length > 0 && !partyWarned) {
      setPartyWarned(true);
      return setFormError(
        'A line to Accounts Receivable or Accounts Payable has no customer or supplier chosen, so it will not count toward anyone\u2019s balance. Choose one, or press Post again to post without it.'
      );
    }

    setSaving(true);
    setFormError('');
    const { error } = await supabase.rpc('post_journal_entry', {
      p_date: date || todayLocal(),
      p_reference: nz(reference),
      p_description: description.trim(),
      p_lines: payloadLines,
      p_source: 'manual',
    });
    setSaving(false);
    if (error) return setFormError(error.message);
    setFormOpen(false);
    await load();
    onChanged && onChanged();
  };

  // ---- Reverse entry ----
  const openReverse = (entry) => {
    setReversing(entry);
    setReason('');
    setReverseError('');
  };

  const doReverse = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return setReverseError('Please give a reason.');
    setSaving(true);
    setReverseError('');
    const { error } = await supabase.rpc('reverse_journal_entry', { p_entry: reversing.id, p_reason: reason.trim() });
    setSaving(false);
    if (error) return setReverseError(error.message);
    setReversing(null);
    await load();
    onChanged && onChanged();
  };

  const colCount = isOwner ? 9 : 8;

  return (
    <div>
      <PageHeader title="General Journal Ledger" subtitle="Immutable double-entry transaction events">
        {isOwner && (
          <button onClick={openForm} className="cs-btn cs-btn-gold px-4 py-2.5">
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            <span>Record Journal Entry</span>
          </button>
        )}
      </PageHeader>

      <ErrorNote>{loadError}</ErrorNote>

      <div className="cs-card overflow-hidden">
        <div className="p-4 border-b border-[#2a2622] flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <BookOpen className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" />
            <span>Posted Transaction History</span>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-[#1c1916] text-[#a8a090] border border-[#2a2622]">
            {totalCount === 0
              ? 'No records found'
              : entries.length < totalCount
              ? `Showing ${entries.length} of ${totalCount}`
              : `${totalCount} records`}
          </span>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-[#2a2622] grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-6">
            <label htmlFor="jf-search" className="cs-label">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 text-[#d9b24c] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                id="jf-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Description, reference or entry number"
                className="cs-input pl-9 pr-3.5 py-2.5"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="jf-from" className="cs-label">From</label>
            <input id="jf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="cs-input px-3 py-2.5" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="jf-to" className="cs-label">To</label>
            <input id="jf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="cs-input px-3 py-2.5" />
          </div>
          <div className="md:col-span-2">
            <button type="button" onClick={clearFilters} disabled={!hasFilters} className="cs-btn cs-btn-ghost px-3 py-2.5 w-full text-xs disabled:opacity-40">
              Clear filters
            </button>
          </div>
        </div>

        {loading ? (
          <p className="p-6 text-sm text-[#a8a090]">Loading entries...</p>
        ) : entries.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={Search}
              title="No entries match"
              text="Try a different search or widen the date range."
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No journal entries yet"
              text={
                isOwner
                  ? 'Start with the owner capital: debit Cash in Bank, credit Owner’s Capital.'
                  : 'Entries will appear here once the owner or a module posts them.'
              }
              actionLabel={isOwner ? 'Record first entry' : undefined}
              onAction={openForm}
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                <tr>
                  <th className="px-4 py-3 w-8"><span className="sr-only">Details</span></th>
                  <th className="px-4 py-3 font-medium">Entry</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Posted by</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  {isOwner && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                {entries.map((en) => {
                  const kind = en.reverses_id ? 'Reversal' : en.reversed_by_no ? 'Reversed' : 'Posted';
                  const isOpen = openId === en.id;
                  return (
                    <React.Fragment key={en.id}>
                      <tr className="hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-4">
                          <button
                            onClick={() => toggle(en.id)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Hide' : 'Show'} lines of ${entryLabel(en.entry_no)}`}
                            className="text-[#a8a090] hover:text-[#e3bf5a] cursor-pointer"
                          >
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-4 font-mono text-[#e3bf5a] text-xs whitespace-nowrap">{entryLabel(en.entry_no)}</td>
                        <td className="px-4 py-4 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(en.entry_date)}</td>
                        <td className="px-4 py-4 font-mono text-xs">{en.reference || '-'}</td>
                        <td className="px-4 py-4">{en.description}</td>
                        <td className="px-4 py-4 text-xs whitespace-nowrap">
                          <div>{posterOf(en)}</div>
                          <div className="text-[#a8a090]">{stamp(en.created_at)}</div>
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge kind={kind} />
                          {kind === 'Reversed' && (
                            <div className="text-[10px] text-[#a8a090] mt-1">by {entryLabel(en.reversed_by_no)}</div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right font-mono font-medium whitespace-nowrap">{peso(en.total)}</td>
                        {isOwner && (
                          <td className="px-4 py-4 text-right">
                            {kind === 'Posted' && (
                              <button
                                onClick={() => openReverse(en)}
                                className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs"
                                aria-label={`Reverse ${entryLabel(en.entry_no)}`}
                              >
                                <RotateCcw className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                                <span>Reverse</span>
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      {isOpen && (
                        <tr className="bg-[#14120f]">
                          <td />
                          <td colSpan={colCount - 1} className="px-4 pb-4">
                            {!details[en.id] ? (
                              <p className="text-xs text-[#a8a090] py-2">Loading lines...</p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead className="text-[#a8a090]">
                                  <tr>
                                    <th className="text-left font-medium py-2">Account</th>
                                    <th className="text-right font-medium py-2">Debit</th>
                                    <th className="text-right font-medium py-2">Credit</th>
                                    <th className="text-left font-medium py-2 pl-6">Memo</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {details[en.id].map((l) => (
                                    <tr key={l.id} className="border-t border-[#24201c]">
                                      <td className={`py-2 ${Number(l.credit) > 0 ? 'pl-6' : ''}`}>
                                        <span className="font-mono text-[#a8a090] mr-2">{l.account_code}</span>
                                        {l.account_name}
                                        {partyName(l) && <span className="block text-[10px] text-[#e3bf5a]">{partyName(l)}</span>}
                                      </td>
                                      <td className="py-2 text-right font-mono">{Number(l.debit) > 0 ? peso(l.debit) : ''}</td>
                                      <td className="py-2 text-right font-mono">{Number(l.credit) > 0 ? peso(l.credit) : ''}</td>
                                      <td className="py-2 pl-6 text-[#a8a090]">{l.memo || ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {entries.length < totalCount && (
              <div className="p-4 text-center border-t border-[#24201c]">
                <button onClick={loadMore} disabled={loadingMore} className="cs-btn cs-btn-ghost px-5 py-2.5 text-xs">
                  {loadingMore ? 'Loading...' : `Load ${Math.min(PAGE, totalCount - entries.length)} more`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {formOpen && (
        <Modal title="Record Journal Entry" onClose={() => setFormOpen(false)} wide>
          <form onSubmit={post} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="je-date" className="cs-label">Date</label>
                <input id="je-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="cs-input px-3.5 py-2.5" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="je-ref" className="cs-label">Reference (optional)</label>
                <input id="je-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. OR-1001" className="cs-input px-3.5 py-2.5" />
              </div>
            </div>
            <div>
              <label htmlFor="je-desc" className="cs-label">Description</label>
              <input
                id="je-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Owner capital contribution"
                required
                autoFocus
                className="cs-input px-3.5 py-2.5"
              />
            </div>

            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-12 gap-3 text-xs uppercase tracking-wider text-[#a8a090]">
                <span className="col-span-5">Account</span>
                <span className="col-span-2 text-right">Debit</span>
                <span className="col-span-2 text-right">Credit</span>
                <span className="col-span-2">Memo</span>
                <span className="col-span-1" />
              </div>
              {lines.map((l, i) => (
                <div key={l.key} className="grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-12 sm:col-span-5">
                    <label htmlFor={`acc-${l.key}`} className="sr-only">Account for line {i + 1}</label>
                    <select
                      id={`acc-${l.key}`}
                      value={l.account_code}
                      onChange={(e) => updateLine(l.key, { account_code: e.target.value, party: '' })}
                      className="cs-input px-3 py-2.5"
                    >
                      <option value="">Select account...</option>
                      {accounts.map((a) => (
                        <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                      ))}
                    </select>
                    {PARTY_KIND[l.account_code] && (
                      <>
                        <label htmlFor={`party-${l.key}`} className="sr-only">
                          {PARTY_KIND[l.account_code] === 'customer' ? 'Customer' : 'Supplier'} for line {i + 1}
                        </label>
                        <select
                          id={`party-${l.key}`}
                          value={l.party}
                          onChange={(e) => updateLine(l.key, { party: e.target.value })}
                          className="cs-input px-3 py-2 mt-1.5 text-xs"
                        >
                          <option value="">
                            {PARTY_KIND[l.account_code] === 'customer' ? 'Customer (whose balance this is)...' : 'Supplier (whose balance this is)...'}
                          </option>
                          {(PARTY_KIND[l.account_code] === 'customer' ? customers : suppliers).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <label htmlFor={`dr-${l.key}`} className="sr-only">Debit for line {i + 1}</label>
                    <input
                      id={`dr-${l.key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={l.debit}
                      onChange={(e) => updateLine(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                      className="cs-input px-3 py-2.5 text-right"
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <label htmlFor={`cr-${l.key}`} className="sr-only">Credit for line {i + 1}</label>
                    <input
                      id={`cr-${l.key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={l.credit}
                      onChange={(e) => updateLine(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                      className="cs-input px-3 py-2.5 text-right"
                    />
                  </div>
                  <div className="col-span-10 sm:col-span-2">
                    <label htmlFor={`memo-${l.key}`} className="sr-only">Memo for line {i + 1}</label>
                    <input
                      id={`memo-${l.key}`}
                      value={l.memo}
                      onChange={(e) => updateLine(l.key, { memo: e.target.value })}
                      placeholder="Memo"
                      className="cs-input px-3 py-2.5"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-end">
                    {lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                        className="text-[#a8a090] hover:text-[#e5736d] cursor-pointer"
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setLines((prev) => [...prev, newLine()])} className="cs-btn cs-btn-ghost px-3 py-2 text-xs">
                <PlusCircle className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
                <span>Add line</span>
              </button>
            </div>

            <div className="rounded-xl border border-[#2a2622] bg-[#14120f] px-4 py-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">Total debit</div>
                <div className="font-mono">{peso(totalDebit / 100)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">Total credit</div>
                <div className="font-mono">{peso(totalCredit / 100)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#a8a090]">Difference</div>
                <div className={`font-mono ${balanced ? 'text-[#3ecf8e]' : 'text-[#e5a93d]'}`}>
                  {balanced ? 'Balanced' : peso(Math.abs(difference) / 100)}
                </div>
              </div>
            </div>

            <ErrorNote>{formError}</ErrorNote>

            <div className="pt-2 flex justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="cs-btn cs-btn-ghost px-4 py-2.5">
                Cancel
              </button>
              <button type="submit" disabled={saving || !balanced} className="cs-btn cs-btn-gold px-5 py-2.5 disabled:opacity-50">
                {saving ? 'Posting...' : 'Post Entry'}
              </button>
            </div>
            <p className="text-[11px] text-[#a8a090]">Posted entries cannot be edited or deleted. Mistakes are fixed with a reversing entry.</p>
          </form>
        </Modal>
      )}

      {reversing && (
        <Modal title={`Reverse ${entryLabel(reversing.entry_no)}`} onClose={() => setReversing(null)}>
          <form onSubmit={doReverse} className="space-y-4">
            <p className="text-sm text-[#a8a090]">
              This posts a new entry that swaps every debit and credit of &ldquo;{reversing.description}&rdquo;. The original stays in the ledger.
            </p>
            <div>
              <label htmlFor="rev-reason" className="cs-label">Reason</label>
              <input
                id="rev-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Wrong amount"
                required
                autoFocus
                className="cs-input px-3.5 py-2.5"
              />
            </div>
            <ErrorNote>{reverseError}</ErrorNote>
            <div className="pt-2 flex justify-end gap-3">
              <button type="button" onClick={() => setReversing(null)} className="cs-btn cs-btn-ghost px-4 py-2.5">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="cs-btn cs-btn-gold px-5 py-2.5">
                {saving ? 'Reversing...' : 'Post Reversal'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
