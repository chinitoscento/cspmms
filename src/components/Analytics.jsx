import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, TrendingUp, TrendingDown, Flame, AlertTriangle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, peso } from './ui';

// ───────────── helpers ─────────────
const iso = (d) => d.toLocaleDateString('en-CA');
const todayIso = () => iso(new Date());
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
const num = (v, max = 0) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: max });
const shortDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthLabel = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

const PRESETS = [
  { id: 'last_7', label: 'Last 7 days' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'this_year', label: 'This year' },
  { id: 'custom', label: 'Custom dates' },
];

function presetRange(p) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const t = iso(now);
  switch (p) {
    case 'last_7': return [addDays(t, -6), t];
    case 'last_30': return [addDays(t, -29), t];
    case 'this_month': return [iso(new Date(y, m, 1)), t];
    case 'last_month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case 'this_quarter': return [iso(new Date(y, Math.floor(m / 3) * 3, 1)), t];
    case 'this_year': return [iso(new Date(y, 0, 1)), t];
    default: return null;
  }
}

const GENDERS = ['Men', 'Women', 'Unisex'];
const GENDER_TONE = {
  Men: 'text-[#6ea8fe] bg-[#6ea8fe]/10 border-[#6ea8fe]/30',
  Women: 'text-[#e58fb5] bg-[#e58fb5]/10 border-[#e58fb5]/30',
  Unisex: 'text-[#e3bf5a] bg-[#d9b24c]/10 border-[#d9b24c]/30',
};

