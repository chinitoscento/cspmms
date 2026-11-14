import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Package,
  FlaskConical,
  Menu,
  X,
  ChevronDown,
  Clock,
  LogOut,
  LayoutDashboard,
  Shield,
  Search,
  Users,
  Truck,
  Scale,
  Boxes,
  ShoppingCart,
  Layers,
  Droplets,
  PackageCheck,
  PackageX,
  ShoppingBag,
  Wallet,
  Calculator,
  BarChart3,
  ClipboardCheck,
} from 'lucide-react';
import logoImage from '../logo.png';
import CommandPalette from './CommandPalette';

// true: white page background around the dark cards. false: the original all-dark look.
const WHITE_OUTER = true;

const NAV_ITEMS = [
  { id: 'dashboard', name: 'Executive Dashboard', icon: LayoutDashboard },
  { id: 'customers', name: 'Customers', icon: Users },
  { id: 'suppliers', name: 'Suppliers', icon: Truck },
  { id: 'inventory', name: 'Perfume Collection', icon: Package },
  { id: 'materials', name: 'Raw Materials', icon: Layers },
  { id: 'stock', name: 'Stock & Alerts', icon: Boxes },
  { id: 'writeoffs', name: 'Stock Write-offs', icon: PackageX },
  { id: 'procurement', name: 'Procurement', icon: ShoppingCart },
  { id: 'ledger', name: 'Journal Ledger', icon: BookOpen },
  { id: 'maceration', name: 'Maceration Lab', icon: FlaskConical },
  { id: 'bottling', name: 'Bottling', icon: Droplets },
  { id: 'packaging', name: 'Packaging', icon: PackageCheck },
  { id: 'sales', name: 'Sales and Return/Exchange', icon: ShoppingBag },
  { id: 'collections', name: 'Collections', icon: Wallet },
  { id: 'analytics', name: 'Sales Analytics', icon: BarChart3 },
  { id: 'costing', name: 'Costing', icon: Calculator },
  { id: 'reports', name: 'Accounting Reports', icon: Scale },
  { id: 'audit', name: 'Audit', icon: ClipboardCheck },
  { id: 'users', name: 'User Management', icon: Shield },
];

// Sidebar sections, by function. A group with no label (the dashboard) is always shown.
const NAV_GROUPS = [
  { id: 'overview', label: null, ids: ['dashboard'] },
  { id: 'partners', label: 'Partners & Catalog', ids: ['customers', 'suppliers', 'inventory', 'materials'] },
  { id: 'purchasing', label: 'Purchasing & Stock', ids: ['procurement', 'stock', 'writeoffs'] },
  { id: 'production', label: 'Production', ids: ['maceration', 'bottling', 'packaging'] },
  { id: 'selling', label: 'Sales & Collections', ids: ['sales', 'collections', 'analytics'] },
  { id: 'finance', label: 'Finance & Accounting', ids: ['costing', 'ledger', 'reports', 'audit'] },
  { id: 'admin', label: 'Administration', ids: ['users'] },
];

function getGreeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Layout({ children, activeTab, setActiveTab, onSignOut, user, badges = {} }) {
  const [sidebarOpen, setSidebarOpen] = useState(false); // phone: the slide-over menu
  // Computer screens: the menu can be hidden to give the page more room. The choice is remembered on this computer.
  const [menuShown, setMenuShown] = useState(() => {
    try {
      return localStorage.getItem('cs-menu-shown') !== '0';
    } catch {
      return true;
    }
  });
  const toggleMenu = () =>
    setMenuShown((v) => {
      try {
        localStorage.setItem('cs-menu-shown', v ? '0' : '1');
      } catch {
        /* the choice just is not remembered */
      }
      return !v;
    });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Ctrl+K / Cmd+K opens the quick-jump palette
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
     const name = user?.first_name || user?.username || 'there';

  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeLine = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Badges that mean 'waiting for the owner' rather than 'ready for the next step'
  const APPROVAL_BADGES = ['sales'];
  const badgeText = (id) => (APPROVAL_BADGES.includes(id) ? 'awaiting approval' : 'ready');

  const OWNER_ONLY = ['users', 'reports', 'costing', 'analytics', 'audit'];
  const navItems = NAV_ITEMS.filter((item) => !OWNER_ONLY.includes(item.id) || user?.role === 'owner');

  // Sections the person can see (empty ones are dropped, e.g. Administration for staff)
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.ids.map((id) => navItems.find((i) => i.id === id)).filter(Boolean) })).filter((g) => g.items.length > 0);
  const groupOf = (tab) => groups.find((g) => g.items.some((i) => i.id === tab))?.id;
  const [openGroups, setOpenGroups] = useState(() => new Set([groupOf(activeTab)]));
  // Jumping to a page (menu, Ctrl K, dashboard card) opens the section it lives in
  useEffect(() => {
    const g = groupOf(activeTab);
    if (g) setOpenGroups((prev) => (prev.has(g) ? prev : new Set(prev).add(g)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const toggleGroup = (id) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  
  const paletteItems = [
    ...navItems.map((item) => ({
      id: item.id,
      name: item.name,
      icon: item.icon,
      hint: badges[item.id] > 0 ? `${badges[item.id]} ${badgeText(item.id)}` : 'Go to page',
      run: () => setActiveTab(item.id),
    })),
    { id: 'signout', name: 'Sign out', icon: LogOut, hint: 'End session', run: onSignOut },
  ];

  

  return (
    <div
      className={`min-h-screen flex ${WHITE_OUTER ? 'bg-white text-[#1c1916]' : 'bg-[#0e0d0c] text-[#ece6d8]'}`}
      style={WHITE_OUTER ? { '--cs-outer': '#ffffff', '--cs-outer-line': '#e4dfd3', '--cs-outer-muted': '#6b6456' } : undefined}
    >
      {WHITE_OUTER && <style>{`.cs-card { color: #ece6d8; }`}</style>}
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-md lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-[#0b0a09] text-[#ece6d8] border-r border-[#24201c] p-5 flex flex-col justify-between
          transform transition-transform duration-300 ease-in-out
          ${menuShown ? 'lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen' : 'lg:hidden'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between pb-5 border-b border-[#24201c] shrink-0">
            <div className="flex items-center gap-3">
              <img
                src={logoImage}
                alt="Chinito Scento logo"
                className="w-11 h-11 object-contain"
              />
              <div>
                <h1 className="font-serif tracking-[0.14em] text-lg text-[#e3bf5a] font-semibold leading-tight">
                  CHINITO SCENTO
                </h1>
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#a8a090]">CSPMMS Enterprise</p>
              </div>
            </div>
            <button
              onClick={toggleMenu}
              className="hidden lg:inline-flex w-9 h-9 items-center justify-center rounded-[10px] border border-[#2a2622] bg-[#161412] hover:border-[#d9b24c] cursor-pointer shrink-0"
              aria-label="Hide menu"
              title="Hide menu"
            >
              <Menu className="w-[18px] h-[18px] text-[#d9b24c]" aria-hidden="true" />
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-[#a8a090] hover:text-white cursor-pointer"
              aria-label="Close menu"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <nav className="mt-5 flex-1 min-h-0 overflow-y-auto pr-1 space-y-3" aria-label="Main">
            {groups.map((g) => {
              const isOpen = !g.label || openGroups.has(g.id);
              const groupBadge = g.items.reduce((n, i) => n + (badges[i.id] || 0), 0);
              const needsApproval = g.items.some((i) => APPROVAL_BADGES.includes(i.id) && badges[i.id] > 0);
              return (
                <div key={g.id}>
                  {g.label && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      aria-expanded={isOpen}
                      aria-controls={`nav-${g.id}`}
                      className="w-full flex items-center gap-2 px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#7d766a] hover:text-[#ece6d8] cursor-pointer transition-colors"
                    >
                      <span>{g.label}</span>
                      {!isOpen && groupBadge > 0 && (
                        <span
                          className={`min-w-[18px] h-[18px] px-1 rounded-full ${needsApproval ? 'bg-[#e5a93d]' : 'bg-[#3ecf8e]'} text-[#0e0d0c] text-[10px] font-semibold tracking-normal flex items-center justify-center`}
                          aria-label={`${groupBadge} waiting in ${g.label}`}
                        >
                          {groupBadge}
                        </span>
                      )}
                      <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                    </button>
                  )}
                  {isOpen && (
                    <div id={`nav-${g.id}`} className={`space-y-1 ${g.label ? 'mt-0.5' : ''}`}>
                      {g.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              setActiveTab(item.id);
                              setSidebarOpen(false);
                            }}
                            aria-current={isActive ? 'page' : undefined}
                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium border text-left cursor-pointer transition-all duration-200 ${
                              isActive
                                ? 'bg-[#1f1b12] text-[#e3bf5a] border-[#3a3014]'
                                : 'text-[#a8a090] border-transparent hover:bg-[#1a1816] hover:text-[#ece6d8] hover:translate-x-0.5'
                            }`}
                          >
                            <Icon className="w-4 h-4" aria-hidden="true" />
                            <span>{item.name}</span>
                            {badges[item.id] > 0 && (
                              <span
                                className={`ml-auto min-w-[20px] h-5 px-1.5 rounded-full ${APPROVAL_BADGES.includes(item.id) ? 'bg-[#e5a93d]' : 'bg-[#3ecf8e]'} text-[#0e0d0c] text-[11px] font-semibold flex items-center justify-center`}
                                aria-label={`${badges[item.id]} ${badgeText(item.id)}`}
                              >
                                {badges[item.id]}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="pt-5 border-t border-[#24201c] shrink-0">
          <div className="p-3.5 rounded-xl border border-[#24201c] flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#3ecf8e] animate-pulse" aria-hidden="true" />
            <div>
              <p className="text-xs font-medium text-[#ece6d8]">Ledger Engine Active</p>
              <p className="text-[9px] text-[#a8a090] tracking-wider">EVENT-SOURCED V2.0</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className={`h-20 backdrop-blur-xl border-b px-6 lg:px-10 flex items-center justify-between sticky top-0 z-30 ${WHITE_OUTER ? 'bg-white/90 border-[#e4dfd3]' : 'bg-[#0e0d0c]/85 border-[#24201c]'}`}>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-[#161412] text-[#ece6d8] hover:text-[#e3bf5a] border border-[#2a2622] cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            {!menuShown && (
              <button
                onClick={toggleMenu}
                className="hidden lg:inline-flex w-10 h-10 items-center justify-center rounded-xl border border-[#2a2622] bg-[#161412] hover:border-[#d9b24c] cursor-pointer"
                aria-label="Show menu"
                title="Show menu"
              >
                <Menu className="w-[18px] h-[18px] text-[#d9b24c]" aria-hidden="true" />
              </button>
            )}
            <div>
              <h2 className="font-serif text-2xl font-semibold leading-tight">
                {getGreeting(now.getHours())}, {name}
              </h2>
              <p className={`text-xs ${WHITE_OUTER ? 'text-[#6b6456]' : 'text-[#a8a090]'}`}>{dateLine}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setPaletteOpen(true)}
              className="cs-btn cs-btn-ghost px-3.5 py-2 text-xs text-[#a8a090]"
              aria-label="Search or jump to"
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Search or jump to</span>
              <kbd className="hidden md:inline rounded-md border border-[#3a352e] px-1.5 py-px text-[10px] font-sans">
                {isMac ? '⌘ K' : 'Ctrl K'}
              </kbd>
            </button>

            <div className="hidden md:flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-[#161412] border border-[#2a2622] text-xs text-[#ece6d8] tabular-nums">
              <Clock className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
              <span>{timeLine}</span>
            </div>

            <button onClick={onSignOut} className="cs-btn cs-btn-ghost px-3.5 py-2 text-xs" title="Sign out">
              <LogOut className="w-3.5 h-3.5 text-[#d9b24c]" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        {/* key makes each page fade in when you switch tabs */}
        <main key={activeTab} className="cs-fade flex-1 p-6 lg:p-10 max-w-6xl w-full mx-auto">
          {children}
        </main>
      </div>

      <div className="text-[#ece6d8]">
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
      </div>
    </div>
  );
}
