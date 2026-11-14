import React from 'react';

// Entries dated this many days (or more) before today count as late entries.
export const LATE_AFTER_DAYS = 7;

const todayLocal = () => new Date().toLocaleDateString('en-CA');

// Whole days between the transaction date and today (positive = in the past)
export const daysLate = (iso) => {
  if (!iso) return 0;
  return Math.round((new Date(`${todayLocal()}T00:00:00`) - new Date(`${iso}T00:00:00`)) / 86400000);
};

export const isLateEntry = (iso) => daysLate(iso) >= LATE_AFTER_DAYS;

// Until the database keeps its own late-entry columns, the flag and reason travel with the notes
// so they appear on the record and in the audit trail.
export const withLateNote = (notes, iso, reason) => {
  const base = (notes || '').trim();
  if (!isLateEntry(iso)) return base || null;
  const tag = `[LATE ENTRY: recorded ${todayLocal()} for ${iso}. Reason: ${String(reason).trim()}]`;
  return base ? `${tag} ${base}` : tag;
};

// Shown under the form fields when the transaction date is well in the past
export function LateEntryNotice({ date, reason, onReason, id = 'late-reason' }) {
  if (!isLateEntry(date)) return null;
  const n = daysLate(date);
  return (
    <div className="rounded-xl border border-[#e5a93d]/40 bg-[#e5a93d]/5 px-4 py-3 space-y-2" role="group" aria-label="Late entry">
      <div className="flex items-center gap-2 text-xs text-[#e5a93d]">
        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border border-[#e5a93d]/30">Late entry</span>
        <span>This is dated {n} days ago. It is recorded on its real date and flagged as late.</span>
      </div>
      <div>
        <label htmlFor={id} className="cs-label">Why was it not recorded on the day? (required)</label>
        <input
          id={id}
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder="e.g. receipt found later, forgot to encode"
          className="cs-input px-3 py-2"
        />
      </div>
    </div>
  );
}
