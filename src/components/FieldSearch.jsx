import React from 'react';
import { Search, X } from 'lucide-react';

// A search bar with a "Search by" dropdown. One field is searched at a time.
//   fields: [{ id, label, type: 'text' | 'date', placeholder }]
//   filter: { field, text, from, to }

export const emptyFieldFilter = (field) => ({ field, text: '', from: '', to: '' });

export const hasFieldFilter = (f) => !!(f.text.trim() || f.from || f.to);

// Partial, case-insensitive match
export const textMatch = (hay, needle) => String(hay || '').toLowerCase().includes(String(needle || '').trim().toLowerCase());

// Document numbers: accepts "12", "00000012", "PUR-12" or "PUR-00000012". Numbers match partially, so "12" also finds 112.
export const numberMatch = (input, prefix, no) => {
  const r = String(input || '').trim();
  if (!r) return true;
  const letters = r.replace(/[^a-z]/gi, '').toLowerCase();
  const digits = r.replace(/\D/g, '');
  if (letters && !String(prefix || '').toLowerCase().startsWith(letters)) return false;
  if (digits && !String(no ?? '').includes(String(Number(digits)))) return false;
  return true;
};

// Dates are ISO strings (YYYY-MM-DD), so plain string comparison orders them correctly.
export const dateMatch = (from, to, date) => {
  if (!from && !to) return true;
  const d = String(date || '').slice(0, 10);
  if (!d) return false;
  let lo = from;
  let hi = to;
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo]; // tolerate the dates being entered the wrong way round
  if (lo && d < lo) return false;
  if (hi && d > hi) return false;
  return true;
};

export default function FieldSearch({ idPrefix, fields, filter, onChange, shown, total, loadedLimit = 200 }) {
  const cur = fields.find((f) => f.id === filter.field) || fields[0];
  const active = hasFieldFilter(filter);

  return (
    <div className="px-4 py-3 border-b border-[#2a2622] bg-[#14120f]" role="search">
      <div className="grid grid-cols-1 sm:grid-cols-[13rem_1fr] gap-3 items-end">
        <div>
          <label htmlFor={`${idPrefix}-by`} className="cs-label">Search by</label>
          <select
            id={`${idPrefix}-by`}
            value={cur.id}
            onChange={(e) => onChange(emptyFieldFilter(e.target.value))}
            className="cs-input px-3 py-2.5"
          >
            {fields.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>

        {cur.type === 'date' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${idPrefix}-from`} className="cs-label">{cur.label} from</label>
              <input id={`${idPrefix}-from`} type="date" value={filter.from} onChange={(e) => onChange({ ...filter, from: e.target.value })} className="cs-input px-3 py-2.5" />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-to`} className="cs-label">{cur.label} to</label>
              <input id={`${idPrefix}-to`} type="date" value={filter.to} onChange={(e) => onChange({ ...filter, to: e.target.value })} className="cs-input px-3 py-2.5" />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor={`${idPrefix}-text`} className="cs-label">{cur.label}</label>
            <div className="relative">
              <Search className="w-4 h-4 text-[#a8a090] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                id={`${idPrefix}-text`}
                type="search"
                value={filter.text}
                onChange={(e) => onChange({ ...filter, text: e.target.value })}
                placeholder={cur.placeholder || 'Type to search'}
                className="cs-input pl-9 pr-3 py-2.5"
                autoComplete="off"
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#a8a090]" aria-live="polite">
        <span>
          Showing <span className="font-mono text-[#ece6d8]">{shown}</span> of <span className="font-mono text-[#ece6d8]">{total}</span>
          {total >= loadedLimit && <span> (search covers the {loadedLimit} most recent)</span>}
        </span>
        {active && (
          <button type="button" onClick={() => onChange(emptyFieldFilter(cur.id))} className="inline-flex items-center gap-1 text-[#e3bf5a] hover:underline cursor-pointer">
            <X className="w-3 h-3" aria-hidden="true" />
            <span>Clear search</span>
          </button>
        )}
      </div>
    </div>
  );
}
