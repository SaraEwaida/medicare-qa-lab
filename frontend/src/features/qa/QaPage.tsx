import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState, IdChip, PageHeader, Pagination, PriorityBadge, ResultBar, SearchBox, StatusBadge, Table, TableSkeleton, Td, Th, useDebounced } from "@/components/common";
import { Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui";
import { ApiError, api, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { AutomationRun, Bug, TestCase, TestRun, TestRunDetail } from "@/lib/types";
import { fmtDate, fmtDateTime, humanize, timeAgo } from "@/lib/utils";

type Metrics = {
  test_cases: { total: number; automated: number; by_module: { module: string; count: number }[] };
  coverage: { covered_cases: number; total_cases: number; percent: number };
  latest_manual_run: (TestRun["stats"] & { id: number; name: string; started_at: string }) | null;
  latest_automation: { id: number; framework: string; suite_name: string; started_at: string; total: number; passed: number; failed: number; skipped: number; duration_ms: number; pass_rate: number | null }[];
  trend: { date: string; label: string; kind: string; run_type: string; pass_rate: number; executed: number }[];
  open_bugs_by_severity: Record<string, number>;
  bugs_by_status: Record<string, number>;
};

export const MODULES = ["auth", "patients", "prescriptions", "refills", "tickets", "qa", "api", "dashboard", "security"];

function Overview() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["qa-metrics"], queryFn: () => api<Metrics>("/qa/metrics") });
  if (error) return <div className="card"><ErrorState error={error} onRetry={refetch} /></div>;
  if (isLoading || !data) return <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>;
  const trend = data.trend.map((t) => ({ ...t, x: fmtDate(t.date).replace(/, \d{4}$/, "") }));
  const maxModule = Math.max(1, ...data.test_cases.by_module.map((m) => m.count));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="px-5 py-4">
          <p className="text-[13px] text-ink-2">Test cases</p>
          <p className="text-[30px] font-semibold tabular-nums">{data.test_cases.total}</p>
          <p className="text-[12.5px] text-ink-3">{data.test_cases.automated} declared as automated</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-[13px] text-ink-2">Automation coverage</p>
          <p className="text-[30px] font-semibold tabular-nums">{data.coverage.percent}%</p>
          <div className="h-1.5 mt-1 rounded-full bg-canvas overflow-hidden"><div className="h-full bg-teal-600 rounded-full" style={{ width: `${data.coverage.percent}%` }} /></div>
          <p className="text-[12.5px] text-ink-3 mt-1">{data.coverage.covered_cases} of {data.coverage.total_cases} cases linked to an executed automated test</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-[13px] text-ink-2">Open bugs by severity</p>
          <ul className="mt-2 grid grid-cols-4 gap-2">
            {["critical", "major", "minor", "trivial"].map((s) => (
              <li key={s}><span className="block text-[22px] font-semibold tabular-nums">{data.open_bugs_by_severity[s] ?? 0}</span><span className="text-[12px] text-ink-3">{humanize(s)}</span></li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Pass rate over time" description="Manual runs and uploaded automated suites, from recorded results" />
          <div className="px-3 pb-4">
            {trend.length === 0 ? <EmptyState title="No executions yet" body="Start a test run and record results, or upload an automated report." /> : (
              <div className="h-60" role="img" aria-label={`Pass rate trend across ${trend.length} executions`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="x" tickLine={false} axisLine={{ stroke: "var(--color-line-strong)" }} tick={{ fill: "var(--color-ink-3)", fontSize: 12 }} minTickGap={16} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={{ fill: "var(--color-ink-3)", fontSize: 12 }} width={44} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--color-line)", fontSize: 13 }}
                      formatter={(v) => [`${v}%`, "Pass rate"]}
                      labelFormatter={(_, p) => { const d = p?.[0]?.payload; return d ? `${d.label} (${d.kind}, ${d.executed} executed)` : ""; }} />
                    <Line type="monotone" dataKey="pass_rate" stroke="var(--color-teal-600)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Cases by module" />
          <ul className="px-5 pb-5 space-y-2">
            {data.test_cases.by_module.map((m) => (
              <li key={m.module} className="grid grid-cols-[96px_1fr_28px] items-center gap-2 text-[13px]">
                <span className="text-ink-2">{humanize(m.module)}</span>
                <span className="h-2 rounded-full bg-canvas overflow-hidden"><span className="block h-full rounded-full bg-sky-600" style={{ width: `${(m.count / maxModule) * 100}%` }} /></span>
                <span className="tabular-nums text-right">{m.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Latest manual run" action={data.latest_manual_run && <Link className="link text-[13px]" to={`/qa/runs/${data.latest_manual_run.id}`}>Open run</Link>} />
          <div className="px-5 pb-5">
            {!data.latest_manual_run ? <EmptyState title="No manual runs yet" body="Create a run from the Test runs tab and record results as you execute each case." /> : (
              <>
                <p className="text-[13.5px] font-medium">{data.latest_manual_run.name}</p>
                <p className="text-[12.5px] text-ink-3 mb-3">{timeAgo(data.latest_manual_run.started_at)} · {data.latest_manual_run.progress}% executed · pass rate {data.latest_manual_run.pass_rate ?? "—"}{data.latest_manual_run.pass_rate !== null && "%"}</p>
                <ResultBar passed={data.latest_manual_run.passed} failed={data.latest_manual_run.failed} blocked={data.latest_manual_run.blocked} notRun={data.latest_manual_run.not_run} />
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Latest automated suites" />
          {data.latest_automation.length === 0 ? <EmptyState icon={<Bot className="size-6" />} title="No automated reports uploaded" body="Run scripts/run_all_tests.sh to execute pytest, Playwright and Newman and upload their real results." /> : (
            <ul className="px-5 pb-4 divide-y divide-line">
              {data.latest_automation.map((a) => (
                <li key={a.id} className="py-3 flex items-center gap-3">
                  <Badge tone="teal">{a.framework}</Badge>
                  <Link to={`/qa/automation/${a.id}`} className="flex-1 min-w-0 truncate text-[13.5px] link">{a.suite_name}</Link>
                  <span className="text-[13px] tabular-nums">{a.passed}/{a.passed + a.failed} passed</span>
                  <span className="hidden sm:block text-[12.5px] text-ink-3 w-20 text-right">{timeAgo(a.started_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function CasesTab() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [module, setModule] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q.trim());
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["test-cases", dq, module, page],
    queryFn: () => api<Page<TestCase>>("/qa/test-cases", { query: { q: dq, module, page, page_size: 20 } }),
    placeholderData: (p) => p,
  });
  return (
    <Card>
      <div className="flex flex-wrap gap-3 p-4">
        <SearchBox className="flex-1 min-w-[220px]" label="Search test cases" placeholder="TC code or title" value={q} onChange={(v) => { setQ(v); setPage(1); }} />
        <Select aria-label="Module" value={module} onChange={(e) => { setModule(e.target.value); setPage(1); }} className="w-auto">
          <option value="">All modules</option>{MODULES.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
        </Select>
        {can("qa:write") && <Button onClick={() => setCreating(true)}><Plus className="size-4" />New test case</Button>}
      </div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          <Table>
            <thead><tr><Th>Case</Th><Th>Title</Th><Th>Module</Th><Th>Type</Th><Th>Priority</Th><Th>Automated</Th><Th>Last result</Th></tr></thead>
            {isLoading ? <TableSkeleton cols={7} /> : (
              <tbody>
                {data?.items.length === 0 && <tr><Td colSpan={7}><EmptyState title="No test cases match" /></Td></tr>}
                {data?.items.map((c) => (
                  <tr key={c.id} className="hover:bg-canvas/60 cursor-pointer" onClick={() => nav(`/qa/cases/${c.id}`)}>
                    <Td><IdChip value={c.case_code} to={`/qa/cases/${c.id}`} /></Td>
                    <Td className="font-medium max-w-[380px]">{c.title}</Td>
                    <Td className="text-ink-2">{humanize(c.module)}</Td>
                    <Td className="text-ink-2">{humanize(c.type)}</Td>
                    <Td><PriorityBadge value={c.priority} /></Td>
                    <Td>{c.is_automated ? <Badge tone="teal">Automated</Badge> : <span className="text-ink-3">Manual</span>}</Td>
                    <Td>{c.last_status ? <StatusBadge status={c.last_status} /> : <span className="text-ink-3">Never run</span>}</Td>
                  </tr>
                ))}
              </tbody>
            )}
          </Table>
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
        </>
      )}
      {creating && <TestCaseDialog onClose={() => setCreating(false)} onSaved={(c) => nav(`/qa/cases/${c.id}`)} />}
    </Card>
  );
}

export function TestCaseDialog({ initial, onClose, onSaved }: { initial?: TestCase; onClose: () => void; onSaved: (c: TestCase) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ title: initial?.title ?? "", module: initial?.module ?? "patients", type: initial?.type ?? "functional",
    priority: initial?.priority ?? "p2", preconditions: initial?.preconditions ?? "", expected_result: initial?.expected_result ?? "",
    is_automated: initial?.is_automated ?? false, automation_ref: initial?.automation_ref ?? "" });
  const [steps, setSteps] = useState(initial?.steps.map((s) => ({ action: s.action, expected: s.expected ?? "" })) ?? [{ action: "", expected: "" }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => initial ? api<TestCase>(`/qa/test-cases/${initial.id}`, { method: "PUT", body }) : api<TestCase>("/qa/test-cases", { method: "POST", body }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["test-cases"] }); qc.invalidateQueries({ queryKey: ["qa-metrics"] }); qc.setQueryData(["test-case", String(c.id)], c); notifyOk(initial ? "Test case updated" : `${c.case_code} created`); onSaved(c); onClose(); },
    onError: (e) => (e instanceof ApiError && e.status === 422 ? setErrors(e.fieldErrors()) : notifyError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.title.trim().length < 5) errs.title = "Title must be at least 5 characters.";
    if (v.expected_result.trim().length < 3) errs.expected_result = "Describe the expected result.";
    const clean = steps.filter((s) => s.action.trim());
    if (!clean.length) errs.steps = "Add at least one step.";
    if (clean.some((s) => s.action.trim().length < 3)) errs.steps = "Each step needs an action of at least 3 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    m.mutate({ ...v, title: v.title.trim(), preconditions: v.preconditions.trim() || null, automation_ref: v.automation_ref.trim() || null,
      steps: clean.map((s) => ({ action: s.action.trim(), expected: s.expected.trim() || null })) });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={initial ? `Edit ${initial.case_code}` : "New test case"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="tc-form" loading={m.isPending}>{initial ? "Save changes" : "Create test case"}</Button></>}>
      <form id="tc-form" noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Field label="Title" required error={errors.title} className="sm:col-span-3">{(a) => <Input {...a} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
        <Field label="Module">{(a) => <Select {...a} value={v.module} onChange={(e) => setV({ ...v, module: e.target.value })}>{MODULES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>}</Field>
        <Field label="Type">{(a) => <Select {...a} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as TestCase["type"] })}>{["functional", "regression", "smoke", "api", "security", "usability"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>}</Field>
        <Field label="Priority">{(a) => <Select {...a} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value as TestCase["priority"] })}>{["p1", "p2", "p3", "p4"].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</Select>}</Field>
        <Field label="Preconditions" className="sm:col-span-3">{(a) => <Textarea {...a} rows={2} value={v.preconditions} onChange={(e) => setV({ ...v, preconditions: e.target.value })} />}</Field>
        <fieldset className="sm:col-span-3 grid gap-2">
          <legend className="text-[13px] font-medium mb-1">Steps <span className="text-bad-700">*</span></legend>
          {steps.map((s, i) => (
            <div key={i} className="grid grid-cols-[24px_1fr_1fr_auto] gap-2 items-start">
              <span className="pt-2 text-[12.5px] text-ink-3 tabular-nums">{i + 1}.</span>
              <Input aria-label={`Step ${i + 1} action`} placeholder="Action" value={s.action} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, action: e.target.value } : x))} />
              <Input aria-label={`Step ${i + 1} expected`} placeholder="Expected (optional)" value={s.expected} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, expected: e.target.value } : x))} />
              <Button variant="ghost" size="sm" aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          {errors.steps && <p role="alert" className="text-[12.5px] text-bad-700">{errors.steps}</p>}
          <Button variant="link" size="sm" className="justify-start" onClick={() => setSteps([...steps, { action: "", expected: "" }])}>Add step</Button>
        </fieldset>
        <Field label="Expected result" required error={errors.expected_result} className="sm:col-span-3">{(a) => <Textarea {...a} rows={2} value={v.expected_result} onChange={(e) => setV({ ...v, expected_result: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-1"><input type="checkbox" className="size-4 accent-teal-600" checked={v.is_automated} onChange={(e) => setV({ ...v, is_automated: e.target.checked })} />Covered by automation</label>
        {v.is_automated && <Field label="Automation reference" className="sm:col-span-2">{(a) => <Input {...a} className="font-mono text-[12.5px]" value={v.automation_ref} onChange={(e) => setV({ ...v, automation_ref: e.target.value })} placeholder="e2e/tests/refills.spec.ts" />}</Field>}
      </form>
    </Dialog>
  );
}

function RunsTab() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["test-runs", page], queryFn: () => api<Page<TestRun>>("/qa/test-runs", { query: { page, page_size: 15 } }) });
  return (
    <Card>
      <CardHeader title="Test runs" description="A run is one execution of selected test cases in an environment."
        action={can("qa:write") && <Button onClick={() => setCreating(true)}><Plus className="size-4" />New run</Button>} />
      {error ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          <Table>
            <thead><tr><Th>Run</Th><Th>Type</Th><Th>Environment</Th><Th>Progress</Th><Th>Pass rate</Th><Th>Started</Th><Th>State</Th></tr></thead>
            {isLoading ? <TableSkeleton cols={7} /> : (
              <tbody>
                {data?.items.length === 0 && <tr><Td colSpan={7}><EmptyState title="No test runs yet" body="Create a run, then execute each case and record what actually happened." action={can("qa:write") && <Button size="sm" onClick={() => setCreating(true)}>New run</Button>} /></Td></tr>}
                {data?.items.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas/60 cursor-pointer" onClick={() => nav(`/qa/runs/${r.id}`)}>
                    <Td className="font-medium"><Link to={`/qa/runs/${r.id}`} className="hover:underline">{r.name}</Link>{r.build_version && <span className="block id-chip text-ink-3">{r.build_version}</span>}</Td>
                    <Td className="text-ink-2">{humanize(r.run_type)}</Td>
                    <Td className="text-ink-2">{r.environment}</Td>
                    <Td className="tabular-nums">{r.stats.executed}/{r.stats.total}</Td>
                    <Td className="tabular-nums">{r.stats.pass_rate === null ? "—" : `${r.stats.pass_rate}%`}</Td>
                    <Td className="text-ink-2 whitespace-nowrap">{fmtDateTime(r.started_at)}</Td>
                    <Td>{r.completed_at ? <Badge tone="neutral">Completed</Badge> : <Badge tone="info" dot>In progress</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            )}
          </Table>
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
        </>
      )}
      {creating && <NewRunDialog onClose={() => setCreating(false)} />}
    </Card>
  );
}

function NewRunDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const cases = useQuery({ queryKey: ["test-cases", "all"], queryFn: () => api<Page<TestCase>>("/qa/test-cases", { query: { page_size: 100 } }) });
  const [name, setName] = useState(`Regression run · ${fmtDate(new Date().toISOString())}`);
  const [runType, setRunType] = useState("regression");
  const [env, setEnv] = useState(window.location.hostname === "localhost" ? "local" : "demo");
  const [build, setBuild] = useState("1.0.0");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () => api<TestRunDetail>("/qa/test-runs", { method: "POST", body: { name: name.trim(), run_type: runType, environment: env.trim(), build_version: build.trim() || null, test_case_ids: [...selected] } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["test-runs"] }); notifyOk("Test run created", `${r.stats.total} cases to execute`); nav(`/qa/runs/${r.id}`); },
    onError: (e) => notifyError(e),
  });
  const all = cases.data?.items ?? [];
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="New test run" description="Choose the cases to execute in this run."
      footer={<><span className="mr-auto self-center text-[13px] text-ink-3">{selected.size} selected</span><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={m.isPending} onClick={() => { if (!selected.size) { setError("Select at least one test case."); return; } if (name.trim().length < 3) { setError("Name the run."); return; } m.mutate(); }}>Create run</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Run name" required className="sm:col-span-2">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Run type">{(a) => <Select {...a} value={runType} onChange={(e) => setRunType(e.target.value)}>{["regression", "smoke", "functional", "security", "api"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>}</Field>
        <Field label="Environment">{(a) => <Input {...a} value={env} onChange={(e) => setEnv(e.target.value)} />}</Field>
        <Field label="Build version" hint="Optional">{(a) => <Input {...a} value={build} onChange={(e) => setBuild(e.target.value)} />}</Field>
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-medium">Test cases</p>
            <div className="flex gap-3 text-[13px]">
              <button type="button" className="link" onClick={() => setSelected(new Set(all.map((c) => c.id)))}>Select all</button>
              <button type="button" className="link" onClick={() => setSelected(new Set(all.filter((c) => c.type === "regression" || c.priority === "p1").map((c) => c.id)))}>P1 + regression</button>
              <button type="button" className="link" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
          <ul className="max-h-64 overflow-y-auto rounded-xl border border-line divide-y divide-line">
            {all.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-3 px-3 py-2 hover:bg-canvas cursor-pointer text-[13px]">
                  <input type="checkbox" className="size-4 accent-teal-600" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="id-chip w-14">{c.case_code}</span><span className="flex-1">{c.title}</span><PriorityBadge value={c.priority} />
                </label>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-[12.5px] text-bad-700 mt-2">{error}</p>}
        </div>
      </div>
    </Dialog>
  );
}

function BugsTab() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q.trim());
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["bugs", dq, status, severity, page],
    queryFn: () => api<Page<Bug>>("/qa/bugs", { query: { q: dq, status: status ? [status] : [], severity, page, page_size: 15 } }),
    placeholderData: (p) => p,
  });
  return (
    <Card>
      <div className="flex flex-wrap gap-3 p-4">
        <SearchBox className="flex-1 min-w-[220px]" label="Search bugs" placeholder="BUG code or title" value={q} onChange={(v) => { setQ(v); setPage(1); }} />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-auto">
          <option value="">All statuses</option>{["new", "confirmed", "in_progress", "fixed", "verified", "closed", "wont_fix"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
        <Select aria-label="Severity" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} className="w-auto">
          <option value="">Any severity</option>{["critical", "major", "minor", "trivial"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
        {can("bugs:create") && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Report bug</Button>}
      </div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          <Table>
            <thead><tr><Th>Bug</Th><Th>Title</Th><Th>Severity</Th><Th>Priority</Th><Th>Status</Th><Th>Source</Th><Th>Reported</Th></tr></thead>
            {isLoading ? <TableSkeleton cols={7} /> : (
              <tbody>
                {data?.items.length === 0 && <tr><Td colSpan={7}><EmptyState title="No bugs match" /></Td></tr>}
                {data?.items.map((b) => (
                  <tr key={b.id} className="hover:bg-canvas/60 cursor-pointer" onClick={() => nav(`/qa/bugs/${b.id}`)}>
                    <Td><IdChip value={b.bug_code} to={`/qa/bugs/${b.id}`} /></Td>
                    <Td className="font-medium max-w-[360px]">{b.title}</Td>
                    <Td><PriorityBadge value={b.severity} /></Td>
                    <Td><PriorityBadge value={b.priority} /></Td>
                    <Td><StatusBadge status={b.status} /></Td>
                    <Td className="text-ink-2 text-[12.5px]">{b.demo_bug_key ? "Bug Lab" : b.source_ticket_code ? b.source_ticket_code : b.source_result_id ? "Test run" : "Direct"}</Td>
                    <Td className="text-ink-2 whitespace-nowrap">{timeAgo(b.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            )}
          </Table>
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
        </>
      )}
      {creating && <BugDialog onClose={() => setCreating(false)} onSaved={(b) => nav(`/qa/bugs/${b.id}`)} />}
    </Card>
  );
}

export function BugDialog({ onClose, onSaved, prefill }: {
  onClose: () => void; onSaved: (b: Bug) => void;
  prefill?: { title?: string; source_result_id?: number; regression_case_id?: number; actual_behavior?: string; expected_behavior?: string; steps_to_reproduce?: string; environment?: string };
}) {
  const qc = useQueryClient();
  const [v, setV] = useState({ title: prefill?.title ?? "", description: "", environment: prefill?.environment ?? `${window.location.host} · ${navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/\d+/)?.[0] ?? "browser"}`,
    preconditions: "", steps_to_reproduce: prefill?.steps_to_reproduce ?? "", expected_behavior: prefill?.expected_behavior ?? "", actual_behavior: prefill?.actual_behavior ?? "",
    severity: "major", priority: "p2" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () => api<Bug>("/qa/bugs", { method: "POST", body: { ...v, preconditions: v.preconditions.trim() || null,
      source_result_id: prefill?.source_result_id ?? null, regression_case_id: prefill?.regression_case_id ?? null } }),
    onSuccess: (b) => { qc.invalidateQueries({ queryKey: ["bugs"] }); qc.invalidateQueries({ queryKey: ["test-run"] }); notifyOk(`${b.bug_code} reported`); onSaved(b); onClose(); },
    onError: (e) => (e instanceof ApiError && e.status === 422 ? setErrors(e.fieldErrors()) : notifyError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.title.trim().length < 5) errs.title = "At least 5 characters.";
    if (v.description.trim().length < 5) errs.description = "Describe the problem.";
    if (v.steps_to_reproduce.trim().length < 5) errs.steps_to_reproduce = "List the steps to reproduce.";
    if (v.expected_behavior.trim().length < 3) errs.expected_behavior = "Required.";
    if (v.actual_behavior.trim().length < 3) errs.actual_behavior = "Required.";
    setErrors(errs);
    if (!Object.keys(errs).length) m.mutate();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="Report a bug" description="Write it so someone else can reproduce it without asking you."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="bug-form" loading={m.isPending}>Report bug</Button></>}>
      <form id="bug-form" noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required error={errors.title} className="sm:col-span-2">{(a) => <Input {...a} value={v.title} onChange={set("title")} placeholder="Specific symptom + where, e.g. Refill queue shows stale status after approval" />}</Field>
        <Field label="Severity" hint="Impact on users">{(a) => <Select {...a} value={v.severity} onChange={set("severity")}>{["critical", "major", "minor", "trivial"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>}</Field>
        <Field label="Priority" hint="Order of fixing">{(a) => <Select {...a} value={v.priority} onChange={set("priority")}>{["p1", "p2", "p3", "p4"].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</Select>}</Field>
        <Field label="Description" required error={errors.description} className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={v.description} onChange={set("description")} />}</Field>
        <Field label="Environment" required className="sm:col-span-2">{(a) => <Input {...a} value={v.environment} onChange={set("environment")} />}</Field>
        <Field label="Preconditions" className="sm:col-span-2">{(a) => <Input {...a} value={v.preconditions} onChange={set("preconditions")} />}</Field>
        <Field label="Steps to reproduce" required error={errors.steps_to_reproduce} className="sm:col-span-2">{(a) => <Textarea {...a} rows={4} value={v.steps_to_reproduce} onChange={set("steps_to_reproduce")} placeholder={"1. …\n2. …"} />}</Field>
        <Field label="Expected" required error={errors.expected_behavior}>{(a) => <Textarea {...a} rows={3} value={v.expected_behavior} onChange={set("expected_behavior")} />}</Field>
        <Field label="Actual" required error={errors.actual_behavior}>{(a) => <Textarea {...a} rows={3} value={v.actual_behavior} onChange={set("actual_behavior")} />}</Field>
      </form>
    </Dialog>
  );
}

function AutomationTab() {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["automation", page], queryFn: () => api<Page<AutomationRun>>("/qa/automation-runs", { query: { page, page_size: 15 } }) });
  return (
    <Card>
      <CardHeader title="Automated test results" description="Uploaded from real pytest, Playwright and Newman executions. Nothing here is typed in by hand." />
      {error ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          <Table>
            <thead><tr><Th>Suite</Th><Th>Framework</Th><Th>Result</Th><Th>Duration</Th><Th>Commit</Th><Th>Executed</Th></tr></thead>
            {isLoading ? <TableSkeleton cols={6} /> : (
              <tbody>
                {data?.items.length === 0 && <tr><Td colSpan={6}><EmptyState icon={<Bot className="size-6" />} title="No reports uploaded yet" body="Run scripts/run_all_tests.sh; it executes the suites and uploads their results here." /></Td></tr>}
                {data?.items.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas/60 cursor-pointer" onClick={() => nav(`/qa/automation/${r.id}`)}>
                    <Td className="font-medium">{r.suite_name}</Td>
                    <Td><Badge tone="teal">{r.framework}</Badge></Td>
                    <Td className="tabular-nums"><span className="text-ok-700">{r.passed} passed</span>{r.failed > 0 && <span className="text-bad-700"> · {r.failed} failed</span>}{r.skipped > 0 && <span className="text-ink-3"> · {r.skipped} skipped</span>}</Td>
                    <Td className="tabular-nums text-ink-2">{(r.duration_ms / 1000).toFixed(1)} s</Td>
                    <Td>{r.commit_sha ? <span className="id-chip">{r.commit_sha.slice(0, 7)}</span> : "—"}</Td>
                    <Td className="text-ink-2 whitespace-nowrap">{fmtDateTime(r.started_at)}</Td>
                  </tr>
                ))}
              </tbody>
            )}
          </Table>
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
        </>
      )}
    </Card>
  );
}

export default function QaPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  return (
    <>
      <PageHeader title="QA Lab" description="Test cases, executions, bug reports and automated results, all backed by recorded data." />
      <Tabs value={tab} onValueChange={(t) => setParams(t === "overview" ? {} : { tab: t }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="cases">Test cases</TabsTrigger>
          <TabsTrigger value="runs">Test runs</TabsTrigger>
          <TabsTrigger value="bugs">Bug reports</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="cases"><CasesTab /></TabsContent>
        <TabsContent value="runs"><RunsTab /></TabsContent>
        <TabsContent value="bugs"><BugsTab /></TabsContent>
        <TabsContent value="automation"><AutomationTab /></TabsContent>
      </Tabs>
    </>
  );
}
