import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState, IdChip, PageHeader, PriorityBadge, ResultBar, StatusBadge } from "@/components/common";
import { Card, CardHeader, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate, humanize, timeAgo, todayISO } from "@/lib/utils";

type Kpi = { value: number; new_in_range: number; new_prev_range: number };
type Exec = { source: string; name: string; at: string; pass_rate: number; passed: number; failed: number; blocked: number; not_run: number; executed: number; total: number };
type Summary = {
  range: { from: string; to: string };
  active_patients: Kpi; active_prescriptions: Kpi; pending_refills: Kpi; open_tickets: Kpi;
  latest_test_execution: Exec | null;
};
type Activity = { series: { bucket: string; new_prescriptions: number; refills: number; approved_refills: number }[]; by_status: Record<string, number> };
type Recent = {
  tickets: { id: number; ticket_code: string; subject: string; priority: string; status: string; created_at: string }[];
  bugs: { id: number; bug_code: string; title: string; severity: string; priority: string; status: string }[] | null;
  latest_run: ({ id: number; name: string; started_at: string } & Exec) | null;
  refills: { id: number; rx_code: string; requested_at: string; medication: string; patient: string }[] | null;
};

const RANGES = [{ v: 7, label: "Last 7 days" }, { v: 30, label: "Last 30 days" }, { v: 90, label: "Last 90 days" }];

function delta(k: Kpi) {
  const d = k.new_in_range - k.new_prev_range;
  if (k.new_prev_range === 0) return { text: `${k.new_in_range} new`, tone: "text-ink-3" };
  const pct = Math.round((d / k.new_prev_range) * 100);
  return { text: `${k.new_in_range} new · ${pct >= 0 ? "+" : ""}${pct}% vs previous`, tone: pct >= 0 ? "text-ok-700" : "text-ink-3" };
}

function KpiTile({ label, kpi, to, loading }: { label: string; kpi?: Kpi; to: string; loading: boolean }) {
  const d = kpi ? delta(kpi) : null;
  return (
    <Link to={to} className="card px-5 py-4 hover:border-line-strong transition-colors block">
      <p className="text-[13px] text-ink-2">{label}</p>
      {loading || !kpi ? <Skeleton className="h-8 w-24 mt-2" /> :
        <p className="text-[30px] font-semibold tabular-nums leading-tight mt-1">{kpi.value.toLocaleString()}</p>}
      {d && <p className={cn("text-[12.5px] mt-1", d.tone)}>{d.text}</p>}
    </Link>
  );
}

function ActivityChart({ days }: { days: number }) {
  const [gran, setGran] = useState<"day" | "week">(days > 31 ? "week" : "day");
  const [asTable, setAsTable] = useState(false);
  const g = days > 31 ? gran : gran;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["activity", days, g],
    queryFn: () => api<Activity>("/dashboard/prescription-activity", { query: { from: todayISO(-(days - 1)), to: todayISO(), granularity: g } }),
  });
  const rows = (data?.series ?? []).map((r) => ({ ...r, label: fmtDate(r.bucket).replace(/, \d{4}$/, "") }));
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Prescription activity" description="New prescriptions and refill requests"
        action={
          <div className="flex gap-2">
            <Select aria-label="Granularity" value={g} onChange={(e) => setGran(e.target.value as "day" | "week")} className="h-8 w-auto text-[13px]">
              <option value="day">Daily</option><option value="week">Weekly</option>
            </Select>
            <button type="button" onClick={() => setAsTable((v) => !v)} className="text-[13px] text-sky-700 hover:underline">
              {asTable ? "Show chart" : "Show table"}
            </button>
          </div>
        } />
      <div className="px-3 pb-4">
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading ? <Skeleton className="h-64 mx-2" /> : asTable ? (
          <div className="max-h-72 overflow-auto px-2">
            <table className="w-full text-[13px]">
              <thead><tr className="text-ink-3 text-left"><th className="py-1.5 font-medium">Period</th><th className="font-medium text-right">New prescriptions</th><th className="font-medium text-right">Refill requests</th><th className="font-medium text-right">Approved</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.bucket} className="border-t border-line"><td className="py-1.5">{r.label}</td><td className="text-right tabular-nums">{r.new_prescriptions}</td><td className="text-right tabular-nums">{r.refills}</td><td className="text-right tabular-nums">{r.approved_refills}</td></tr>)}</tbody>
            </table>
          </div>
        ) : (
          <>
            <ul className="flex gap-4 px-2 pb-2 text-[12.5px] text-ink-2" aria-label="Legend">
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-series-1" />New prescriptions</li>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-series-2" />Refill requests</li>
            </ul>
            <div className="h-64" role="img" aria-label="Bar chart of new prescriptions and refill requests over time. Use 'Show table' for exact values.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} barGap={2} barCategoryGap={rows.length > 20 ? "18%" : "28%"} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-line-strong)" }} tick={{ fill: "var(--color-ink-3)", fontSize: 12 }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--color-ink-3)", fontSize: 12 }} width={36} />
                  <Tooltip cursor={{ fill: "var(--color-canvas)" }}
                    contentStyle={{ borderRadius: 10, border: "1px solid var(--color-line)", boxShadow: "var(--shadow-pop)", fontSize: 13 }}
                    labelStyle={{ color: "var(--color-ink)", fontWeight: 600 }} />
                  <Bar dataKey="new_prescriptions" name="New prescriptions" fill="var(--color-series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="refills" name="Refill requests" fill="var(--color-series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
      {data && <StatusBreakdown byStatus={data.by_status} />}
    </Card>
  );
}

