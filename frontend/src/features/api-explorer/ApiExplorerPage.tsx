import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Play, XCircle } from "lucide-react";
import { Fragment, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, IdChip, PageHeader, Pagination, Table, TableSkeleton, Td, Th } from "@/components/common";
import { Badge, Button, Card, CardHeader, Input, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui";
import { ApiError, api, requestWithMeta, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AuditEntry, LogEntry } from "@/lib/types";
import { ROLE_LABEL, cn, fmtFull, humanize, timeAgo } from "@/lib/utils";

const statusTone = (s: number | null) => (s === null ? "neutral" : s >= 500 ? "bad" : s >= 400 ? "warn" : "ok") as "neutral" | "bad" | "warn" | "ok";

function Json({ value, className }: { value: unknown; className?: string }) {
  return <pre className={cn("rounded-xl bg-slab text-teal-50 p-4 text-[12.5px] font-mono leading-relaxed overflow-auto max-h-96", className)}>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

function LogsTab({ onTrace }: { onTrace: (rid: string) => void }) {
  const [statusClass, setStatusClass] = useState("");
  const [path, setPath] = useState("");
  const [level, setLevel] = useState("");
  const [demo, setDemo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const stats = useQuery({ queryKey: ["log-stats"], queryFn: () => api<{ last_24h: Record<string, number>; top_errors: { path: string; status_code: number; n: number }[] }>("/logs/stats") });
  const logs = useQuery({
    queryKey: ["logs", statusClass, path, level, demo, page], refetchInterval: 15_000,
    queryFn: () => api<Page<LogEntry>>("/logs", { query: { status_class: statusClass, path, level, demo, page, page_size: 25 } }),
    placeholderData: (p) => p,
  });
  const s = stats.data?.last_24h;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        {[["Requests (24 h)", s?.total], ["Server errors", s?.server_errors], ["Client errors", s?.client_errors], ["Validation failures", s?.validation_failures], ["p95 response", s ? `${Math.round(s.p95_ms)} ms` : undefined]].map(([k, v]) => (
          <Card key={k as string} className="px-4 py-3"><p className="text-[12.5px] text-ink-2">{k}</p><p className="text-[22px] font-semibold tabular-nums">{v ?? "—"}</p></Card>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap gap-3 p-4">
          <Input aria-label="Filter by path" placeholder="Path contains, e.g. /refill-requests" value={path} onChange={(e) => { setPath(e.target.value); setPage(1); }} className="flex-1 min-w-[200px]" />
          <Select aria-label="Status class" value={statusClass} onChange={(e) => { setStatusClass(e.target.value); setPage(1); }} className="w-auto">
            <option value="">All statuses</option><option value="2xx">2xx success</option><option value="4xx">4xx client errors</option><option value="5xx">5xx server errors</option>
          </Select>
          <Select aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }} className="w-auto">
            <option value="">All levels</option><option>INFO</option><option>WARNING</option><option>ERROR</option>
          </Select>
          <Select aria-label="Origin" value={demo} onChange={(e) => { setDemo(e.target.value); setPage(1); }} className="w-auto">
            <option value="">All traffic</option><option value="false">Application</option><option value="true">Bug Lab</option>
          </Select>
        </div>
        <p className="px-4 pb-3 text-[12.5px] text-ink-3">Logs are redacted before storage: search terms, names, emails and phone numbers never appear. Refreshes every 15 seconds.</p>
        {logs.error ? <ErrorState error={logs.error} onRetry={logs.refetch} /> : (
          <>
            <Table>
              <thead><tr><Th>Time</Th><Th>Request</Th><Th>Status</Th><Th>Duration</Th><Th>Role</Th><Th>Request ID</Th></tr></thead>
              {logs.isLoading ? <TableSkeleton cols={6} /> : (
                <tbody>
                  {logs.data?.items.length === 0 && <tr><Td colSpan={6}><EmptyState title="No log entries match" /></Td></tr>}
                  {logs.data?.items.map((l) => (
                    <Fragment key={l.id}>
                      <tr className="hover:bg-canvas/60 cursor-pointer" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                        <Td className="whitespace-nowrap text-ink-2 text-[12.5px]">{timeAgo(l.ts)}</Td>
                        <Td><span className="font-mono text-[12.5px]"><span className="font-semibold">{l.method}</span> {l.path}</span>{l.is_demo && <Badge tone="teal" className="ml-2">Bug Lab</Badge>}</Td>
                        <Td><Badge tone={statusTone(l.status_code)}>{l.status_code}</Badge></Td>
                        <Td className="tabular-nums text-ink-2">{l.duration_ms} ms</Td>
                        <Td className="text-ink-2">{l.user_role ? ROLE_LABEL[l.user_role] : "Anonymous"}</Td>
                        <Td>{l.request_id && <IdChip value={l.request_id} />}</Td>
                      </tr>
                      {open === l.id && (
                        <tr><Td colSpan={6} className="bg-canvas/50">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <p className="text-[12.5px] text-ink-3">{fmtFull(l.ts)} · level {l.level}</p>
                            {l.request_id && <Button size="sm" variant="secondary" onClick={() => onTrace(l.request_id!)}>Open trace</Button>}
                          </div>
                          <Json value={{ message: l.message, ...l.context }} />
                        </Td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              )}
            </Table>
            {logs.data && <Pagination page={logs.data.page} pageSize={logs.data.page_size} total={logs.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      {stats.data && stats.data.top_errors.length > 0 && (
        <Card>
          <CardHeader title="Most frequent errors (24 h)" />
          <ul className="px-5 pb-4 divide-y divide-line">
            {stats.data.top_errors.map((e) => <li key={e.path + e.status_code} className="py-2 flex items-center gap-3 text-[13px]"><Badge tone={statusTone(e.status_code)}>{e.status_code}</Badge><span className="font-mono flex-1 truncate">{e.path}</span><span className="tabular-nums">{e.n}×</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Trace = { request_id: string; found: boolean; logs: LogEntry[]; audit: AuditEntry[] };
function TraceTab({ initial }: { initial: string }) {
  const [rid, setRid] = useState(initial);
  const [query, setQuery] = useState(initial);
  const t = useQuery({ queryKey: ["trace", query], enabled: Boolean(query), queryFn: () => api<Trace>(`/logs/requests/${encodeURIComponent(query)}`) });
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setQuery(rid.trim()); }}>
          <Input aria-label="Request ID" className="flex-1 min-w-[240px] font-mono" placeholder="Paste a request ID, e.g. req_3fa1c0d2e4b5a6f7" value={rid} onChange={(e) => setRid(e.target.value)} />
          <Button type="submit">Trace request</Button>
        </form>
        <p className="text-[12.5px] text-ink-3 mt-2">Every error message in the app shows its request ID. Paste it here to see what the server recorded for that request.</p>
      </Card>
      {t.isLoading && query && <Spinner label="Looking up request" />}
      {t.error && <Card><ErrorState error={t.error} /></Card>}
      {t.data && !t.data.found && <Card><EmptyState title="No records for this request ID" body="Check for typos. Requests older than the retention window (14 days) are removed, and the ID in some tickets is from the customer's own system." /></Card>}
      {t.data?.found && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Request log" />
            <div className="px-5 pb-5 space-y-3">
              {t.data.logs.map((l) => (
                <div key={l.id} className="space-y-2">
                  <p className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(l.status_code)}>{l.status_code}</Badge><span className="font-mono text-[13px]">{l.method} {l.path}</span><span className="text-ink-3 text-[12.5px]">{l.duration_ms} ms · {fmtFull(l.ts)}</span></p>
                  <Json value={{ level: l.level, role: l.user_role, user_id: l.user_id, ...l.context }} />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Data changes (audit)" description="Writes performed while handling this request" />
            <div className="px-5 pb-5">
              {t.data.audit.length === 0 ? <p className="text-[13px] text-ink-3">This request didn't change any data.</p> : t.data.audit.map((a) => (
                <div key={a.id} className="mb-3">
                  <p className="text-[13px]"><span className="font-medium">{a.actor?.full_name ?? "System"}</span> {a.action} {humanize(a.entity_type)} <span className="font-mono">{a.entity_id}</span></p>
                  <Json value={a.changes} className="mt-1" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

type Example = { group: string; title: string; method: string; path: string; body?: unknown; note: string; noAuth?: boolean; headers?: Record<string, string> };
const EXAMPLES: Example[] = [
  { group: "System", title: "Health check", method: "GET", path: "/health", note: "Liveness and database connectivity. No auth required.", noAuth: true },
  { group: "System", title: "Current user and permissions", method: "GET", path: "/auth/me", note: "200 with the permission list used to build navigation." },
  { group: "System", title: "Call without a token", method: "GET", path: "/patients", note: "401 UNAUTHORIZED. The error body repeats the request ID.", noAuth: true },
  { group: "Patients", title: "Search patients", method: "GET", path: "/patients?q=turner&page_size=3", note: "Paginated envelope: items, total, page, page_size." },
  { group: "Patients", title: "Validation failure", method: "POST", path: "/patients", body: { first_name: "", last_name: "Test", date_of_birth: "2999-01-01", email: "not-an-email" }, note: "422 VALIDATION_ERROR with one detail per invalid field." },
  { group: "Patients", title: "Duplicate patient", method: "POST", path: "/patients", body: { first_name: "john", last_name: "TURNER", date_of_birth: "1985-06-14" }, note: "409 PATIENT_DUPLICATE — the same name and date of birth already exist (case-insensitive)." },
  { group: "Patients", title: "Unknown patient", method: "GET", path: "/patients/999999", note: "404 NOT_FOUND." },
  { group: "Prescriptions", title: "Quantity above the limit", method: "POST", path: "/prescriptions", body: { patient_id: 1, medication_id: 8, prescriber_name: "Dr. Test", dosage_instructions: "daily", quantity: 1001, refills_authorized: 1, start_date: "2026-11-01" }, note: "422 on 'quantity' (allowed 1–1000)." },
  { group: "Prescriptions", title: "Pending refill queue", method: "GET", path: "/refill-requests?status=pending&page_size=3", note: "Oldest-first review queue." },
  { group: "Prescriptions", title: "Approve a refill (role check)", method: "POST", path: "/refill-requests/1/approve", note: "Only pharmacists may approve: other roles get 403 FORBIDDEN and an audit entry. Refill 1 is already processed, so pharmacists get 409 INVALID_TRANSITION." },
  { group: "Support", title: "Open tickets", method: "GET", path: "/tickets?status=open&status=escalated&page_size=3", note: "Repeated query parameters filter by several statuses." },
  { group: "Support", title: "Invalid status transition", method: "POST", path: "/tickets/1/status", body: { status: "closed" }, note: "409 INVALID_TRANSITION lists the allowed next statuses (support role)." },
  { group: "QA", title: "QA metrics", method: "GET", path: "/qa/metrics", note: "Computed from recorded executions only." },
  { group: "QA", title: "Bad sort field", method: "GET", path: "/patients?sort=password", note: "422 — sorting is restricted to an allow-list." },
  { group: "Diagnostics", title: "Database consistency checks", method: "GET", path: "/diagnostics/db-checks", note: "Read-only SQL checks; each returns the rows that break a rule." },
];

function ConsoleTab() {
  const { can } = useAuth();
  const [sel, setSel] = useState(0);
  const ex = EXAMPLES[sel];
  const [method, setMethod] = useState(ex.method);
  const [path, setPath] = useState(ex.path);
  const [body, setBody] = useState(ex.body ? JSON.stringify(ex.body, null, 2) : "");
  const [noAuth, setNoAuth] = useState(Boolean(ex.noAuth));
  const choose = (i: number) => { const e = EXAMPLES[i]; setSel(i); setMethod(e.method); setPath(e.path); setBody(e.body ? JSON.stringify(e.body, null, 2) : ""); setNoAuth(Boolean(e.noAuth)); send.reset(); };
  const send = useMutation({
    mutationFn: async () => {
      try {
        const r = await requestWithMeta<unknown>(path, { method, rawBody: method !== "GET" && body.trim() ? body : undefined, headers: noAuth ? { Authorization: "" } : undefined });
        return { status: r.meta.status, ms: r.meta.durationMs, rid: r.meta.requestId, body: r.data, headers: r.meta.headers };
      } catch (e) {
        if (e instanceof ApiError) return { status: e.status, ms: null, rid: e.requestId, body: { error: { code: e.code, message: e.message, details: e.details, request_id: e.requestId } }, headers: {} };
        throw e;
      }
    },
  });
  const groups = [...new Set(EXAMPLES.map((e) => e.group))];
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card className="p-2 h-fit">
        {groups.map((g) => (
          <div key={g} className="mb-2">
            <p className="px-3 pt-2 pb-1 text-[12px] text-ink-3">{g}</p>
            {EXAMPLES.map((e, i) => e.group === g && (
              <button key={i} type="button" onClick={() => choose(i)} className={cn("w-full text-left rounded-lg px-3 py-1.5 text-[13px] flex items-center gap-2", i === sel ? "bg-teal-50 text-teal-700" : "hover:bg-canvas")}>
                <span className={cn("font-mono text-[11px] font-semibold w-10", e.method === "GET" ? "text-sky-700" : "text-ok-700")}>{e.method}</span>{e.title}
              </button>
            ))}
          </div>
        ))}
      </Card>
      <div className="space-y-4 min-w-0">
        <Card className="p-4 space-y-3">
          <p className="text-[13px] text-ink-2">{ex.note}</p>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
            <Select aria-label="HTTP method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-28 font-mono">
              {["GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => <option key={m}>{m}</option>)}
            </Select>
            <div className="flex flex-1 min-w-[240px] items-center rounded-lg border border-line-strong bg-canvas pl-3 font-mono text-[13px]">
              <span className="text-ink-3">/api/v1</span>
              <input aria-label="Path" value={path} onChange={(e) => setPath(e.target.value)} className="flex-1 bg-transparent h-9 px-1 focus:outline-none" />
            </div>
            <Button type="submit" loading={send.isPending}><Play className="size-4" />Send</Button>
          </form>
          {method !== "GET" && <Textarea aria-label="Request body (JSON)" rows={5} className="font-mono text-[12.5px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="{ }" />}
          <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" className="size-4 accent-teal-600" checked={noAuth} onChange={(e) => setNoAuth(e.target.checked)} />Send without the Authorization header</label>
          {!can("patients:write") && ex.group === "Patients" && ex.method === "POST" && <p className="text-[12.5px] text-warn-700">Your role can't create patients, so this returns 403 before validation runs.</p>}
        </Card>
        {send.data && (
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={statusTone(send.data.status)}>HTTP {send.data.status}</Badge>
              {send.data.ms !== null && <span className="text-[13px] text-ink-2 tabular-nums">{send.data.ms} ms</span>}
              {send.data.rid && <span className="text-[13px] text-ink-2 flex items-center gap-1">Request ID <IdChip value={send.data.rid} /></span>}
            </div>
            <Json value={send.data.body} />
            {Object.keys(send.data.headers).length > 0 && (
              <details className="text-[12.5px]"><summary className="cursor-pointer text-ink-2">Response headers</summary><Json value={send.data.headers} className="mt-2" /></details>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function AuditTab() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const a = useQuery({ queryKey: ["audit", entity, action, page], queryFn: () => api<Page<AuditEntry>>("/audit", { query: { entity_type: entity, action, page, page_size: 25 } }), placeholderData: (p) => p });
  return (
    <Card>
      <div className="flex flex-wrap gap-3 p-4">
        <Select aria-label="Entity" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="w-auto">
          <option value="">All entities</option>{["patient", "prescription", "refill_request", "support_ticket", "bug_report", "test_run", "test_result", "user", "permission", "demo_bug_flag"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}
        </Select>
        <Select aria-label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="w-auto">
          <option value="">All actions</option>{["create", "update", "status_change", "login", "login_failed", "permission_denied", "reset"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}
        </Select>
      </div>
      {a.error ? <ErrorState error={a.error} /> : (
        <>
          <Table>
            <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Changes</Th><Th>Request ID</Th></tr></thead>
            {a.isLoading ? <TableSkeleton cols={6} /> : (
              <tbody>
                {a.data?.items.map((x) => (
                  <tr key={x.id}>
                    <Td className="whitespace-nowrap text-ink-2 text-[12.5px]">{timeAgo(x.ts)}</Td>
                    <Td>{x.actor?.full_name ?? <span className="text-ink-3">Unknown</span>}</Td>
                    <Td><Badge tone={x.action.includes("denied") || x.action.includes("failed") ? "bad" : "neutral"}>{humanize(x.action)}</Badge></Td>
                    <Td className="text-[13px]">{humanize(x.entity_type)} <span className="font-mono text-ink-3">{x.entity_id}</span></Td>
                    <Td className="max-w-[340px]"><code className="block truncate font-mono text-[12px] text-ink-2" title={JSON.stringify(x.changes)}>{JSON.stringify(x.changes)}</code></Td>
                    <Td>{x.request_id && <IdChip value={x.request_id} />}</Td>
                  </tr>
                ))}
              </tbody>
            )}
          </Table>
          {a.data && <Pagination page={a.data.page} pageSize={a.data.page_size} total={a.data.total} onPage={setPage} />}
        </>
      )}
    </Card>
  );
}

type Check = { key: string; title: string; sql: string; passed: boolean; violations: Record<string, unknown>[] };
function DbChecksTab() {
  const q = useQuery({ queryKey: ["db-checks"], enabled: false, queryFn: () => api<Check[]>("/diagnostics/db-checks") });
  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-ink-2 max-w-[70ch]">Read-only SQL checks that verify the data behind the UI. Each query returns the rows that break a rule, so zero rows means the check passes.</p>
        <Button onClick={() => q.refetch()} loading={q.isFetching}><Play className="size-4" />Run checks</Button>
      </Card>
      {q.error && <Card><ErrorState error={q.error} /></Card>}
      {!q.data && !q.isFetching && <Card><EmptyState title="Checks haven't run yet" body="Run them after a test session to confirm the database is consistent." /></Card>}
      {q.data && (
        <p className="text-[13.5px] font-medium">{q.data.filter((c) => c.passed).length} of {q.data.length} checks passed</p>
      )}
      {q.data?.map((c) => (
        <Card key={c.key} className="p-4 space-y-2">
          <p className="flex items-center gap-2 font-medium">{c.passed ? <CheckCircle2 className="size-5 text-ok-700" aria-label="Passed" /> : <XCircle className="size-5 text-bad-700" aria-label="Failed" />}{c.title}<Badge tone={c.passed ? "ok" : "bad"}>{c.passed ? "Pass" : `${c.violations.length} violation(s)`}</Badge></p>
          <Json value={c.sql} className="max-h-40" />
          {!c.passed && <Json value={c.violations} className="bg-bad-50 text-bad-700" />}
        </Card>
      ))}
    </div>
  );
}

const STATUS_GUIDE: [string, string, string][] = [
  ["400", "Malformed JSON", "Body isn't valid JSON. Check quotes and trailing commas."],
  ["401", "Not signed in / session expired", "Token missing, invalid or older than 60 minutes. Sign in again."],
  ["403", "Role not allowed", "The user's role lacks the permission. Check the role matrix; an audit entry 'permission_denied' is written."],
  ["404", "Not found", "Wrong ID, or the record isn't visible to this role (tickets created by someone else)."],
  ["409", "Conflict", "Duplicate (patient, prescription, pending refill), invalid status transition, or a stale edit. The message names the conflict."],
  ["422", "Validation failed", "One or more fields broke a rule. error.details lists each field and the problem."],
  ["429", "Rate limited", "More than 5 login attempts per minute. Wait for Retry-After seconds."],
  ["500", "Server error", "Unexpected failure. Trace the request ID: the log entry contains the redacted stack trace. Escalate to engineering."],
];

function GuideTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Reading an error" />
        <div className="px-5 pb-5 space-y-3 text-[13.5px]">
          <p>Every API error uses the same envelope, and every response carries an <code className="font-mono">X-Request-ID</code> header.</p>
          <Json value={{ error: { code: "REFILL_DUPLICATE", message: "A pending refill request already exists for RX-5012.", details: [], request_id: "req_7b1f0c9a2d4e6f81" } }} />
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Ask the customer for the request ID shown in the error message (or the time and screen).</li>
            <li>Open <span className="font-medium">Trace</span>, paste the ID, and read status, path, role and context.</li>
            <li>Compare with the database: open the record, or run the database checks.</li>
            <li>Decide: user error (explain), data issue (correct and document), or defect (convert the ticket to a bug with the request ID as evidence).</li>
          </ol>
        </div>
      </Card>
      <Card>
        <CardHeader title="Status codes in this API" />
        <Table>
          <thead><tr><Th>Code</Th><Th>Meaning</Th><Th>What to check</Th></tr></thead>
          <tbody>{STATUS_GUIDE.map(([c, m, w]) => <tr key={c}><Td><Badge tone={statusTone(Number(c))}>{c}</Badge></Td><Td className="font-medium whitespace-nowrap">{m}</Td><Td className="text-ink-2">{w}</Td></tr>)}</tbody>
        </Table>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Useful SQL for verification" description="Run against the database with psql (read-only)." />
        <div className="px-5 pb-5 grid gap-3 md:grid-cols-2">
          <Json value={"-- Refill history for one prescription\nSELECT r.id, r.status, r.requested_at, r.reviewed_at\nFROM refill_requests r JOIN prescriptions p ON p.id = r.prescription_id\nWHERE p.rx_code = 'RX-5012' ORDER BY r.requested_at;"} />
          <Json value={"-- Everything the server did for one request\nSELECT ts, method, path, status_code, duration_ms, context\nFROM app_logs WHERE request_id = 'req_…';\nSELECT action, entity_type, entity_id, changes\nFROM audit_logs WHERE request_id = 'req_…';"} />
        </div>
      </Card>
    </div>
  );
}

export default function ApiExplorerPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "logs";
  const rid = params.get("rid") ?? "";
  const go = (t: string, extra: Record<string, string> = {}) => setParams({ ...(t === "logs" ? {} : { tab: t }), ...extra }, { replace: true });
  return (
    <>
      <PageHeader title="API & Logs" description="Trace requests, try endpoints, inspect sanitized logs and verify stored data." />
      <Tabs value={tab} onValueChange={(t) => go(t)}>
        <TabsList className="mb-4">
          <TabsTrigger value="logs">Request logs</TabsTrigger>
          <TabsTrigger value="trace">Trace a request</TabsTrigger>
          <TabsTrigger value="console">API console</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
          <TabsTrigger value="db">Database checks</TabsTrigger>
          <TabsTrigger value="guide">Troubleshooting guide</TabsTrigger>
        </TabsList>
        <TabsContent value="logs"><LogsTab onTrace={(r) => go("trace", { rid: r })} /></TabsContent>
        <TabsContent value="trace"><TraceTab key={rid} initial={rid} /></TabsContent>
        <TabsContent value="console"><ConsoleTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="db"><DbChecksTab /></TabsContent>
        <TabsContent value="guide"><GuideTab /></TabsContent>
      </Tabs>
      <p className="mt-6 text-[12.5px] text-ink-3">Full interactive API reference: <a className="link" href="/api/docs" target="_blank" rel="noreferrer">Swagger UI</a>. Postman collection: <span className="font-mono">postman/</span> in the repository.</p>
    </>
  );
}
