import React from 'react';
import { Search, X } from 'lucide-react';

export const EMPTY_FILTERS = { perfume: '', run: '', from: '', to: '' };

export const hasFilters = (f) => !!(f.perfume.trim() || f.run.trim() || f.from || f.to);

/**
 * Does one row pass the current filters?
 *  perfume - perfume name on the row
 *  runNo   - the numeric batch / run number (batch_no or run_no)
 *  prefix  - the code shown before the number: 'MB', 'BT' or 'PK'
 *  date    - the row's date as YYYY-MM-DD (start_date or run_date)
 */
export function matchesFilters(f, { perfume, runNo, prefix, date }) {
  const p = f.perfume.trim().toLowerCase();
  if (p && !String(perfume || '').toLowerCase().includes(p)) return false;

  // Run / batch: accepts "12", "00000012", "MB-12" or "MB-00000012". Numbers match partially, so "12" also finds 112.
  const r = f.run.trim();
  if (r) {
    const letters = r.replace(/[^a-z]/gi, '').toLowerCase();
    const digits = r.replace(/\D/g, '');
    if (letters && !String(prefix || '').toLowerCase().startsWith(letters)) return false;
    if (digits && !String(runNo ?? '').includes(String(Number(digits)))) return false;
  }

  // Dates are ISO strings, so plain string comparison orders them correctly.
  if (f.from || f.to) {
    const d = String(date || '').slice(0, 10);
    if (!d) return false;
    let lo = f.from;
    let hi = f.to;
    if (lo && hi && lo > hi) [lo, hi] = [hi, lo]; // tolerate the dates being entered the wrong way round
    if (lo && d < lo) return false;
    if (hi && d > hi) return false;
  }
  return true;
}

export default function SearchBar({ idPrefix, filters, onChange, runLabel, runPlaceholder, dateLabel = 'Date', shown, total, loadedLimit = 100 }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const active = hasFilters(filters);

  return (
    <div className="px-4 py-3 border-b border-[#2a2622] bg-[#14120f]" role="search">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-perfume`} className="cs-label">Perfume</label>
          <div className="relative">
            <Search className="w-4 h-4 text-[#a8a090] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              id={`${idPrefix}-perfume`}
              type="search"
              value={filters.perfume}
              onChange={(e) => set({ perfume: e.target.value })}
              placeholder="Search by name"
              className="cs-input pl-9 pr-3 py-2.5"
              autoComplete="off"
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-run`} className="cs-label">{runLabel}</label>
          <input
            id={`${idPrefix}-run`}
            type="search"
            value={filters.run}
            onChange={(e) => set({ run: e.target.value })}
            placeholder={runPlaceholder}
            className="cs-input px-3 py-2.5"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-from`} className="cs-label">{dateLabel} from</label>
          <input id={`${idPrefix}-from`} type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="cs-input px-3 py-2.5" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-to`} className="cs-label">{dateLabel} to</label>
          <input id={`${idPrefix}-to`} type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="cs-input px-3 py-2.5" />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#a8a090]" aria-live="polite">
        <span>
          Showing <span className="font-mono text-[#ece6d8]">{shown}</span> of <span className="font-mono text-[#ece6d8]">{total}</span>
          {total >= loadedLimit && <span> (search covers the {loadedLimit} most recent)</span>}
        </span>
        {active && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="inline-flex items-center gap-1 text-[#e3bf5a] hover:underline cursor-pointer">
            <X className="w-3 h-3" aria-hidden="true" />
            <span>Clear search</span>
          </button>
        )}
      </div>
    </div>
  );
}