function StatusBreakdown({ byStatus }: { byStatus: Record<string, number> }) {
  const order = ["active", "refill_due", "on_hold", "completed", "cancelled"];
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="border-t border-line px-5 py-4">
      <p className="text-[13px] font-medium mb-3">All prescriptions by status</p>
      <ul className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {order.map((s) => (
          <li key={s}>
            <Link to={`/prescriptions?status=${s}`} className="block group">
              <span className="text-[12.5px] text-ink-3 group-hover:text-ink">{humanize(s)}</span>
              <span className="block text-[18px] font-semibold tabular-nums">{(byStatus[s] ?? 0).toLocaleString()}</span>
              <span className="block h-1 mt-1 rounded-full bg-canvas overflow-hidden"><span className="block h-full bg-teal-600 rounded-full" style={{ width: `${((byStatus[s] ?? 0) / total) * 100}%` }} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TestHealth({ exec, loading }: { exec: Exec | null | undefined; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Latest test execution" description={exec ? `${exec.name} · ${timeAgo(exec.at)}` : "Manual runs and automated suites"} />
      <div className="px-5 pb-5">
        {loading ? <Skeleton className="h-24" /> : !exec ? (
          <EmptyState title="No executed tests yet" body="Pass rate appears after a QA engineer records results or uploads an automated report." />
        ) : (
          <>
            <p className="flex items-baseline gap-2">
              <span className="text-[34px] font-semibold tabular-nums leading-none">{exec.pass_rate}%</span>
              <span className="text-ink-3 text-[13px]">pass rate · {exec.executed} executed</span>
            </p>
            <p className="text-[12.5px] text-ink-3 mt-1 mb-4">Source: {exec.source === "manual" ? "manual test run" : `${exec.source} automated suite`}</p>
            <ResultBar passed={exec.passed} failed={exec.failed} blocked={exec.blocked} notRun={exec.not_run} />
          </>
        )}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const [days, setDays] = useState(30);
  const summary = useQuery({
    queryKey: ["summary", days],
    queryFn: () => api<Summary>("/dashboard/summary", { query: { from: todayISO(-(days - 1)), to: todayISO() } }),
  });
  const recent = useQuery({ queryKey: ["recent"], queryFn: () => api<Recent>("/dashboard/recent") });
  const s = summary.data;

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${user?.full_name.split(" ")[0]}`}
        description="Pharmacy activity, support load and test health at a glance."
        actions={
          <Select aria-label="Date range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
            {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </Select>
        } />
      {summary.error ? <div className="card"><ErrorState error={summary.error} onRetry={summary.refetch} /></div> : (
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          <KpiTile label="Active patients" kpi={s?.active_patients} to="/patients?status=active" loading={summary.isLoading} />
          <KpiTile label="Active prescriptions" kpi={s?.active_prescriptions} to="/prescriptions?status=active" loading={summary.isLoading} />
          <KpiTile label="Pending refill requests" kpi={s?.pending_refills} to="/prescriptions?tab=refills" loading={summary.isLoading} />
          <KpiTile label="Open support tickets" kpi={s?.open_tickets} to="/tickets" loading={summary.isLoading} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        <ActivityChart days={days} />
        <div className="space-y-4">
          <TestHealth exec={s?.latest_test_execution} loading={summary.isLoading} />
          {recent.data?.refills && (
            <Card>
              <CardHeader title="Oldest pending refills" action={<Link to="/prescriptions?tab=refills" className="link text-[13px]">Open queue</Link>} />
              <ul className="px-5 pb-4 divide-y divide-line">
                {recent.data.refills.length === 0 && <li className="py-3 text-[13px] text-ink-3">Queue is empty.</li>}
                {recent.data.refills.map((r) => (
                  <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                    <span className="min-w-0"><span className="block truncate text-[13.5px]">{r.medication} · {r.patient}</span><IdChip value={r.rx_code} /></span>
                    <span className="text-[12.5px] text-ink-3 whitespace-nowrap">{timeAgo(r.requested_at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <div className={cn("grid gap-4 mt-4", recent.data?.bugs ? "lg:grid-cols-2" : "")}>
        <Card>
          <CardHeader title={can("tickets:read_all") ? "Recent support tickets" : "Your recent tickets"} action={<Link to="/tickets" className="link text-[13px]">View all</Link>} />
          {recent.isLoading ? <div className="px-5 pb-5 space-y-3"><Skeleton /><Skeleton /><Skeleton /></div> :
            recent.data?.tickets.length === 0 ? <EmptyState title="No tickets yet" body="Tickets you create appear here." /> : (
              <ul className="px-5 pb-3 divide-y divide-line">
                {recent.data?.tickets.map((t) => (
                  <li key={t.id} className="py-2.5 flex items-center gap-3">
                    <IdChip value={t.ticket_code} to={`/tickets/${t.id}`} className="w-24 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[13.5px]">{t.subject}</span>
                    <PriorityBadge value={t.priority} />
                    <span className="hidden sm:block text-[12.5px] text-ink-3 w-24 text-right whitespace-nowrap">{timeAgo(t.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        {recent.data?.bugs && (
          <Card>
            <CardHeader title="Open bugs" action={<Link to="/qa?tab=bugs" className="link text-[13px]">View all</Link>} />
            {recent.data.bugs.length === 0 ? <EmptyState title="No open bugs" body="New and in-progress bugs appear here." /> : (
              <ul className="px-5 pb-3 divide-y divide-line">
                {recent.data.bugs.map((b) => (
                  <li key={b.id} className="py-2.5 flex items-center gap-3">
                    <IdChip value={b.bug_code} to={`/qa/bugs/${b.id}`} className="w-20 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[13.5px]">{b.title}</span>
                    <PriorityBadge value={b.severity} />
                    <StatusBadge status={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
