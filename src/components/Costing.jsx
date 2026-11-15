import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, peso, fmtDate } from './ui';

const pad = (n) => String(n).padStart(4, '0');
const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const money4 = (v) =>
  v == null ? '-' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v));
const num = (v) => (v == null ? null : Number(v));
const pct = (v) => `${(v * 100).toFixed(1)}%`;

// A piece whose latest cost is this far above its own average is flagged as rising
const RISE_ALERT = 0.05;

const CATEGORY = {
  oil: 'Oil',
  solvent: 'Solvent',
  bottle: 'Bottle',
  bottle_sticker: 'Bottle sticker',
  box: 'Box',
  box_sticker: 'Box sticker',
  wrap: 'Wrap',
};

function Stat({ label, value, sub, tone }) {
  return (
    <div className="cs-card p-5">
      <div className="text-[11px] font-medium text-[#a8a090] uppercase tracking-wider mb-2">{label}</div>
      <div className={`font-serif text-xl xl:text-2xl font-semibold break-words ${tone || ''}`}>{value}</div>
      {sub && <div className="text-xs text-[#a8a090] mt-1">{sub}</div>}
    </div>
  );
}

function Th({ children, right }) {
  return <th className={`px-4 py-3 font-medium ${right ? 'text-right' : ''}`}>{children}</th>;
}

