import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, ClipboardCheck, FlaskConical, LayoutDashboard, LifeBuoy, LogOut, Menu, Pill, Search, Settings,
  Terminal, Users, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, ROLE_LABEL } from "@/lib/utils";
import { useDebounced } from "./common";

type NavItem = { to: string; label: string; icon: ReactNode; permission?: string };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Pharmacy", items: [
    { to: "/", label: "Overview", icon: <LayoutDashboard />, permission: "dashboard:read" },
    { to: "/patients", label: "Patients", icon: <Users />, permission: "patients:read" },
    { to: "/prescriptions", label: "Prescriptions", icon: <Pill />, permission: "prescriptions:read" },
  ] },
  { group: "Support", items: [
    { to: "/tickets", label: "Support Center", icon: <LifeBuoy />, permission: "tickets:create" },
    { to: "/api-explorer", label: "API & Logs", icon: <Terminal />, permission: "logs:read" },
  ] },
  { group: "Quality", items: [
    { to: "/qa", label: "QA Lab", icon: <ClipboardCheck />, permission: "qa:read" },
    { to: "/bug-lab", label: "Bug Lab", icon: <FlaskConical />, permission: "qa:read" },
  ] },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2" aria-label="MediCare QA Lab home">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0b7a75" />
        <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#fff" />
        <path d="M8 16h4l2-3 3 6 2-3h5" fill="none" stroke="#0b7a75" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold text-white">MediCare</span>
        <span className="block text-[12px] text-teal-100/70">QA Lab</span>
      </span>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-slab text-teal-50/90 px-3 py-4">
      <Logo />
      <div className="mt-6 flex-1 space-y-5 overflow-y-auto">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.permission || can(i.permission));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <p className="px-3 mb-1 text-[12px] text-teal-100/50">{g.group}</p>
              <ul className="space-y-0.5">
                {items.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} end={i.to === "/"} onClick={onNavigate}
                      className={({ isActive }) => cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors [&_svg]:size-[18px]",
                        isActive ? "bg-teal-600 text-white font-medium" : "hover:bg-slab-2 hover:text-white")}>
                      {i.icon}{i.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <NavLink to="/settings" onClick={onNavigate}
        className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] [&_svg]:size-[18px]",
          isActive ? "bg-teal-600 text-white" : "hover:bg-slab-2 hover:text-white")}>
        <Settings /> Settings
      </NavLink>
      <p className="px-3 pt-3 text-[11.5px] leading-snug text-teal-100/45">Synthetic data only. Not for clinical use.</p>
    </nav>
  );
}

