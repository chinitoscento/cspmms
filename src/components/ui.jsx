import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export const peso = (n) =>
  '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDate = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export function EmptyState({ icon: Icon, title, text, actionLabel, onAction }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="w-12 h-12 rounded-full bg-[#1c1916] border border-[#2a2622] flex items-center justify-center mx-auto mb-4 text-[#d9b24c]">
        <Icon className="w-6 h-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-medium mb-1.5">{title}</h3>
      <p className="text-sm text-[#a8a090] max-w-sm mx-auto">{text}</p>
      {actionLabel && (
        <button onClick={onAction} className="cs-btn cs-btn-gold px-5 py-2.5 mt-5">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 mb-6 border-b border-[#2a2622] sm:sticky sm:top-20 sm:z-20 bg-[#0e0d0c] pt-4 -mt-4">
      <div>
        <h2 className="font-serif text-3xl font-semibold">{title}</h2>
        <p className="text-sm text-[#a8a090] mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function Field({ id, label, value, onChange, type = 'text', placeholder, required, autoFocus, disabled, hint, ...rest }) {
  return (
    <div>
      <label htmlFor={id} className="cs-label">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        disabled={disabled}
        className="cs-input px-3.5 py-2.5"
        {...rest}
      />
      {hint && <p className="text-[11px] text-[#a8a090] mt-1">{hint}</p>}
    </div>
  );
}

export function SelectField({ id, label, value, onChange, children, required }) {
  return (
    <div>
      <label htmlFor={id} className="cs-label">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="cs-input px-3.5 py-2.5"
      >
        {children}
      </select>
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-[#e5736d] bg-[#2a1614] border border-[#4a2420] rounded-lg px-3.5 py-2.5">
      {children}
    </p>
  );
}

// For wide tables: keeps the Actions column visible at the right edge while the rest scrolls sideways.
// The row (<tr>) needs its own background colour, which the cell then inherits.
export const STICKY_TH = 'sticky right-0 z-10 bg-[#1a1816]';
export const STICKY_TD = 'sticky right-0 z-10 bg-inherit shadow-[-14px_0_12px_-12px_rgba(0,0,0,0.7)]';

// Save / Cancel row for a form inside a Modal. Stays pinned to the bottom of the dialog while the form scrolls.
// Any error message sits inside the bar, so it is never hidden below the fold.
export function ModalActions({ error, children }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-6 -mb-5 px-6 pt-3 pb-4 bg-[#12100e] border-t border-[#2a2622] space-y-3">
      <ErrorNote>{error}</ErrorNote>
      <div className="flex justify-end gap-3">{children}</div>
    </div>
  );
}

// Page scroll is locked while any dialog is open. A counter keeps this correct if two are open at once.
let scrollLocks = 0;
let savedBodyStyle = { overflow: '', paddingRight: '' };

// dirty: pass true when the form holds something typed or picked that typing alone would not show
// (for example items tapped into a sale). Typing in any field is detected automatically.
// xl: a two-column workspace for big forms. From the lg breakpoint up the dialog has a fixed height and does not
// scroll as a whole; the form decides which of its own columns scroll. Below lg it stacks and scrolls as one page.
// split: same as xl (Collections passes this name).
export function Modal({ title, onClose, children, wide, xl: xlProp = false, split = false, dirty = false }) {
  const xl = xlProp || split;
  const dialogRef = useRef(null);
  const keepRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // always the latest onClose, without re-running the effect below on every render
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const touchedRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  confirmingRef.current = confirming;

  // Esc, the X button and a tap outside all come through here. A form with unsaved input asks first.
  const requestClose = useCallback(() => {
    if (touchedRef.current || dirtyRef.current) setConfirming(true);
    else closeRef.current();
  }, []);

  useEffect(() => {
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmingRef.current) setConfirming(false);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);

    if (scrollLocks++ === 0) {
      const gap = window.innerWidth - document.documentElement.clientWidth; // keeps the page from shifting when the scrollbar hides
      savedBodyStyle = { overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight };
      document.body.style.overflow = 'hidden';
      if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    }

    // Move focus into the dialog (unless a field already took it with autoFocus)
    if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) dialogRef.current.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      if (--scrollLocks === 0) {
        document.body.style.overflow = savedBodyStyle.overflow;
        document.body.style.paddingRight = savedBodyStyle.paddingRight;
      }
      if (opener && document.contains(opener)) opener.focus(); // give focus back to the button that opened it
    };
  }, [requestClose]);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  // Rendered into <body> so the dialog is always centred on the window itself. Inside the page layout,
  // an animated or transformed parent (like the page fade-in) makes "fixed" mean "relative to that parent".
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`cs-card cs-pop relative w-full ${xl ? 'max-w-6xl lg:h-[min(54rem,calc(100dvh-3rem))]' : wide ? 'max-w-3xl' : 'max-w-lg'} p-0 shadow-2xl flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-hidden outline-none`}
      >
        <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-[#2a2622]">
          <h3 className="font-serif text-2xl font-semibold text-[#e3bf5a]">{title}</h3>
          <button onClick={requestClose} className="-mr-2 p-2 rounded-lg text-[#a8a090] hover:text-white cursor-pointer" aria-label="Close dialog">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div
          className={xl ? 'flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5 lg:overflow-hidden lg:flex lg:flex-col lg:[&>form]:flex-1 lg:[&>form]:min-h-0 lg:[&>form>div]:min-h-0 lg:[&>form>div]:overflow-y-auto' : 'flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5'}
          onInput={(e) => {
            if (e.target.type !== 'search') touchedRef.current = true; // search boxes do not count as entered data
          }}
        >
          {children}
        </div>

        {confirming && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6">
            <div role="alertdialog" aria-modal="true" aria-label="Discard changes?" className="w-full max-w-xs rounded-xl border border-[#2a2622] bg-[#1a1816] p-5 shadow-2xl">
              <h4 className="font-serif text-xl font-semibold text-[#e3bf5a]">Discard changes?</h4>
              <p className="text-sm text-[#a8a090] mt-1.5">What you entered will not be saved.</p>
              <div className="flex justify-end gap-3 mt-5">
                <button type="button" onClick={() => closeRef.current()} className="cs-btn cs-btn-ghost px-4 py-2 text-sm">Discard</button>
                <button type="button" ref={keepRef} onClick={() => setConfirming(false)} className="cs-btn cs-btn-gold px-4 py-2 text-sm">Keep editing</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export const nz = (v) => {
  const t = (v ?? '').toString().trim();
  return t === '' ? null : t;
};
