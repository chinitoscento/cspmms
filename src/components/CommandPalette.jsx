import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export default function CommandPalette({ open, onClose, items }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const choose = (item) => {
    if (!item) return;
    item.run();
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[index]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 backdrop-blur-sm px-4 pt-[15vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search or jump to"
        className="cs-card cs-pop w-full max-w-lg overflow-hidden shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 border-b border-[#2a2622]">
          <Search className="w-4 h-4 text-[#a8a090]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page or action"
            aria-label="Search pages and actions"
            className="w-full bg-transparent py-4 text-sm text-[#ece6d8] placeholder-[#7a7364] focus:outline-none"
          />
        </div>
        <ul role="listbox" className="p-2 max-h-72 overflow-y-auto">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-[#a8a090]">Nothing matches "{query}".</li>
          )}
          {results.map((item, i) => {
            const Icon = item.icon;
            const active = i === index;
            return (
              <li key={item.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => choose(item)}
                  onMouseEnter={() => setIndex(i)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm text-left cursor-pointer transition-colors ${
                    active ? 'bg-[#1f1b12] text-[#e3bf5a]' : 'text-[#ece6d8]'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    {item.name}
                  </span>
                  <span className="text-xs text-[#a8a090]">{item.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-4 py-2.5 border-t border-[#2a2622] text-[11px] text-[#a8a090] flex gap-4">
          <span>Up and down to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