function GenderBadge({ gender }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${GENDER_TONE[gender] || GENDER_TONE.Unisex}`}>
      {gender || 'Unisex'}
    </span>
  );
}

function Delta({ cur, prev }) {
  if (prev === undefined || prev === null) return null;
  if (!(prev > 0)) return <span className="text-[11px] text-[#a8a090]">{cur > 0 ? 'new vs previous' : 'no sales before'}</span>;
  const ch = ((cur - prev) / prev) * 100;
  const up = ch >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${up ? 'text-[#3ecf8e]' : 'text-[#e5736d]'}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {up ? '+' : ''}{ch.toFixed(1)}%
      <span className="text-[#a8a090] font-normal">vs previous</span>
    </span>
  );
}

function Kpi({ title, value, cur, prev, hint }) {
  return (
    <div className="cs-card p-5">
      <div className="text-[11px] font-medium text-[#a8a090] uppercase tracking-wider mb-3">{title}</div>
      <div className="font-serif text-2xl font-semibold mb-1 break-words">{value}</div>
      {prev !== undefined && prev !== null ? <Delta cur={cur} prev={prev} /> : <span className="text-[11px] text-[#a8a090]">{hint}</span>}
    </div>
  );
}

function TrendChart({ cur, prev, bucket, compare }) {
  const label = (d) => (bucket === 'month' ? monthLabel(d) : shortDate(d));
  const max = Math.max(1, ...cur.map((r) => Number(r.net)), ...(compare ? prev.map((r) => Number(r.net)) : []));
  const h = (v) => (v > 0 ? `${Math.max((v / max) * 100, 2)}%` : '0%');
  return (
    <div>
      <div className="h-44 flex items-end gap-[3px]" role="img" aria-label="Net sales over the selected period">
        {cur.map((r, i) => (
          <div key={r.bucket} className="flex-1 h-full flex items-end gap-px min-w-0" title={`${label(r.bucket)} · ${peso(r.net)} · ${r.orders} order${Number(r.orders) === 1 ? '' : 's'}`}>
            {compare && <div className="flex-1 rounded-t-sm bg-[#3a352e]" style={{ height: h(Number(prev[i]?.net || 0)) }} />}
            <div className="flex-1 rounded-t-sm bg-[#d9b24c]" style={{ height: h(Number(r.net)) }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-[#a8a090] mt-2">
        <span>{cur.length ? label(cur[0].bucket) : ''}</span>
        <span>{cur.length > 2 ? label(cur[Math.floor(cur.length / 2)].bucket) : ''}</span>
        <span>{cur.length > 1 ? label(cur[cur.length - 1].bucket) : ''}</span>
      </div>
      <div className="flex items-center gap-4 text-[11px] text-[#a8a090] mt-3">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#d9b24c]" /> This period</span>
        {compare && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#3a352e]" /> Previous period</span>}
        <span className="ml-auto">per {bucket}</span>
      </div>
    </div>
  );
}

// ───────────── fast movers: stock cover ─────────────
const stockState = (r, target) => {
  if (Number(r.on_hand) <= 0) return 'out';
  if (r.days_cover !== null && Number(r.days_cover) < target) return 'low';
  return 'ok';
};
const STATE_STYLE = {
  out: 'border-[#e5736d]/40 bg-[#e5736d]/10 text-[#e5736d]',
  low: 'border-[#e5a93d]/40 bg-[#e5a93d]/10 text-[#e5a93d]',
  ok: 'border-[#2a2622] bg-[#1c1916] text-[#a8a090]',
};

// What to do next for a size that is running low
function nextStep(r) {
  if (Number(r.bottled) > 0) return { label: 'Package', go: ['packaging', { sizeId: r.size_id }] };
  if (Number(r.juice_ml) >= Number(r.size_ml)) return { label: 'Bottle', go: ['bottling', { perfumeId: r.perfume_id }] };
  if (Number(r.macerating_ml) > 0) return { note: 'Batch is macerating' };
  return { label: 'Start batch', go: ['maceration'] };
}

function CoverPanel({ rows, target, days, onNavigate, loading }) {
  const fast = rows.filter((r) => r.is_fast && Number(r.units_sold) > 0);
  const byGender = GENDERS.map((g) => {
    const perfumes = {};
    fast.filter((r) => r.gender === g).forEach((r) => {
      if (!perfumes[r.perfume_id]) perfumes[r.perfume_id] = { id: r.perfume_id, name: r.perfume_name, rank: r.perfume_rank, units: Number(r.perfume_units), sizes: [] };
      perfumes[r.perfume_id].sizes.push(r);
    });
    return { gender: g, perfumes: Object.values(perfumes).sort((a, b) => a.rank - b.rank) };
  });

  if (loading) return <p className="text-sm text-[#a8a090]">Loading...</p>;
  if (fast.length === 0) {
    return <EmptyState icon={Flame} title="No fast movers yet" text={`Once perfumes sell in the last ${days} days, the best sellers for Men, Women and Unisex will appear here.`} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {byGender.map(({ gender, perfumes }) => (
        <div key={gender} className="rounded-xl border border-[#2a2622] bg-[#14120f] p-4">
          <div className="flex items-center justify-between mb-3">
            <GenderBadge gender={gender} />
            <span className="text-[11px] text-[#a8a090]">last {days} days</span>
          </div>
          {perfumes.length === 0 ? (
            <p className="text-xs text-[#a8a090]">No sales for this group yet.</p>
          ) : (
            <ul className="space-y-4">
              {perfumes.map((p) => (
                <li key={p.id}>
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="text-sm font-medium truncate"><span className="text-[#a8a090] font-mono text-xs mr-1.5">#{p.rank}</span>{p.name}</span>
                    <span className="text-[11px] text-[#a8a090] whitespace-nowrap">{num(p.units)} sold</span>
                  </div>
                  <div className="space-y-1.5">
                    {p.sizes.map((r) => {
                      const st = stockState(r, target);
                      const step = st === 'ok' ? null : nextStep(r);
                      return (
                        <div key={r.size_id} className={`rounded-lg border px-2.5 py-2 text-xs ${STATE_STYLE[st]}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono">{num(r.size_ml, 2)} ml</span>
                            <span>
                              {st === 'out' ? 'Out of stock' : `${num(r.on_hand)} left · ~${num(r.days_cover)} days`}
                            </span>
                          </div>
                          {st !== 'ok' && (
                            <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-[#a8a090]">
                              <span>
                                {num(r.per_day, 2)}/day
                                {Number(r.bottled) > 0 && ` · ${num(r.bottled)} bottled waiting`}
                                {Number(r.macerating_ml) > 0 && ` · ${num(r.macerating_ml)} ml macerating`}
                              </span>
                              {step?.go && onNavigate && (
                                <button onClick={() => onNavigate(...step.go)} className="cs-btn cs-btn-ghost px-2.5 py-1 text-[11px] text-[#ece6d8]">{step.label}</button>
                              )}
                              {step?.note && <span>{step.note}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

// Dashboard prompt. Usage: <FastMoverBanner onOpen={() => navigate('analytics')} />
export function FastMoverBanner({ onOpen, targetDays = 30, windowDays = 30 }) {
  const [low, setLow] = useState([]);
  useEffect(() => {
    let live = true;
    supabase.rpc('analytics_stock_cover', { p_days: windowDays, p_top: 3 }).then(({ data, error }) => {
      if (!live || error) return;
      setLow((data || []).filter((r) => r.is_fast && Number(r.units_sold) > 0 && stockState(r, targetDays) !== 'ok'));
    });
    return () => {
      live = false;
    };
  }, [targetDays, windowDays]);
  if (low.length === 0) return null;

  const groups = GENDERS.map((g) => [g, [...new Set(low.filter((r) => r.gender === g).map((r) => r.perfume_name))]]).filter(([, n]) => n.length > 0);
  const count = new Set(low.map((r) => r.perfume_id)).size;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-xl border border-[#e5736d]/40 bg-[#e5736d]/10 px-4 py-3 text-left cursor-pointer hover:bg-[#e5736d]/15 transition-colors"
    >
      <Flame className="w-5 h-5 text-[#e5736d] shrink-0" aria-hidden="true" />
      <span className="text-sm">
        <strong className="text-[#e5736d]">{count} fast-moving perfume{count === 1 ? ' is' : 's are'} running low.</strong>
        <span className="text-[#a8a090]">
          {' '}Keep these well stocked: {groups.map(([g, names]) => `${g}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`).join(' · ')}.
        </span>
      </span>
    </button>
  );
}

// ───────────── the page ─────────────
export default function Analytics({ user, onNavigate }) {
  const [preset, setPreset] = useState('this_month');
  const [from, setFrom] = useState(() => presetRange('this_month')[0]);
  const [to, setTo] = useState(() => presetRange('this_month')[1]);
  const [compare, setCompare] = useState(true);
  const [tab, setTab] = useState('perfume');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const [coverDays, setCoverDays] = useState(30);
  const [coverTarget, setCoverTarget] = useState(30);
  const [cover, setCover] = useState([]);
  const [coverLoading, setCoverLoading] = useState(true);
  const [coverError, setCoverError] = useState('');

  const [genderFilter, setGenderFilter] = useState('All');
  const [perfumeSort, setPerfumeSort] = useState('units');
  const [showQuiet, setShowQuiet] = useState(false);

  const reqId = useRef(0);

  const pickPreset = (p) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setFrom(r[0]);
      setTo(r[1]);
    }
  };

  const validRange = !!from && !!to && from <= to;
  const days = validRange ? daysBetween(from, to) + 1 : 0;
  const bucket = days <= 31 ? 'day' : days <= 150 ? 'week' : 'month';
  const prevTo = validRange ? addDays(from, -1) : '';
  const prevFrom = validRange ? addDays(from, -days) : '';

  const loadSales = useCallback(async () => {
    if (!validRange) return;
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    const a = { p_from: from, p_to: to };
    const calls = [
      supabase.rpc('analytics_sales_summary', a),
      supabase.rpc('analytics_sales_trend', { ...a, p_bucket: bucket }),
      supabase.rpc('analytics_sales_by_perfume', a),
      supabase.rpc('analytics_sales_by_customer', a),
      supabase.rpc('analytics_margin_by_perfume', a),
    ];
    if (compare) {
      const b = { p_from: prevFrom, p_to: prevTo };
      calls.push(
        supabase.rpc('analytics_sales_summary', b),
        supabase.rpc('analytics_sales_trend', { ...b, p_bucket: bucket }),
        supabase.rpc('analytics_sales_by_perfume', b)
      );
    }
    const res = await Promise.all(calls);
    if (id !== reqId.current) return; // a newer request replaced this one
    const err = res.find((r) => r.error);
    if (err) setError(err.error.message);
    setData({
      summary: res[0].data?.[0] || null,
      trend: res[1].data || [],
      perfumeRows: res[2].data || [],
      customers: res[3].data || [],
      margin: res[4].data || [],
      prevSummary: compare ? res[5]?.data?.[0] || null : null,
      prevTrend: compare ? res[6]?.data || [] : [],
      prevPerfumeRows: compare ? res[7]?.data || [] : [],
    });
    setLoading(false);
  }, [from, to, bucket, compare, prevFrom, prevTo, validRange]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const loadCover = useCallback(async () => {
    setCoverLoading(true);
    setCoverError('');
    const { data: d, error: e } = await supabase.rpc('analytics_stock_cover', { p_days: coverDays, p_top: 3 });
    if (e) setCoverError(e.message);
    setCover(d || []);
    setCoverLoading(false);
  }, [coverDays]);

  useEffect(() => {
    loadCover();
  }, [loadCover]);

  // ----- per perfume (sizes rolled up) -----
  const perfumes = useMemo(() => {
    if (!data) return [];
    const map = {};
    data.perfumeRows.forEach((r) => {
      const p = map[r.perfume_id] || (map[r.perfume_id] = { id: r.perfume_id, name: r.perfume_name, gender: r.gender, units: 0, revenue: 0, sizes: [] });
      p.units += Number(r.units);
      p.revenue += Number(r.revenue);
      // an other item (for example a Tester Kit) has no size
      p.sizes.push({ ml: r.size_ml == null ? null : Number(r.size_ml), units: Number(r.units) });
    });
    const prevUnits = {};
    data.prevPerfumeRows.forEach((r) => {
      prevUnits[r.perfume_id] = (prevUnits[r.perfume_id] || 0) + Number(r.units);
    });
    const list = Object.values(map).map((p) => ({ ...p, prevUnits: compare ? prevUnits[p.id] || 0 : null }));
    list.sort((a, b) => (perfumeSort === 'revenue' ? b.revenue - a.revenue : b.units - a.units));
    return list;
  }, [data, compare, perfumeSort]);

  const totalRevenue = perfumes.reduce((s, p) => s + p.revenue, 0);
  const shownPerfumes = genderFilter === 'All' ? perfumes : perfumes.filter((p) => p.gender === genderFilter);

  const genderCards = GENDERS.map((g) => {
    const list = perfumes.filter((p) => p.gender === g);
    return { gender: g, units: list.reduce((s, p) => s + p.units, 0), revenue: list.reduce((s, p) => s + p.revenue, 0), top: list[0] };
  });

  // ----- customers -----
  const customers = useMemo(() => {
    if (!data) return [];
    const list = data.customers.filter((c) => showQuiet || Number(c.orders) > 0 || Number(c.net) !== 0);
    return [...list].sort((a, b) => Number(b.net) - Number(a.net));
  }, [data, showQuiet]);
  const customersNet = (data?.customers || []).reduce((s, c) => s + Math.max(Number(c.net), 0), 0);

  if (user?.role !== 'owner') {
    return <EmptyState icon={BarChart3} title="Owner only" text="Sales analytics is available to the owner." />;
  }

  const s = data?.summary;
  const ps = data?.prevSummary;
  const gp = s ? Number(s.gross) - Number(s.cost) : 0;
  const pgp = ps ? Number(ps.gross) - Number(ps.cost) : null;
  const hasSales = !!s && (Number(s.orders) > 0 || Number(s.refunds) > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Sales Analytics" subtitle="Who buys, what sells and what to keep in stock. Posted sales only, less approved refunds." />

      <ErrorNote>{error}</ErrorNote>

      {/* ---- Fast movers ---- */}
      <section className="cs-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[15px] font-semibold flex items-center gap-2"><Flame className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" /> Fast movers to keep well stocked</h3>
            <p className="text-xs text-[#a8a090] mt-1">The top 3 sellers for Men, Women and Unisex. Days left = finished stock ÷ average daily sales.</p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="cv-days" className="cs-label">Sales pace from</label>
              <select id="cv-days" value={coverDays} onChange={(e) => setCoverDays(Number(e.target.value))} className="cs-input px-3 py-2 text-xs">
                {[14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cv-target" className="cs-label">Warn below</label>
              <select id="cv-target" value={coverTarget} onChange={(e) => setCoverTarget(Number(e.target.value))} className="cs-input px-3 py-2 text-xs">
                {[14, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} days of stock</option>)}
              </select>
            </div>
          </div>
        </div>
        <ErrorNote>{coverError}</ErrorNote>
        <CoverPanel rows={cover} target={coverTarget} days={coverDays} onNavigate={onNavigate} loading={coverLoading} />
        <p className="text-[11px] text-[#a8a090] mt-3 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px text-[#e5a93d]" aria-hidden="true" />
          Maceration takes weeks, so a perfume with no bottled or macerating stock behind it needs a batch started well before it runs out.
        </p>
      </section>

      {/* ---- Period ---- */}
      <section className="cs-card p-5 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="an-preset" className="cs-label">Period</label>
          <select id="an-preset" value={preset} onChange={(e) => pickPreset(e.target.value)} className="cs-input px-3 py-2.5">
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="an-from" className="cs-label">From</label>
          <input id="an-from" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} className="cs-input px-3 py-2.5" />
        </div>
        <div>
          <label htmlFor="an-to" className="cs-label">To</label>
          <input id="an-to" type="date" value={to} min={from || undefined} max={todayIso()} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} className="cs-input px-3 py-2.5" />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer pb-2.5">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="w-4 h-4 accent-[#d9b24c]" />
          <span>Compare with the previous {days || ''} days</span>
        </label>
        {validRange && compare && (
          <span className="text-xs text-[#a8a090] pb-3 ml-auto">Previous: {shortDate(prevFrom)} – {shortDate(prevTo)}</span>
        )}
      </section>
      {!validRange && <ErrorNote>Choose a start date that is not after the end date.</ErrorNote>}

      {loading && !data ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : data && !hasSales ? (
        <div className="cs-card">
          <EmptyState icon={BarChart3} title="No sales in this period" text="Pick a wider period, or record a sale. Pending credit sales count once the owner approves them." />
        </div>
      ) : data ? (
        <>
          {/* ---- KPIs ---- */}
          <section className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <Kpi title="Net sales" value={peso(s.net)} cur={Number(s.net)} prev={ps ? Number(ps.net) : null} hint="After refunds" />
            <Kpi title="Orders" value={num(s.orders)} cur={Number(s.orders)} prev={ps ? Number(ps.orders) : null} hint="Invoiced sales" />
            <Kpi title="Pieces sold" value={num(s.units)} cur={Number(s.units)} prev={ps ? Number(ps.units) : null} hint="After refunds" />
            <Kpi title="Avg order" value={peso(s.avg_order)} cur={Number(s.avg_order)} prev={ps ? Number(ps.avg_order) : null} hint="Gross ÷ orders" />
            <Kpi title="Customers" value={num(s.customers)} cur={Number(s.customers)} prev={ps ? Number(ps.customers) : null} hint="Named buyers" />
            <Kpi title="Gross profit" value={peso(gp)} cur={gp} prev={pgp} hint="Before returns" />
          </section>

          {/* ---- Trend ---- */}
          <section className="cs-card p-6">
            <h3 className="text-[15px] font-semibold mb-4">Net sales over time</h3>
            <TrendChart cur={data.trend} prev={data.prevTrend} bucket={bucket} compare={compare} />
          </section>

          {/* ---- Tabs ---- */}
          <div className="flex gap-2 border-b border-[#24201c]" role="tablist">
            {[['perfume', 'By perfume'], ['customer', 'By customer'], ['profit', 'Profitability']].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px cursor-pointer transition-colors ${tab === id ? 'border-[#d9b24c] text-[#e3bf5a]' : 'border-transparent text-[#a8a090] hover:text-[#ece6d8]'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'perfume' && (
            <section className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {genderCards.map((g) => (
                  <button key={g.gender} onClick={() => setGenderFilter(genderFilter === g.gender ? 'All' : g.gender)} className={`cs-card cs-card-hover p-4 text-left cursor-pointer ${genderFilter === g.gender ? 'ring-1 ring-[#d9b24c]' : ''}`}>
                    <div className="flex items-center justify-between mb-2"><GenderBadge gender={g.gender} /><span className="text-[11px] text-[#a8a090]">{genderFilter === g.gender ? 'Filtered' : 'Click to filter'}</span></div>
                    <div className="font-serif text-xl font-semibold">{peso(g.revenue)}</div>
                    <div className="text-xs text-[#a8a090]">{num(g.units)} pcs{g.top ? ` · top: ${g.top.name}` : ''}</div>
                  </button>
                ))}
              </div>
              <div className="cs-card overflow-hidden">
                <div className="p-4 border-b border-[#2a2622] flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-[#a8a090]">{shownPerfumes.length} perfume{shownPerfumes.length === 1 ? '' : 's'}{genderFilter !== 'All' ? ` for ${genderFilter}` : ''}</span>
                  <div className="flex items-center gap-2">
                    <label htmlFor="pf-sort" className="text-xs text-[#a8a090]">Rank by</label>
                    <select id="pf-sort" value={perfumeSort} onChange={(e) => setPerfumeSort(e.target.value)} className="cs-input px-2.5 py-1.5 text-xs">
                      <option value="units">Pieces sold</option>
                      <option value="revenue">Revenue</option>
                    </select>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                      <tr>
                        <th className="px-4 py-3 font-medium">#</th>
                        <th className="px-4 py-3 font-medium">Perfume</th>
                        <th className="px-4 py-3 font-medium">For</th>
                        <th className="px-4 py-3 font-medium text-right">Pieces</th>
                        <th className="px-4 py-3 font-medium text-right">Revenue</th>
                        <th className="px-4 py-3 font-medium text-right">Share</th>
                        {compare && <th className="px-4 py-3 font-medium text-right">Pieces vs previous</th>}
                        <th className="px-4 py-3 font-medium">Sizes sold</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#24201c]">
                      {shownPerfumes.map((p, i) => (
                        <tr key={p.id} className="hover:bg-[#1c1916] transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-[#a8a090]">{i + 1}</td>
                          <td className="px-4 py-3 font-medium">{p.name}</td>
                          <td className="px-4 py-3"><GenderBadge gender={p.gender} /></td>
                          <td className="px-4 py-3 text-right font-mono">{num(p.units)}</td>
                          <td className="px-4 py-3 text-right font-mono">{peso(p.revenue)}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-[#a8a090]">{totalRevenue > 0 ? `${((p.revenue / totalRevenue) * 100).toFixed(1)}%` : '-'}</td>
                          {compare && <td className="px-4 py-3 text-right"><Delta cur={p.units} prev={p.prevUnits} /></td>}
                          <td className="px-4 py-3 text-xs text-[#a8a090]">{[...p.sizes].sort((a, b) => (a.ml ?? 0) - (b.ml ?? 0)).map((z) => (z.ml == null ? `other item ×${num(z.units)}` : `${num(z.ml, 2)} ml ×${num(z.units)}`)).join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {perfumes.some((p) => p.gender === 'Unisex') && perfumes.filter((p) => p.gender !== 'Other').every((p) => p.gender === 'Unisex') && (
                <p className="text-xs text-[#e5a93d]">Every perfume is still set to Unisex. Open Signature Collection and set each one to Men, Women or Unisex so the groups above are meaningful.</p>
              )}
            </section>
          )}

          {tab === 'customer' && (
            <section className="cs-card overflow-hidden">
              <div className="p-4 border-b border-[#2a2622] flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-[#a8a090]">{customers.length} customer{customers.length === 1 ? '' : 's'} shown</span>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} className="w-4 h-4 accent-[#d9b24c]" />
                  <span>Include customers with no purchase in this period</span>
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                    <tr>
                      <th className="px-4 py-3 font-medium">#</th>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium text-right">Orders</th>
                      <th className="px-4 py-3 font-medium text-right">Pieces</th>
                      <th className="px-4 py-3 font-medium text-right">Refunds</th>
                      <th className="px-4 py-3 font-medium text-right">Net sales</th>
                      <th className="px-4 py-3 font-medium text-right">Share</th>
                      <th className="px-4 py-3 font-medium text-right">Avg order</th>
                      <th className="px-4 py-3 font-medium">Last purchase</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {customers.map((c, i) => {
                      const since = c.last_purchase ? daysBetween(c.last_purchase, todayIso()) : null;
                      return (
                        <tr key={c.customer_id || 'walkin'} className="hover:bg-[#1c1916] transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-[#a8a090]">{i + 1}</td>
                          <td className="px-4 py-3 font-medium">{c.customer_name}</td>
                          <td className="px-4 py-3 text-right font-mono">{num(c.orders)}</td>
                          <td className="px-4 py-3 text-right font-mono">{num(c.units)}</td>
                          <td className="px-4 py-3 text-right font-mono text-[#a8a090]">{Number(c.refunds) > 0 ? peso(c.refunds) : '-'}</td>
                          <td className="px-4 py-3 text-right font-mono">{peso(c.net)}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-[#a8a090]">{customersNet > 0 && Number(c.net) > 0 ? `${((Number(c.net) / customersNet) * 100).toFixed(1)}%` : '-'}</td>
                          <td className="px-4 py-3 text-right font-mono">{Number(c.orders) > 0 ? peso(c.avg_order) : '-'}</td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {since === null ? <span className="text-[#a8a090]">Never</span> : (
                              <>
                                <span className="text-[#a8a090]">{shortDate(c.last_purchase)}</span>{' '}
                                {since > 60 && c.customer_id && <span className="ml-1 px-2 py-0.5 rounded-full border border-[#e5a93d]/30 bg-[#e5a93d]/10 text-[#e5a93d] text-[10px]">{since} days quiet</span>}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === 'profit' && (
            <section className="cs-card overflow-hidden">
              <div className="p-4 border-b border-[#2a2622] text-xs text-[#a8a090]">Revenue less the FIFO cost of the pieces sold, before returns. Shows which perfumes actually earn money, not just which sell most.</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-b border-[#2a2622]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Perfume</th>
                      <th className="px-4 py-3 font-medium">For</th>
                      <th className="px-4 py-3 font-medium text-right">Pieces</th>
                      <th className="px-4 py-3 font-medium text-right">Revenue</th>
                      <th className="px-4 py-3 font-medium text-right">Cost</th>
                      <th className="px-4 py-3 font-medium text-right">Profit</th>
                      <th className="px-4 py-3 font-medium text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {data.margin.map((m) => (
                      <tr key={m.perfume_id} className="hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-3 font-medium">{m.perfume_name}</td>
                        <td className="px-4 py-3"><GenderBadge gender={m.gender} /></td>
                        <td className="px-4 py-3 text-right font-mono">{num(m.units)}</td>
                        <td className="px-4 py-3 text-right font-mono">{peso(m.revenue)}</td>
                        <td className="px-4 py-3 text-right font-mono text-[#a8a090]">{peso(m.cost)}</td>
                        <td className="px-4 py-3 text-right font-mono">{peso(m.profit)}</td>
                        <td className={`px-4 py-3 text-right font-mono ${Number(m.margin_pct) < 30 ? 'text-[#e5a93d]' : 'text-[#3ecf8e]'}`}>{num(m.margin_pct, 1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