type SearchResult = { type: string; id: number; code: string; title: string; subtitle: string };
const RESULT_LINK: Record<string, (id: number) => string> = {
  patient: (id) => `/patients/${id}`, prescription: (id) => `/prescriptions/${id}`, ticket: (id) => `/tickets/${id}`,
  bug: (id) => `/qa/bugs/${id}`, test_case: (id) => `/qa/cases/${id}`,
};
const TYPE_LABEL: Record<string, string> = { patient: "Patient", prescription: "Prescription", ticket: "Ticket", bug: "Bug", test_case: "Test case" };

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 250);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isFetching } = useQuery({
    queryKey: ["search", dq], enabled: dq.length >= 2,
    queryFn: () => api<{ results: SearchResult[] }>("/search", { query: { q: dq } }),
  });
  const results = dq.length >= 2 ? data?.results ?? [] : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement).tagName))) {
        e.preventDefault(); inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (r: SearchResult) => { setOpen(false); setQ(""); nav(RESULT_LINK[r.type](r.id)); };

  return (
    <Popover.Root open={open && dq.length >= 2} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-3" aria-hidden />
          <input ref={inputRef} type="search" value={q} role="combobox" aria-expanded={open} aria-controls="global-search-results"
            aria-label="Search patients, prescriptions, tickets, bugs" placeholder="Search patients, RX codes, tickets…"
            className="h-9 w-full rounded-lg bg-canvas border border-transparent pl-9 pr-14 text-sm placeholder:text-ink-3 focus:bg-card focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && results[active]) go(results[active]);
              if (e.key === "Escape") setOpen(false);
            }} />
          <kbd className="hidden sm:block absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-ink-3">Ctrl K</kbd>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-[min(28rem,calc(100vw-24px))] rounded-xl border border-line bg-card shadow-[var(--shadow-pop)] p-1.5">
          <ul id="global-search-results" role="listbox" aria-label="Search results">
            {isFetching && !results.length && <li className="px-3 py-3 text-[13px] text-ink-3">Searching…</li>}
            {!isFetching && !results.length && <li className="px-3 py-3 text-[13px] text-ink-3">No matches for “{dq}”.</li>}
            {results.map((r, i) => (
              <li key={`${r.type}-${r.id}`} role="option" aria-selected={i === active}>
                <button type="button" onClick={() => go(r)} onMouseEnter={() => setActive(i)}
                  className={cn("w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left", i === active && "bg-canvas")}>
                  <span className="w-20 shrink-0 text-[12px] text-ink-3">{TYPE_LABEL[r.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">{r.title}</span>
                    <span className="id-chip">{r.code}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type Notification = { kind: string; severity: "info" | "warning" | "danger"; title: string; link: string };

function Notifications() {
  const { data } = useQuery({
    queryKey: ["notifications"], refetchInterval: 60_000,
    queryFn: () => api<{ items: Notification[]; count: number }>("/notifications"),
  });
  const count = data?.count ?? 0;
  const dot = { info: "bg-sky-600", warning: "bg-[#c98500]", danger: "bg-bad-700" };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="relative rounded-lg p-2 text-ink-2 hover:bg-canvas hover:text-ink"
        aria-label={`Notifications${count ? ` (${count})` : ""}`}>
        <Bell className="size-5" />
        {count > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 rounded-full bg-bad-700 px-1 text-[10.5px] font-semibold leading-4 text-white">{count}</span>}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-80 rounded-xl border border-line bg-card p-1.5 shadow-[var(--shadow-pop)]">
          <p className="px-3 py-2 text-[13px] font-semibold">Needs attention</p>
          {count === 0 && <p className="px-3 pb-3 text-[13px] text-ink-3">You're all caught up.</p>}
          {data?.items.map((n) => (
            <DropdownMenu.Item key={n.kind} asChild>
              <Link to={n.link} className="flex items-start gap-2.5 rounded-lg px-3 py-2 text-[13.5px] outline-none data-[highlighted]:bg-canvas">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot[n.severity])} aria-hidden />
                {n.title}
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const initials = user.full_name.split(" ").map((s) => s[0]).join("").slice(0, 2);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-canvas" aria-label="Account menu">
        <span className="grid size-8 place-items-center rounded-full bg-teal-600 text-[12.5px] font-semibold text-white">{initials}</span>
        <span className="hidden md:block text-left leading-tight">
          <span className="block text-[13.5px] font-medium">{user.full_name}</span>
          <span className="block text-[12px] text-ink-3">{ROLE_LABEL[user.role]}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-56 rounded-xl border border-line bg-card p-1.5 shadow-[var(--shadow-pop)]">
          <div className="px-3 py-2">
            <p className="text-[13.5px] font-medium">{user.full_name}</p>
            <p className="text-[12.5px] text-ink-3 truncate">{user.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link to="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] outline-none data-[highlighted]:bg-canvas">
              <Settings className="size-4" /> Settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => logout()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] cursor-pointer outline-none data-[highlighted]:bg-canvas">
            <LogOut className="size-4" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:m-2 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[248px]"><Sidebar /></aside>
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[272px]">
            <Sidebar onNavigate={() => setDrawer(false)} />
            <button className="absolute top-4 right-3 text-white/80" onClick={() => setDrawer(false)} aria-label="Close navigation"><X /></button>
          </div>
        </div>
      )}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-card/95 backdrop-blur px-4 sm:px-6">
          <button className="lg:hidden rounded-lg p-2 hover:bg-canvas" onClick={() => setDrawer(true)} aria-label="Open navigation"><Menu className="size-5" /></button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