// Change in a cost: up is bad (red), down is good (green)
function Delta({ v }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-[#a8a090]">-</span>;
  if (Math.abs(v) < 0.0005) return <span className="text-[#a8a090]">no change</span>;
  const up = v > 0;
  return <span className={up ? 'text-[#e5736d]' : 'text-[#3ecf8e]'}>{up ? '▲' : '▼'} {Math.abs(v * 100).toFixed(1)}%</span>;
}

const change = (latest, avg) => (latest != null && Number(avg) > 0 ? (Number(latest) - Number(avg)) / Number(avg) : null);

export default function Costing({ user }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [juice, setJuice] = useState([]);
  const [stock, setStock] = useState([]); // finished goods on hand, one row per perfume size

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [p, m, j, inv] = await Promise.all([
      supabase.rpc('costing_products'),
      supabase.rpc('costing_materials'),
      supabase.rpc('costing_juice'),
      supabase.from('inventory_status').select('*').eq('kind', 'finished'),
    ]);
    const err = [p, m, j, inv].find((r) => r.error);
    if (err) setError(err.error.message);
    setProducts(p.data || []);
    setMaterials(m.data || []);
    setJuice(j.data || []);
    setStock(inv.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  const rows = useMemo(() => {
    const stockBySize = Object.fromEntries(stock.map((s) => [s.item_id, s]));
    return products
      .map((r) => {
        const high = num(r.high_unit_cost);
        const price = num(r.price);
        const current = num(r.last_unit_cost); // what the most recent packaging run cost per piece
        const avg = num(r.avg_unit_cost);
        const margin = high != null && price > 0 ? price - high : null;
        const income = current != null && price > 0 ? price - current : null;
        const st = stockBySize[r.size_id];
        const onHand = Number(st?.on_hand || 0);
        const stockValue = Number(st?.value || 0);
        const sales = price > 0 ? onHand * price : null;
        return {
          ...r,
          high,
          price,
          current,
          avg,
          margin,
          marginPct: margin != null ? margin / price : null,
          income,
          incomePct: income != null ? income / price : null,
          drift: change(current, avg),
          onHand,
          stockValue,
          sales,
          stockIncome: sales != null ? sales - stockValue : null,
        };
      })
      .sort((a, b) => (b.high ?? -1) - (a.high ?? -1) || a.perfume_name.localeCompare(b.perfume_name));
  }, [products, stock]);

  // Thinnest margin at the current cost first, so the perfumes needing attention are on top.
  // Sizes with no price or never packaged go last.
  const standing = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const am = a.incomePct == null ? Infinity : a.incomePct;
        const bm = b.incomePct == null ? Infinity : b.incomePct;
        return am - bm || a.perfume_name.localeCompare(b.perfume_name);
      }),
    [rows]
  );

  const totals = useMemo(() => {
    const priced = rows.filter((r) => r.sales != null);
    const stockValue = stock.reduce((s, r) => s + Number(r.value || 0), 0);
    const sales = priced.reduce((s, r) => s + r.sales, 0);
    const pricedValue = priced.reduce((s, r) => s + r.stockValue, 0);
    const income = sales - pricedValue;
    const below = rows.filter((r) => r.income != null && r.income < 0);
    const rising = rows.filter((r) => r.drift != null && r.drift >= RISE_ALERT);
    return { stockValue, sales, pricedValue, income, incomePct: sales > 0 ? income / sales : null, below: below.length, rising: rising.length, attention: new Set([...below, ...rising].map((r) => r.size_id)).size };
  }, [rows, stock]);

  const label = (r) => `${r.perfume_name} · ${qty(r.size_ml)} ml`;
  const juiceRows = juice.filter((j) => j.batches > 0).sort((a, b) => Number(b.high_per_ml) - Number(a.high_per_ml));

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Costing" subtitle="Cost to produce one piece" />
        <p className="text-sm text-[#a8a090]">Only the owner can see costing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Costing" subtitle="Where each perfume stands today: current cost, selling price and income" />
      <ErrorNote>{error}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Stat label="Stock value at cost" value={peso(totals.stockValue)} sub="Finished perfume on hand, at what it cost to make" />
            <Stat label="Sales value of stock" value={peso(totals.sales)} sub="If everything on hand sold at the current selling prices" />
            <Stat
              label="Expected income on stock"
              value={peso(totals.income)}
              tone={totals.income < 0 ? 'text-[#e5736d]' : ''}
              sub={totals.incomePct != null ? `${pct(totals.incomePct)} of sales value` : 'Needs prices and stock on hand'}
            />
            <Stat
              label="Needs attention"
              value={String(totals.attention)}
              tone={totals.attention > 0 ? 'text-[#e5a93d]' : ''}
              sub={`${totals.below} selling below cost · ${totals.rising} with cost up ${Math.round(RISE_ALERT * 100)}%+`}
            />
          </section>

          <section className="cs-card overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-[15px] font-semibold">Standing at current cost</h3>
              <p className="text-xs text-[#a8a090] mt-1">
                Current cost is what the most recent packaging run cost per piece. Income per piece is the selling price less that cost. The change against
                average shows whether cost is moving up or down. Thinnest margins are listed first. Costs follow oldest-stock-first, so they trail
                purchase prices a little; the material tables below show the price movement itself.
              </p>
            </div>
            {standing.length === 0 ? (
              <EmptyState icon={Calculator} title="Nothing to assess yet" text="Costs appear once perfume has been packaged." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-y border-[#2a2622]">
                    <tr>
                      <Th>Product</Th>
                      <Th right>Selling price</Th>
                      <Th right>Current cost</Th>
                      <Th right>Change vs average</Th>
                      <Th right>Income per piece</Th>
                      <Th right>Margin</Th>
                      <Th right>On hand</Th>
                      <Th right>Stock value</Th>
                      <Th right>Income on stock</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {standing.map((r) => (
                      <tr key={r.size_id} className="hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-3">{label(r)}</td>
                        <td className="px-4 py-3 text-right font-mono">{r.price > 0 ? peso(r.price) : <span className="text-[#a8a090]">no price</span>}</td>
                        {r.current == null ? (
                          <td colSpan={7} className="px-4 py-3 text-xs text-[#a8a090]">Not packaged yet</td>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-right font-mono text-[#e3bf5a]">
                              {peso(r.current)}
                              <div className="text-[10px] text-[#a8a090]">{fmtDate(r.last_run_date)}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              <Delta v={r.drift} />
                              <div className="text-[10px] text-[#a8a090]">avg {peso(r.avg)}</div>
                            </td>
                            <td className={`px-4 py-3 text-right font-mono ${r.income != null && r.income < 0 ? 'text-[#e5736d]' : r.income != null ? 'text-[#3ecf8e]' : ''}`}>
                              {r.income == null ? '-' : peso(r.income)}
                            </td>
                            <td className={`px-4 py-3 text-right font-mono text-xs ${r.incomePct != null && r.incomePct < 0 ? 'text-[#e5736d]' : ''}`}>
                              {r.incomePct == null ? '-' : pct(r.incomePct)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{qty(r.onHand)} pcs</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{peso(r.stockValue)}</td>
                            <td className={`px-4 py-3 text-right font-mono text-xs ${r.stockIncome != null && r.stockIncome < 0 ? 'text-[#e5736d]' : ''}`}>
                              {r.stockIncome == null ? '-' : peso(r.stockIncome)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#14120f] border-t border-[#2a2622] text-xs">
                    <tr>
                      <td className="px-4 py-3 uppercase tracking-wider text-[#a8a090]" colSpan={6}>Total</td>
                      <td className="px-4 py-3 text-right font-mono">{qty(rows.reduce((s, r) => s + r.onHand, 0))} pcs</td>
                      <td className="px-4 py-3 text-right font-mono">{peso(totals.stockValue)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${totals.income < 0 ? 'text-[#e5736d]' : 'text-[#e3bf5a]'}`}>{peso(totals.income)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="cs-card overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-[15px] font-semibold">Cost history of one finished piece</h3>
              <p className="text-xs text-[#a8a090] mt-1">
                Juice, bottle, sticker, box and wrap, as booked into Finished Goods. The highest figure across all packaging runs is shown first. Spoiled units are booked as Production Loss, so they are not included.
              </p>
            </div>
            {rows.length === 0 ? (
              <EmptyState icon={Calculator} title="Nothing to cost yet" text="Costs appear once perfume has been packaged." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-y border-[#2a2622]">
                    <tr>
                      <Th>Product</Th>
                      <Th right>Selling price</Th>
                      <Th right>Highest cost</Th>
                      <Th right>Juice + bottle + sticker</Th>
                      <Th right>Box + wrap</Th>
                      <Th>Run</Th>
                      <Th right>Latest</Th>
                      <Th right>Average</Th>
                      <Th right>Margin at highest</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {rows.map((r) => (
                      <tr key={r.size_id} className="hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-3">{label(r)}</td>
                        <td className="px-4 py-3 text-right font-mono">{r.price > 0 ? peso(r.price) : <span className="text-[#a8a090]">no price</span>}</td>
                        {r.high == null ? (
                          <td colSpan={7} className="px-4 py-3 text-xs text-[#a8a090]">Not packaged yet</td>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-right font-mono text-[#e3bf5a]">{peso(r.high)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{peso(r.high_bottled_unit)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{peso(r.high_pack_unit)}</td>
                            <td className="px-4 py-3 text-xs whitespace-nowrap">
                              <span className="font-mono">PK-{pad(r.high_run_no)}</span>
                              <div className="text-[#a8a090]">{fmtDate(r.high_run_date)}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              {peso(r.last_unit_cost)}
                              <div className="text-[#a8a090]">{fmtDate(r.last_run_date)}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              {peso(r.avg_unit_cost)}
                              <div className="text-[#a8a090]">{r.runs} run{r.runs === 1 ? '' : 's'}</div>
                            </td>
                            <td className={`px-4 py-3 text-right font-mono text-xs ${r.margin != null && r.margin < 0 ? 'text-[#e5736d]' : ''}`}>
                              {r.margin == null ? '-' : (
                                <>
                                  {peso(r.margin)}
                                  <div>{(r.marginPct * 100).toFixed(1)}%</div>
                                </>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="cs-card overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-[15px] font-semibold">Material prices: highest, latest and movement</h3>
              <p className="text-xs text-[#a8a090] mt-1">
                Shows the most you have paid, who charged it, what you pay now, and whether the latest price is above or below your average. Red means the latest price is higher.
              </p>
            </div>
            {materials.length === 0 ? (
              <EmptyState icon={Calculator} title="No materials yet" text="Add materials and record purchases to see prices." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-y border-[#2a2622]">
                    <tr>
                      <Th>Material</Th>
                      <Th>Type</Th>
                      <Th right>Highest paid</Th>
                      <Th>When, from</Th>
                      <Th right>Latest</Th>
                      <Th right>Average</Th>
                      <Th right>Latest vs average</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {materials.map((m) => (
                      <tr key={m.material_id} className="hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-3">{m.name}<div className="text-[10px] font-mono text-[#a8a090]">{m.code}</div></td>
                        <td className="px-4 py-3 text-xs">{CATEGORY[m.category] || m.category}</td>
                        {m.purchases === 0 ? (
                          <td colSpan={5} className="px-4 py-3 text-xs text-[#a8a090]">No purchases yet</td>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-right font-mono text-[#e3bf5a]">{money4(m.high_cost)} <span className="text-xs text-[#a8a090]">/ {m.unit}</span></td>
                            <td className="px-4 py-3 text-xs">{fmtDate(m.high_date)}<div className="text-[#a8a090]">{m.high_supplier || 'No supplier'}</div></td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{money4(m.last_cost)}<div className="text-[#a8a090]">{fmtDate(m.last_date)}</div></td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{money4(m.avg_cost)}<div className="text-[#a8a090]">{m.purchases} purchase{m.purchases === 1 ? '' : 's'}</div></td>
                            <td className="px-4 py-3 text-right font-mono text-xs"><Delta v={change(m.last_cost, m.avg_cost)} /></td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="cs-card overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-[15px] font-semibold">Cost of matured juice per ml</h3>
              <p className="text-xs text-[#a8a090] mt-1">From completed maceration batches. Normal evaporation is inside this cost; loss above the normal rate is not.</p>
            </div>
            {juiceRows.length === 0 ? (
              <EmptyState icon={Calculator} title="No matured batches yet" text="Juice costs appear once a maceration batch is completed." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1816] text-xs uppercase tracking-wider text-[#a8a090] border-y border-[#2a2622]">
                    <tr>
                      <Th>Perfume</Th>
                      <Th right>Highest per ml</Th>
                      <Th>Batch</Th>
                      <Th right>Latest</Th>
                      <Th right>Average</Th>
                      <Th right>Latest vs average</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {juiceRows.map((j) => (
                      <tr key={j.perfume_id} className="hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-3">{j.name}</td>
                        <td className="px-4 py-3 text-right font-mono text-[#e3bf5a]">{money4(j.high_per_ml)}</td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          <span className="font-mono">MB-{pad(j.high_batch_no)}</span>
                          <div className="text-[#a8a090]">{fmtDate(j.high_date)}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{money4(j.last_per_ml)}<div className="text-[#a8a090]">{fmtDate(j.last_date)}</div></td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{money4(j.avg_per_ml)}<div className="text-[#a8a090]">{j.batches} batch{j.batches === 1 ? '' : 'es'}</div></td>
                        <td className="px-4 py-3 text-right font-mono text-xs"><Delta v={change(j.last_per_ml, j.avg_per_ml)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
