import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import ChangePassword from './components/ChangePassword';
import Customers from './components/Customers';
import Suppliers from './components/Suppliers';
import PerfumeCollection from './components/PerfumeCollection';
import Ledger from './components/Ledger';
import Reports from './components/Reports';
import Inventory, { InventoryAlertBanner } from './components/Inventory';
import Procurement from './components/Procurement';
import Maceration from './components/Maceration';
import Bottling from './components/Bottling';
import Packaging from './components/Packaging';
import StockWriteoffs from './components/StockWriteoffs';
import RawMaterials from './components/RawMaterials';
import Sales from './components/Sales';
import Collections from './components/Collections';
import Costing from './components/Costing';
import Analytics, { FastMoverBanner } from './components/Analytics';
import Audit from './components/Audit';
import { EmptyState, peso } from './components/ui';
import { supabase } from './supabaseClient';
import { Sparkles, ArrowUpRight, FlaskConical, Droplets, PackageCheck, TrendingUp, Banknote, Receipt, CreditCard, ShoppingBag } from 'lucide-react';

function StatCard({ title, value, caption, icon: Icon, onClick, tone }) {
  return (
    <button type="button" onClick={onClick} className="cs-card cs-card-hover p-5 text-left w-full cursor-pointer">
      <div className="flex items-center justify-between mb-4 gap-2">
        <span className="text-[11px] font-medium text-[#a8a090] uppercase tracking-wider">{title}</span>
        <span className="p-2 rounded-xl bg-[#1c1916] border border-[#2a2622] shrink-0">
          <Icon className="w-4 h-4 text-[#d9b24c]" aria-hidden="true" />
        </span>
      </div>
      <div className={`font-serif text-xl xl:text-2xl font-semibold mb-1 break-words ${tone || ''}`}>{value}</div>
      <div className="text-xs text-[#a8a090]">{caption}</div>
    </button>
  );
}

// A dashboard card listing things that are waiting for the next production step
function ReadyCard({ title, count, items, empty, openLabel, onOpen, onItem, actionLabel }) {
  return (
    <div className="cs-card p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {count > 0 && (
          <span className="inline-flex min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#3ecf8e]/10 border border-[#3ecf8e]/30 text-[#3ecf8e] text-[11px] font-semibold items-center justify-center">
            {count}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={empty.icon} title={empty.title} text={empty.text} actionLabel={openLabel} onAction={onOpen} />
      ) : (
        <div>
          <ul>
            {items.slice(0, 5).map((it) => (
              <li key={it.key} className="flex items-center justify-between gap-3 px-2.5 py-2.5 rounded-lg text-sm hover:bg-[#1c1916] transition-colors">
                <span className="min-w-0">
                  <span className="block truncate">{it.label}</span>
                  <span className="block text-xs text-[#a8a090] font-mono">{it.detail}</span>
                </span>
                <button onClick={() => onItem(it)} className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs shrink-0">
                  {actionLabel}
                </button>
              </li>
            ))}
          </ul>
          {items.length > 5 && <p className="text-xs text-[#a8a090] px-2.5 mt-1">+{items.length - 5} more</p>}
          <button onClick={onOpen} className="mt-3 px-2.5 text-xs text-[#e3bf5a] hover:underline cursor-pointer">
            {openLabel}
          </button>
        </div>
      )}
    </div>
  );
}

