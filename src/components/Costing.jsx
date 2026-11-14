import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, ErrorNote, peso, fmtDate } from './ui';

const pad = (n) => String(n).padStart(4, '0');
const qty = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const money4 = (v) =>
  v == null ? '-' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v));
const num = (v) => (v == null ? null : Number(v));

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

export default function Costing({ user }) {
  const isOwner = user?.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [juice, setJuice] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [p, m, j] = await Promise.all([
      supabase.rpc('costing_products'),
      supabase.rpc('costing_materials'),
      supabase.rpc('costing_juice'),
    ]);
    const err = [p, m, j].find((r) => r.error);
    if (err) setError(err.error.message);
    setProducts(p.data || []);
    setMaterials(m.data || []);
    setJuice(j.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  // Most expensive pieces first; sizes that have never been packaged go last
  const rows = useMemo(
    () =>
      products
        .map((r) => {
          const high = num(r.high_unit_cost);
          const price = num(r.price);
          const margin = high != null && price > 0 ? price - high : null;
          return { ...r, high, price, margin, marginPct: margin != null ? margin / price : null };
        })
        .sort((a, b) => (b.high ?? -1) - (a.high ?? -1) || a.perfume_name.localeCompare(b.perfume_name)),
    [products]
  );
  const costed = rows.filter((r) => r.high != null);
  const top = costed[0];
  const thinnest = costed.filter((r) => r.margin != null).sort((a, b) => a.marginPct - b.marginPct)[0];
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
      <PageHeader title="Costing" subtitle="The highest it has cost to produce one piece, against your selling price" />
      <ErrorNote>{error}</ErrorNote>

      {loading ? (
        <p className="text-sm text-[#a8a090]">Loading...</p>
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Stat
              label="Highest cost to produce one piece"
              value={top ? peso(top.high) : '-'}
              sub={top ? `${label(top)} · PK-${pad(top.high_run_no)}, ${fmtDate(top.high_run_date)}` : 'Package some perfume to see costs'}
            />
            <Stat
              label="Thinnest margin at highest cost"
              value={thinnest ? `${(thinnest.marginPct * 100).toFixed(1)}%` : '-'}
              tone={thinnest && thinnest.margin < 0 ? 'text-[#e5736d]' : ''}
              sub={thinnest ? `${label(thinnest)} · sells at ${peso(thinnest.price)}` : 'Needs a price and at least one packaging run'}
            />
          </section>

          <section className="cs-card overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-[15px] font-semibold">Cost of one finished piece</h3>
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
              <h3 className="text-[15px] font-semibold">Highest price paid for each material</h3>
              <p className="text-xs text-[#a8a090] mt-1">Useful when negotiating with suppliers: it shows the most you have paid, who charged it, and what you pay now.</p>
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#24201c]">
                    {materials.map((m) => (
                      <tr key={m.material_id} className="hover:bg-[#1c1916] transition-colors">
                        <td className="px-4 py-3">{m.name}<div className="text-[10px] font-mono text-[#a8a090]">{m.code}</div></td>
                        <td className="px-4 py-3 text-xs">{CATEGORY[m.category] || m.category}</td>
                        {m.purchases === 0 ? (
                          <td colSpan={4} className="px-4 py-3 text-xs text-[#a8a090]">No purchases yet</td>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-right font-mono text-[#e3bf5a]">{money4(m.high_cost)} <span className="text-xs text-[#a8a090]">/ {m.unit}</span></td>
                            <td className="px-4 py-3 text-xs">{fmtDate(m.high_date)}<div className="text-[#a8a090]">{m.high_supplier || 'No supplier'}</div></td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{money4(m.last_cost)}<div className="text-[#a8a090]">{fmtDate(m.last_date)}</div></td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{money4(m.avg_cost)}<div className="text-[#a8a090]">{m.purchases} purchase{m.purchases === 1 ? '' : 's'}</div></td>
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
