import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, ErrorNote, EmptyState, peso, fmtDate } from './ui';
import { FileText, FileDown, FileSpreadsheet } from 'lucide-react';

const iso = (d) => d.toLocaleDateString('en-CA');
const today = () => iso(new Date());
const monthStart = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const money = (n) => (n < 0 ? `(${peso(-n)})` : peso(n));
const nonZero = (n) => Math.abs(n) >= 0.005;
const num = (v) => Number(v) || 0;
const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);

const TABS = [
  { id: 'tb', label: 'Trial Balance' },
  { id: 'gl', label: 'General Ledger' },
  { id: 'is', label: 'Income Statement' },
  { id: 'bs', label: 'Balance Sheet' },
];

function Section({ title, rows, totalLabel, total }) {
  return (
    <div className="mb-6">
      <h4 className="text-xs uppercase tracking-wider text-[#e3bf5a] mb-2">{title}</h4>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="py-1.5 text-[#a8a090] text-xs">None</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.code}>
              <td className="py-1.5">
                <span className="font-mono text-xs text-[#a8a090] mr-3">{r.code}</span>
                {r.name}
              </td>
              <td className="py-1.5 text-right font-mono">{money(r.amount)}</td>
            </tr>
          ))}
          {totalLabel && (
            <tr className="border-t border-[#2a2622]">
              <td className="pt-2 font-medium">{totalLabel}</td>
              <td className="pt-2 text-right font-mono font-medium">{money(total)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Bar({ label, value, strong }) {
  return (
    <div className={`flex justify-between py-2.5 px-4 rounded-lg bg-[#1c1916] border border-[#2a2622] mb-6 ${strong ? 'text-[#e3bf5a]' : ''}`}>
      <span className="font-medium">{label}</span>
      <span className="font-mono font-semibold">{money(value)}</span>
    </div>
  );
}

export default function Reports({ user }) {
  const [tab, setTab] = useState('tb');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState('');
  const [tb, setTb] = useState([]);
  const [movement, setMovement] = useState([]);
  const [gl, setGl] = useState({ opening: 0, rows: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');

  useEffect(() => {
    supabase
      .from('accounts')
      .select('code, name, type')
      .order('code')
      .then(({ data }) => {
        const list = data || [];
        setAccounts(list);
        setAccount((cur) => cur || (list.find((a) => a.code === '1020') ? '1020' : list[0]?.code || ''));
      });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        if (tab === 'tb' || tab === 'bs') {
          const { data, error: e } = await supabase.rpc('trial_balance', { p_to: to || today() });
          if (e) throw e;
          if (alive) setTb(data || []);
        } else if (tab === 'is') {
          const { data, error: e } = await supabase.rpc('period_movement', { p_from: from || null, p_to: to || null });
          if (e) throw e;
          if (alive) setMovement(data || []);
        } else if (tab === 'gl' && account) {
          const [op, rows] = await Promise.all([
            supabase.rpc('account_opening', { p_code: account, p_from: from || null }),
            supabase.rpc('account_ledger', { p_code: account, p_from: from || null, p_to: to || null }),
          ]);
          if (op.error) throw op.error;
          if (rows.error) throw rows.error;
          if (alive) setGl({ opening: num(op.data), rows: rows.data || [] });
        }
      } catch (e) {
        if (alive) setError(e.message || 'Could not load the report.');
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [tab, from, to, account]);

  const usesFrom = tab === 'is' || tab === 'gl';

  // ---- Trial balance ----
  const tbRows = useMemo(
    () => tb.map((r) => ({ ...r, debit: num(r.debit), credit: num(r.credit) })).filter((r) => nonZero(r.debit) || nonZero(r.credit)),
    [tb]
  );
  const tbDebit = tbRows.reduce((s, r) => s + r.debit, 0);
  const tbCredit = tbRows.reduce((s, r) => s + r.credit, 0);

  // ---- Income statement ----
  const is = useMemo(() => {
    const rows = movement.map((r) => ({
      ...r,
      amount: r.type === 'revenue' ? num(r.credit) - num(r.debit) : num(r.debit) - num(r.credit),
    }));
    const revenue = rows.filter((r) => r.type === 'revenue' && nonZero(r.amount));
    const cogs = rows.filter((r) => r.type === 'expense' && (r.code.startsWith('50') || r.code.startsWith('51')) && nonZero(r.amount));
    const opex = rows.filter((r) => r.type === 'expense' && !(r.code.startsWith('50') || r.code.startsWith('51')) && nonZero(r.amount));
    const netSales = sum(revenue);
    const cogsTotal = sum(cogs);
    const gross = netSales - cogsTotal;
    const opexTotal = sum(opex);
    return { revenue, cogs, opex, netSales, cogsTotal, gross, opexTotal, net: gross - opexTotal };
  }, [movement]);

  // ---- Balance sheet ----
  const bs = useMemo(() => {
    const rows = tb.map((r) => ({ ...r, net: num(r.debit) - num(r.credit) }));
    const assets = rows.filter((r) => r.type === 'asset' && nonZero(r.net)).map((r) => ({ ...r, amount: r.net }));
    const liabilities = rows.filter((r) => r.type === 'liability' && nonZero(r.net)).map((r) => ({ ...r, amount: -r.net }));
    const equity = rows.filter((r) => r.type === 'equity' && nonZero(r.net)).map((r) => ({ ...r, amount: -r.net }));
    const earnings = -rows.filter((r) => r.type === 'revenue' || r.type === 'expense').reduce((s, r) => s + r.net, 0);
    const totalAssets = sum(assets);
    const totalLiab = sum(liabilities);
    const totalEquity = sum(equity) + earnings;
    return { assets, liabilities, equity, earnings, totalAssets, totalLiab, totalEquity };
  }, [tb]);

  const presets = [
    { label: 'This month', run: () => { setFrom(monthStart()); setTo(today()); } },
    { label: 'This year', run: () => { setFrom(yearStart()); setTo(today()); } },
    { label: 'All time', run: () => { setFrom(''); setTo(today()); } },
  ];

  const periodText = usesFrom
    ? `${from ? fmtDate(from) : 'Beginning'} to ${to ? fmtDate(to) : 'today'}`
    : `As of ${fmtDate(to || today())}`;

  // ---- Export (PDF / Excel) ----
  const preparedBy = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || '';
  const hasData = tab === 'is' ? movement.length > 0 : tab === 'gl' ? true : tbRows.length > 0;

  const buildDoc = () => {
    const title = TABS.find((t) => t.id === tab).label;
    const base = { title, subtitle: periodText, preparedBy };
    const lines = (arr) => arr.map((r) => ({ kind: 'row', cells: [r.code, r.name, r.amount] }));
    const statementCols = [
      { header: 'Code', width: 10 },
      { header: 'Description', width: 56 },
      { header: 'Amount', align: 'right', width: 22 },
    ];

    if (tab === 'tb') {
      const balanced = Math.abs(tbDebit - tbCredit) < 0.005;
      return {
        ...base,
        columns: [
          { header: 'Code', width: 10 },
          { header: 'Account', width: 46 },
          { header: 'Debit', align: 'right', width: 20 },
          { header: 'Credit', align: 'right', width: 20 },
        ],
        rows: [
          ...tbRows.map((r) => ({ kind: 'row', cells: [r.code, r.name, r.debit > 0 ? r.debit : '', r.credit > 0 ? r.credit : ''] })),
          { kind: 'grand', cells: ['', 'Totals', tbDebit, tbCredit] },
          { kind: 'note', cells: [balanced ? 'Debits equal credits.' : 'Debits and credits do not match. Please check the ledger.'] },
        ],
      };
    }

    if (tab === 'gl') {
      const acc = accounts.find((a) => a.code === account);
      const ending = gl.rows.length ? num(gl.rows[gl.rows.length - 1].balance) : gl.opening;
      return {
        ...base,
        title: `General Ledger - ${acc ? acc.name : account}`,
        subtitle: `${acc ? `${acc.code} ${acc.name}` : account}  |  ${periodText}`,
        landscape: true,
        columns: [
          { header: 'Date', width: 14 },
          { header: 'Entry', width: 10 },
          { header: 'Description', width: 46 },
          { header: 'Debit', align: 'right', width: 18 },
          { header: 'Credit', align: 'right', width: 18 },
          { header: 'Balance', align: 'right', width: 20 },
        ],
        rows: [
          { kind: 'row', cells: ['', '', 'Opening balance', '', '', gl.opening] },
          ...gl.rows.map((r) => ({
            kind: 'row',
            cells: [
              fmtDate(r.line_date),
              `JE-${String(r.entry_no).padStart(4, '0')}`,
              r.memo ? `${r.description} (${r.memo})` : r.description,
              num(r.debit) > 0 ? num(r.debit) : '',
              num(r.credit) > 0 ? num(r.credit) : '',
              num(r.balance),
            ],
          })),
          { kind: 'grand', cells: ['', '', 'Ending balance', '', '', ending] },
        ],
      };
    }

    if (tab === 'is') {
      return {
        ...base,
        columns: statementCols,
        rows: [
          { kind: 'section', cells: ['Revenue'] },
          ...lines(is.revenue),
          { kind: 'total', cells: ['', 'Net sales', is.netSales] },
          { kind: 'section', cells: ['Cost of goods sold'] },
          ...lines(is.cogs),
          { kind: 'total', cells: ['', 'Total cost of goods sold', is.cogsTotal] },
          { kind: 'grand', cells: ['', 'Gross profit', is.gross] },
          { kind: 'section', cells: ['Operating expenses'] },
          ...lines(is.opex),
          { kind: 'total', cells: ['', 'Total operating expenses', is.opexTotal] },
          { kind: 'grand', cells: ['', 'Net income (loss)', is.net] },
          { kind: 'note', cells: ['Income tax and percentage tax appear here only once they are posted to the ledger.'] },
        ],
      };
    }

    const balanced = Math.abs(bs.totalAssets - (bs.totalLiab + bs.totalEquity)) < 0.005;
    return {
      ...base,
      columns: statementCols,
      rows: [
        { kind: 'section', cells: ['Assets'] },
        ...lines(bs.assets),
        { kind: 'total', cells: ['', 'Total assets', bs.totalAssets] },
        { kind: 'section', cells: ['Liabilities'] },
        ...lines(bs.liabilities),
        { kind: 'total', cells: ['', 'Total liabilities', bs.totalLiab] },
        { kind: 'section', cells: ["Owner's equity"] },
        ...lines(bs.equity),
        { kind: 'row', cells: ['', 'Net income (loss) to date', bs.earnings] },
        { kind: 'total', cells: ['', "Total owner's equity", bs.totalEquity] },
        { kind: 'grand', cells: ['', 'Total liabilities and equity', bs.totalLiab + bs.totalEquity] },
        { kind: 'note', cells: [balanced ? 'Assets equal liabilities plus equity.' : 'Assets do not equal liabilities plus equity. Please check the ledger.'] },
      ],
    };
  };

  const runExport = async (type) => {
    setExporting(type);
    setError('');
    try {
      const doc = buildDoc();
      const mod = await import('../reportExport');
      if (type === 'pdf') await mod.exportPdf(doc);
      else await mod.exportExcel(doc);
    } catch (e) {
      setError(`Could not create the ${type === 'pdf' ? 'PDF' : 'Excel'} file: ${e.message || e}`);
    }
    setExporting('');
  };

  return (
    <div>
      <PageHeader title="Accounting Reports" subtitle="Read straight from the immutable ledger">
        <span className="text-xs px-2.5 py-1 rounded-full bg-[#1c1916] text-[#a8a090] border border-[#2a2622]">Owner only</span>
      </PageHeader>

      <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border cursor-pointer transition-colors ${
              tab === t.id
                ? 'bg-[#1f1b12] text-[#e3bf5a] border-[#3a3014]'
                : 'text-[#a8a090] border-[#2a2622] hover:bg-[#1a1816] hover:text-[#ece6d8]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="cs-card p-4 mb-5 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        {tab === 'gl' && (
          <div className="md:col-span-4">
            <label htmlFor="rp-account" className="cs-label">Account</label>
            <select id="rp-account" value={account} onChange={(e) => setAccount(e.target.value)} className="cs-input px-3 py-2.5">
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
        )}
        {usesFrom && (
          <div className="md:col-span-2">
            <label htmlFor="rp-from" className="cs-label">From</label>
            <input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="cs-input px-3 py-2.5" />
          </div>
        )}
        <div className="md:col-span-2">
          <label htmlFor="rp-to" className="cs-label">{usesFrom ? 'To' : 'As of'}</label>
          <input id="rp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="cs-input px-3 py-2.5" />
        </div>
        {usesFrom && (
          <div className="md:col-span-4 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.label} type="button" onClick={p.run} className="cs-btn cs-btn-ghost px-3 py-2.5 text-xs">
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <ErrorNote>{error}</ErrorNote>

      <div className="cs-card p-6">
        <div className="pb-4 mb-5 border-b border-[#2a2622] flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h3 className="font-serif text-2xl font-semibold">{TABS.find((t) => t.id === tab).label}</h3>
            <p className="text-xs text-[#a8a090] mt-0.5">Chinito Scento · {periodText}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => runExport('pdf')}
              disabled={loading || !hasData || !!exporting}
              className="cs-btn cs-btn-ghost px-3.5 py-2 text-xs disabled:opacity-40"
            >
              <FileDown className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
              <span>{exporting === 'pdf' ? 'Creating PDF...' : 'Export PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => runExport('xlsx')}
              disabled={loading || !hasData || !!exporting}
              className="cs-btn cs-btn-ghost px-3.5 py-2 text-xs disabled:opacity-40"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
              <span>{exporting === 'xlsx' ? 'Creating Excel...' : 'Export Excel'}</span>
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-[#a8a090]">Loading report...</p>
        ) : tab === 'tb' ? (
          tbRows.length === 0 ? (
            <EmptyState icon={FileText} title="Nothing to show" text="No account has a balance as of this date." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                  <tr>
                    <th className="text-left font-medium py-2">Account</th>
                    <th className="text-right font-medium py-2">Debit</th>
                    <th className="text-right font-medium py-2">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#24201c]">
                  {tbRows.map((r) => (
                    <tr key={r.code}>
                      <td className="py-2">
                        <span className="font-mono text-xs text-[#a8a090] mr-3">{r.code}</span>
                        {r.name}
                      </td>
                      <td className="py-2 text-right font-mono">{r.debit > 0 ? peso(r.debit) : ''}</td>
                      <td className="py-2 text-right font-mono">{r.credit > 0 ? peso(r.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#3a352e] font-semibold">
                    <td className="pt-3">
                      Totals{' '}
                      <span className={`ml-2 text-xs font-medium ${Math.abs(tbDebit - tbCredit) < 0.005 ? 'text-[#3ecf8e]' : 'text-[#e5736d]'}`}>
                        {Math.abs(tbDebit - tbCredit) < 0.005 ? 'Balanced' : 'Out of balance'}
                      </span>
                    </td>
                    <td className="pt-3 text-right font-mono">{peso(tbDebit)}</td>
                    <td className="pt-3 text-right font-mono">{peso(tbCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : tab === 'gl' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                <tr>
                  <th className="text-left font-medium py-2">Date</th>
                  <th className="text-left font-medium py-2">Entry</th>
                  <th className="text-left font-medium py-2">Description</th>
                  <th className="text-right font-medium py-2">Debit</th>
                  <th className="text-right font-medium py-2">Credit</th>
                  <th className="text-right font-medium py-2">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24201c]">
                <tr className="text-[#a8a090]">
                  <td className="py-2" colSpan={5}>Opening balance</td>
                  <td className="py-2 text-right font-mono">{money(gl.opening)}</td>
                </tr>
                {gl.rows.map((r, i) => (
                  <tr key={`${r.entry_id}-${i}`}>
                    <td className="py-2 text-xs text-[#a8a090] whitespace-nowrap">{fmtDate(r.line_date)}</td>
                    <td className="py-2 font-mono text-xs text-[#e3bf5a]">JE-{String(r.entry_no).padStart(4, '0')}</td>
                    <td className="py-2">
                      {r.description}
                      {r.memo && <span className="block text-xs text-[#a8a090]">{r.memo}</span>}
                    </td>
                    <td className="py-2 text-right font-mono">{num(r.debit) > 0 ? peso(r.debit) : ''}</td>
                    <td className="py-2 text-right font-mono">{num(r.credit) > 0 ? peso(r.credit) : ''}</td>
                    <td className="py-2 text-right font-mono">{money(num(r.balance))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#3a352e] font-semibold">
                  <td className="pt-3" colSpan={5}>Ending balance</td>
                  <td className="pt-3 text-right font-mono">
                    {money(gl.rows.length ? num(gl.rows[gl.rows.length - 1].balance) : gl.opening)}
                  </td>
                </tr>
              </tfoot>
            </table>
            {gl.rows.length === 0 && <p className="text-xs text-[#a8a090] mt-3">No movement in this period.</p>}
          </div>
        ) : tab === 'is' ? (
          movement.length === 0 ? (
            <EmptyState icon={FileText} title="Nothing to show" text="No sales or expenses were posted in this period." />
          ) : (
            <div>
              <Section title="Revenue" rows={is.revenue} totalLabel="Net sales" total={is.netSales} />
              <Section title="Cost of goods sold" rows={is.cogs} totalLabel="Total cost of goods sold" total={is.cogsTotal} />
              <Bar label="Gross profit" value={is.gross} />
              <Section title="Operating expenses" rows={is.opex} totalLabel="Total operating expenses" total={is.opexTotal} />
              <Bar label="Net income (loss)" value={is.net} strong />
              <p className="text-[11px] text-[#a8a090]">
                Income tax and percentage tax appear here only once they are posted to the ledger.
              </p>
            </div>
          )
        ) : tbRows.length === 0 ? (
          <EmptyState icon={FileText} title="Nothing to show" text="No account has a balance as of this date." />
        ) : (
          <div>
            <Section title="Assets" rows={bs.assets} totalLabel="Total assets" total={bs.totalAssets} />
            <Section title="Liabilities" rows={bs.liabilities} totalLabel="Total liabilities" total={bs.totalLiab} />
            <div className="mb-6">
              <h4 className="text-xs uppercase tracking-wider text-[#e3bf5a] mb-2">Owner&rsquo;s equity</h4>
              <table className="w-full text-sm">
                <tbody>
                  {bs.equity.map((r) => (
                    <tr key={r.code}>
                      <td className="py-1.5">
                        <span className="font-mono text-xs text-[#a8a090] mr-3">{r.code}</span>
                        {r.name}
                      </td>
                      <td className="py-1.5 text-right font-mono">{money(r.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5">Net income (loss) to date</td>
                    <td className="py-1.5 text-right font-mono">{money(bs.earnings)}</td>
                  </tr>
                  <tr className="border-t border-[#2a2622]">
                    <td className="pt-2 font-medium">Total owner&rsquo;s equity</td>
                    <td className="pt-2 text-right font-mono font-medium">{money(bs.totalEquity)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Bar label="Total liabilities and equity" value={bs.totalLiab + bs.totalEquity} strong />
            <p className={`text-xs ${Math.abs(bs.totalAssets - (bs.totalLiab + bs.totalEquity)) < 0.005 ? 'text-[#3ecf8e]' : 'text-[#e5736d]'}`}>
              {Math.abs(bs.totalAssets - (bs.totalLiab + bs.totalEquity)) < 0.005
                ? 'Assets equal liabilities plus equity.'
                : 'Assets do not equal liabilities plus equity. Please check the ledger.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