const daysUntil = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(`${new Date().toLocaleDateString('en-CA')}T00:00:00`)) / 86400000);

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [authNotice, setAuthNotice] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');

  const [summary, setSummary] = useState({ netSales: 0, netIncome: 0, ar: 0, ap: 0, fgUnits: 0, bottlingReady: [], packagingReady: [] });
  const [macBatches, setMacBatches] = useState([]); // batches still macerating
  const [pendingSales, setPendingSales] = useState({ sales: 0, returns: 0 }); // waiting for owner approval
  const [prefill, setPrefill] = useState(null); // hand-off between Maceration > Bottling > Packaging

  // ───── Auth: load profile, restore session, sign out, idle timeout ─────
  const loadProfile = async (authUserId) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle();
    let problem = '';
    if (error || !data) problem = 'This account is not set up yet. Please contact the owner.';
    else if (data.status === 'Revoked') problem = 'Your user credential has been revoked. Please contact the management.';
    else if (data.status !== 'Active') problem = 'Your account is awaiting approval.';
    if (problem) {
      await supabase.auth.signOut();
      return { profile: null, problem };
    }
    return { profile: data, problem: '' };
  };

  const handleSignedIn = async (authUserId) => {
    const result = await loadProfile(authUserId);
    if (result.profile) {
      setAuthNotice('');
      setUser(result.profile);
    }
    return result;
  };

  const handleSignOut = async (notice) => {
    await supabase.auth.signOut();
    setUser(null);
    setActiveTab('dashboard');
    setAuthNotice(typeof notice === 'string' ? notice : '');
  };

  // Keep people signed in across refreshes
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const { profile, problem } = await loadProfile(data.session.user.id);
        if (active) {
          setUser(profile);
          if (problem) setAuthNotice(problem);
        }
      }
      if (active) setBooting(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setUser(null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Sign out after 20 minutes without activity
  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 20 * 60 * 1000;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => handleSignOut('You were signed out after 20 minutes of inactivity.'), IDLE_MS);
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [user]);

  // ───── Dashboard numbers from the database ─────
  const loadSummary = useCallback(async () => {
    // Book any month-end interest that has become due on installment purchases (no-op when none)
    await supabase.rpc('accrue_installment_interest');
    const [tb, inv, sz] = await Promise.all([
      supabase.rpc('trial_balance'),
      supabase.from('inventory_status').select('*').eq('kind', 'finished'),
      supabase.from('perfume_sizes').select('id, size_ml, perfume_id, perfumes(name, status)').eq('is_active', true),
    ]);

    // ---- sales figures, to date, from the ledger balances ----
    const rows = tb.data || []; // code, name, type, debit, credit (already netted per account)
    const code = (r) => String(r.code || '');
    const dr = (r) => Number(r.debit || 0) - Number(r.credit || 0); // debit-side balance
    const total = (list, sign = 1) => list.reduce((s, r) => s + sign * dr(r), 0);

    const netSales = total(rows.filter((r) => r.type === 'revenue'), -1); // 4000 Sales less 4100 Returns
    const netIncome = total(rows.filter((r) => r.type === 'revenue' || r.type === 'expense'), -1);
    const ar = total(rows.filter((r) => code(r) === '1100')); // Accounts Receivable
    const ap = total(rows.filter((r) => code(r) === '2000'), -1); // Accounts Payable (not tax or loans)

    // ---- what is waiting for the next production step ----
    const sizeById = Object.fromEntries((sz.data || []).map((s) => [s.id, s]));
    const juiceByPerfume = {};
    const packagingReady = [];
    let fgUnits = 0;
    (inv.data || []).forEach((r) => {
      const s = sizeById[r.item_id];
      if (!s || !s.perfumes || s.perfumes.status === 'Discontinued') return;
      fgUnits += Number(r.on_hand || 0);
      // matured juice is one pool per perfume, so count each perfume once
      const ml = Number(r.juice_ml || 0);
      if (ml > (juiceByPerfume[s.perfume_id]?.ml || 0)) juiceByPerfume[s.perfume_id] = { perfumeId: s.perfume_id, name: s.perfumes.name, ml };
      const pcs = Number(r.pipeline_units || 0);
      if (pcs > 0) packagingReady.push({ sizeId: s.id, name: `${s.perfumes.name} · ${Number(s.size_ml).toLocaleString('en-PH')} ml`, pcs });
    });
    const bottlingReady = Object.values(juiceByPerfume).filter((j) => j.ml > 0).sort((a, b) => a.name.localeCompare(b.name));
    packagingReady.sort((a, b) => a.name.localeCompare(b.name));

    setSummary({ netSales, netIncome, ar, ap, fgUnits, bottlingReady, packagingReady });
  }, []);

  const signedIn = !!user && !user.must_change_password;
  useEffect(() => {
    if (signedIn && activeTab === 'dashboard') loadSummary();
  }, [signedIn, activeTab, loadSummary]);

  // Batches still macerating (drives the dashboard notice, the menu badge and the Maceration Lab card)
  const loadMac = useCallback(async () => {
    const { data } = await supabase
      .from('maceration_batches')
      .select('id, batch_no, ready_date, perfumes(name)')
      .eq('status', 'Macerating')
      .order('ready_date', { ascending: true });
    setMacBatches(data || []);
  }, []);
  useEffect(() => {
    if (signedIn) loadMac();
  }, [signedIn, activeTab, loadMac]);

  // Credit sales and returns/exchanges waiting for the owner (drives the dashboard notice and the menu badge)
  const loadPending = useCallback(async () => {
    const [s, r] = await Promise.all([
      supabase.from('sales').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
      supabase.from('sales_returns').select('return_no').eq('status', 'Pending'),
    ]);
    setPendingSales({ sales: s.count || 0, returns: new Set((r.data || []).map((x) => x.return_no)).size }); // one request = one RT number
  }, []);
  useEffect(() => {
    if (signedIn) loadPending();
  }, [signedIn, activeTab, loadPending]);

  const refresh = useCallback(() => {
    loadSummary();
    loadMac();
    loadPending();
  }, [loadSummary, loadMac, loadPending]);

  // Go to a page, optionally handing it something to pre-fill. A plain tab click clears the hand-off.
  const navigate = (tab, params) => {
    setPrefill(params || null);
    setActiveTab(tab);
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-[#0e0d0c] flex items-center justify-center text-sm text-[#a8a090]">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Login onSignedIn={handleSignedIn} notice={authNotice} />;
  }

  // First sign in with a temporary password: must choose a new one before anything else
  if (user.must_change_password) {
    return (
      <ChangePassword
        user={user}
        onDone={() => setUser({ ...user, must_change_password: false })}
        onSignOut={handleSignOut}
      />
    );
  }

  const readyBatches = macBatches.filter((b) => daysUntil(b.ready_date) <= 0);
  const pendingTotal = pendingSales.sales + pendingSales.returns;
  const readyNames = [...new Set(readyBatches.map((b) => b.perfumes?.name).filter(Boolean))];

  return (
    <Layout activeTab={activeTab} setActiveTab={navigate} onSignOut={handleSignOut} user={user} badges={{ maceration: readyBatches.length, sales: pendingTotal }}>
      {/* ───────── Dashboard ───────── */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <InventoryAlertBanner scope="material" onOpen={() => setActiveTab('stock')} />
          <InventoryAlertBanner scope="finished" onOpen={() => setActiveTab('stock')} />
          <FastMoverBanner onOpen={() => navigate(user.role === 'owner' ? 'analytics' : 'stock')} />
          {readyBatches.length > 0 && (
            <button
              type="button"
              onClick={() => navigate('maceration')}
              className="w-full flex items-center justify-between gap-4 rounded-xl border border-[#3ecf8e]/30 bg-[#3ecf8e]/10 px-5 py-3.5 text-left cursor-pointer hover:bg-[#3ecf8e]/15 transition-colors"
            >
              <span className="flex items-center gap-3 text-sm">
                <FlaskConical className="w-4 h-4 text-[#3ecf8e] shrink-0" aria-hidden="true" />
                <span>
                  <strong className="text-[#3ecf8e]">
                    {readyBatches.length} maceration batch{readyBatches.length === 1 ? '' : 'es'} {readyBatches.length === 1 ? 'is' : 'are'} ready to complete
                  </strong>
                  <span className="text-[#a8a090]"> · {readyNames.slice(0, 3).join(', ')}{readyNames.length > 3 ? ` +${readyNames.length - 3} more` : ''}</span>
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-[#3ecf8e] whitespace-nowrap">
                Open Maceration Lab <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </button>
          )}
          {pendingTotal > 0 && (
            <button
              type="button"
              onClick={() => navigate('sales')}
              className="w-full flex items-center justify-between gap-4 rounded-xl border border-[#e5a93d]/30 bg-[#e5a93d]/10 px-5 py-3.5 text-left cursor-pointer hover:bg-[#e5a93d]/15 transition-colors"
            >
              <span className="flex items-center gap-3 text-sm">
                <ShoppingBag className="w-4 h-4 text-[#e5a93d] shrink-0" aria-hidden="true" />
                <span>
                  <strong className="text-[#e5a93d]">
                    {pendingTotal} sale{pendingTotal === 1 ? '' : 's'} and return{pendingTotal === 1 ? '' : 's'} awaiting approval
                  </strong>
                  <span className="text-[#a8a090]">
                    {' '}· {pendingSales.sales} credit sale{pendingSales.sales === 1 ? '' : 's'}, {pendingSales.returns} return{pendingSales.returns === 1 ? '' : 's'}/exchange{pendingSales.returns === 1 ? '' : 's'}
                  </span>
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-[#e5a93d] whitespace-nowrap">
                Open Sales <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </button>
          )}
          <section
            className="relative overflow-hidden cs-card p-8 lg:p-10 shadow-2xl"
            style={{ background: 'radial-gradient(600px 240px at 90% 0%, #251f10, #161412 70%)' }}
          >
            <div className="relative max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#d9b24c]/10 border border-[#d9b24c]/30 text-[#e3bf5a] text-xs font-medium mb-4">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Chinito Scento Architecture</span>
              </div>
              <h1 className="font-serif text-4xl lg:text-5xl font-semibold leading-[1.1] mb-4">
                Perfume Manufacturing &amp; Management System
              </h1>
              <p className="text-[#a8a090] text-base leading-relaxed max-w-xl">
                From oils to finished goods to sales. Follow every batch through maceration, bottling and packaging, and see at a glance what is ready to sell, what customers owe you and what you owe suppliers.
              </p>
            </div>
          </section>

          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              title="Net Sales"
              value={peso(summary.netSales)}
              caption="Running total to date"
              icon={TrendingUp}
              onClick={() => setActiveTab(user.role === 'owner' ? 'reports' : 'ledger')}
            />
            <StatCard
              title="Net Income"
              value={peso(summary.netIncome)}
              caption={
                summary.netSales > 0
                  ? `${(summary.netIncome / summary.netSales * 100).toFixed(1)}% of net sales${summary.netIncome < 0 ? ' (net loss)' : ''}`
                  : summary.netIncome < 0 ? 'Net loss to date' : 'Running total to date'
              }
              icon={Banknote}
              tone={summary.netIncome < 0 ? 'text-[#e5736d]' : ''}
              onClick={() => setActiveTab(user.role === 'owner' ? 'reports' : 'ledger')}
            />
            <StatCard
              title="Accounts Receivable"
              value={peso(summary.ar)}
              caption="Owed by customers, to date"
              icon={Receipt}
              onClick={() => setActiveTab('collections')}
            />
            <StatCard
              title="Accounts Payable"
              value={peso(summary.ap)}
              caption="Owed to suppliers, to date"
              icon={CreditCard}
              onClick={() => setActiveTab('suppliers')}
            />
            <StatCard
              title="Finished Goods"
              value={`${summary.fgUnits.toLocaleString('en-PH')} pcs`}
              caption="Packed and available for sale"
              icon={PackageCheck}
              onClick={() => setActiveTab('stock')}
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="cs-card p-6">
              <h3 className="text-[15px] font-semibold mb-2">Maceration Lab</h3>
              {macBatches.length === 0 ? (
                <EmptyState
                  icon={FlaskConical}
                  title="No active batches"
                  text="Aging batches and their progress will show here."
                  actionLabel="Open Maceration Lab"
                  onAction={() => navigate('maceration')}
                />
              ) : (
                <div>
                  <ul>
                    {macBatches.slice(0, 5).map((b) => {
                      const left = daysUntil(b.ready_date);
                      return (
                        <li key={b.id} className="flex items-center justify-between gap-4 px-2.5 py-3 rounded-lg text-sm hover:bg-[#1c1916] transition-colors">
                          <span>
                            <span className="font-mono text-xs text-[#e3bf5a] mr-3">MB-{String(b.batch_no).padStart(8, '0')}</span>
                            {b.perfumes?.name}
                          </span>
                          <span className={`text-xs whitespace-nowrap ${left <= 0 ? 'text-[#3ecf8e]' : 'text-[#a8a090]'}`}>
                            {left <= 0 ? 'Ready now' : `${left} day${left === 1 ? '' : 's'} left`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {macBatches.length > 5 && <p className="text-xs text-[#a8a090] px-2.5 mt-1">+{macBatches.length - 5} more batches</p>}
                  <button onClick={() => navigate('maceration')} className="mt-3 px-2.5 text-xs text-[#e3bf5a] hover:underline cursor-pointer">
                    Open Maceration Lab
                  </button>
                </div>
              )}
            </div>

            <ReadyCard
              title="Bottling"
              count={summary.bottlingReady.length}
              items={summary.bottlingReady.map((j) => ({
                key: j.perfumeId,
                perfumeId: j.perfumeId,
                label: j.name,
                detail: `${j.ml.toLocaleString('en-PH', { maximumFractionDigits: 1 })} ml matured juice`,
              }))}
              empty={{ icon: Droplets, title: 'Nothing to bottle', text: 'Matured juice waiting to be bottled will show here.' }}
              openLabel="Open Bottling"
              onOpen={() => navigate('bottling')}
              onItem={(it) => navigate('bottling', { perfumeId: it.perfumeId })}
              actionLabel="Bottle"
            />
            <ReadyCard
              title="Packaging"
              count={summary.packagingReady.length}
              items={summary.packagingReady.map((s) => ({
                key: s.sizeId,
                sizeId: s.sizeId,
                label: s.name,
                detail: `${s.pcs.toLocaleString('en-PH')} pcs bottled, waiting`,
              }))}
              empty={{ icon: PackageCheck, title: 'Nothing to package', text: 'Bottled perfume waiting to be packaged will show here.' }}
              openLabel="Open Packaging"
              onOpen={() => navigate('packaging')}
              onItem={(it) => navigate('packaging', { sizeId: it.sizeId })}
              actionLabel="Package"
            />
          </section>
        </div>
      )}

      {activeTab === 'costing' && user.role === 'owner' && <Costing user={user} />}
      {activeTab === 'analytics' && user.role === 'owner' && <Analytics user={user} onNavigate={navigate} />}
      {activeTab === 'sales' && <Sales user={user} onChanged={refresh} />}
      {activeTab === 'collections' && <Collections user={user} onChanged={refresh} />}
      {activeTab === 'customers' && <Customers user={user} />}
      {activeTab === 'suppliers' && <Suppliers />}
      {activeTab === 'inventory' && <PerfumeCollection />}
      {activeTab === 'materials' && <RawMaterials user={user} onNavigate={navigate} onChanged={refresh} />}
      {activeTab === 'stock' && <Inventory user={user} onNavigate={navigate} onChanged={refresh} />}
      {activeTab === 'procurement' && <Procurement user={user} onChanged={refresh} />}
      {activeTab === 'maceration' && <Maceration user={user} onChanged={refresh} onNavigate={navigate} />}
      {activeTab === 'bottling' && <Bottling user={user} onChanged={refresh} onNavigate={navigate} prefill={prefill} />}
      {activeTab === 'packaging' && <Packaging user={user} onChanged={refresh} prefill={prefill} />}
      {activeTab === 'writeoffs' && <StockWriteoffs user={user} onChanged={refresh} />}
      {activeTab === 'ledger' && <Ledger user={user} onChanged={refresh} />}
      {activeTab === 'reports' && user.role === 'owner' && <Reports user={user} />}
      {activeTab === 'audit' && user.role === 'owner' && <Audit user={user} />}

      {activeTab === 'users' && user.role === 'owner' && <UserManagement />}
    </Layout>
  );
}
