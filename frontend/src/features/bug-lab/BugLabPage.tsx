import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState, IdChip, PageHeader, StatusBadge, Table, Td, Th } from "@/components/common";
import { Badge, Button, Card, CardHeader, Input, Spinner } from "@/components/ui";
import { ApiError, requestWithMeta, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Refill } from "@/lib/types";
import { cn, humanize, uid } from "@/lib/utils";

const DEMO_HEADERS = { "X-Demo-Session": "bug-lab" };

type DemoBug = { key: string; title: string; description: string; is_enabled: boolean; bug_report: { id: number; bug_code: string; status: string } | null };
type SandboxRx = { id: number; rx_code: string; patient: string; medication: string; status: string; refills_authorized: number; refills_remaining: number; refills: Refill[] };
type LastCall = { label: string; status: number; requestId: string | null; ms: number | null; body: unknown };

const REPRO: Record<string, string> = {
  refill_status_stale: "Request a refill on any sandbox prescription, then Approve it. The badge stays 'Pending' until you reload from the server.",
  refill_boundary_422: "Request a refill on Metformin (Omar Khalil), which has exactly 1 refill left.",
  search_case_sensitive: "Search the sandbox patients for 'Nora', then for 'nora'.",
  refill_double_submit: "Click 'Submit twice' on Atorvastatin (Lina Nasser). Two pending requests appear.",
};

export default function BugLabPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("demo:manage");
  const [last, setLast] = useState<LastCall | null>(null);
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState<{ q: string; rows: { id: number; patient_code: string; first_name: string; last_name: string }[] } | null>(null);

  const bugs = useQuery({ queryKey: ["demo-bugs"], queryFn: () => api<{ master_switch: boolean; bugs: DemoBug[] }>("/demo/bugs") });
  const rxs = useQuery({ queryKey: ["sandbox-rx"], queryFn: () => api<SandboxRx[]>("/demo/sandbox/prescriptions") });

  const call = async <T,>(label: string, path: string, method = "GET", headers: Record<string, string> = {}): Promise<T | null> => {
    try {
      const r = await requestWithMeta<T>(path, { method, headers: { ...DEMO_HEADERS, ...headers } });
      setLast({ label, status: r.meta.status, requestId: r.meta.requestId, ms: r.meta.durationMs, body: r.data });
      return r.data;
    } catch (e) {
      if (e instanceof ApiError) { setLast({ label, status: e.status, requestId: e.requestId, ms: null, body: { error: { code: e.code, message: e.message, request_id: e.requestId } } }); notifyError(e); return null; }
      throw e;
    }
  };

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => api(`/demo/bugs/${key}/toggle`, { method: "POST", query: { enabled } }),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["demo-bugs"] }); notifyOk(v.enabled ? "Defect enabled in the sandbox" : "Defect disabled (fix applied)"); },
    onError: (e) => notifyError(e),
  });
  const reset = useMutation({
    mutationFn: () => api("/demo/sandbox/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sandbox-rx"] }); setLast(null); setSearchResult(null); notifyOk("Sandbox data reset"); },
    onError: (e) => notifyError(e),
  });

  // Deliberately naive UI update: trust the API response instead of refetching. With refill_status_stale enabled, this shows the stale state.
  const patchRefill = (rxId: number, refill: Refill) => qc.setQueryData<SandboxRx[]>(["sandbox-rx"], (old) => old?.map((r) =>
    r.id === rxId ? { ...r, refills_remaining: refill.refills_remaining, refills: r.refills.some((x) => x.id === refill.id) ? r.refills.map((x) => (x.id === refill.id ? refill : x)) : [refill, ...r.refills] } : r));

  const request = async (rx: SandboxRx) => {
    const r = await call<Refill>(`Request refill on ${rx.rx_code}`, `/demo/sandbox/refills?prescription_id=${rx.id}`, "POST", { "Idempotency-Key": uid() });
    if (r) patchRefill(rx.id, r);
  };
  const submitTwice = async (rx: SandboxRx) => {
    const key = `double-${rx.id}-${Date.now()}`;
    const [a, b] = await Promise.all([1, 2].map(() => requestWithMeta<Refill>(`/demo/sandbox/refills?prescription_id=${rx.id}`, { method: "POST", headers: { ...DEMO_HEADERS, "Idempotency-Key": key } }).then((x) => x).catch((e) => e)));
    const ok = [a, b].filter((x) => !(x instanceof ApiError)) as { data: Refill; meta: { status: number; requestId: string | null; durationMs: number } }[];
    setLast({ label: `Submit twice on ${rx.rx_code} (same Idempotency-Key)`, status: ok[0]?.meta.status ?? (a as ApiError).status,
      requestId: ok[0]?.meta.requestId ?? null, ms: null, body: [a, b].map((x) => (x instanceof ApiError ? { status: x.status, code: x.code } : { status: x.meta.status, refill_id: x.data.id, replay: x.meta.headers?.["idempotent-replay"] ?? false })) });
    qc.invalidateQueries({ queryKey: ["sandbox-rx"] });
  };
  const approve = async (rx: SandboxRx, refill: Refill) => {
    const r = await call<Refill>(`Approve refill ${refill.id}`, `/demo/sandbox/refills/${refill.id}/approve`, "POST");
    if (r) patchRefill(rx.id, r);
  };
  const runSearch = async () => {
    const rows = await call<{ id: number; patient_code: string; first_name: string; last_name: string }[]>(`Search '${search}'`, `/demo/sandbox/patients?q=${encodeURIComponent(search)}`);
    if (rows) setSearchResult({ q: search, rows });
  };

  if (bugs.isLoading) return <Spinner />;
  if (bugs.error || !bugs.data) return <div className="card"><ErrorState error={bugs.error} onRetry={bugs.refetch} /></div>;
  const enabledCount = bugs.data.bugs.filter((b) => b.is_enabled).length;

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3"><FlaskConical className="size-7 text-teal-600" />Bug Lab</span>}
        description="A separate sandbox with switchable defects. Reproduce, investigate, document, fix and regression-test, without touching real records."
        actions={manage && <Button variant="secondary" loading={reset.isPending} onClick={() => reset.mutate()}><RotateCcw className="size-4" />Reset sandbox</Button>} />

      <div className={cn("mb-5 rounded-2xl border-2 border-dashed px-5 py-4", enabledCount ? "border-warn-700/40 bg-warn-50" : "border-line-strong bg-card")}>
        <p className="font-medium">{!bugs.data.master_switch ? "The Bug Lab is disabled in this environment." : enabledCount ? `${enabledCount} defect(s) active in the sandbox` : "All defects are off: the sandbox behaves correctly."}</p>
        <p className="text-[13px] text-ink-2 mt-0.5">Defects only fire for sandbox records and requests sent from this page (header <span className="font-mono">X-Demo-Session</span>). Patients, prescriptions and refills elsewhere in the app are never affected. Bug Lab traffic is tagged in the logs.</p>
      </div>

      <ol className="mb-5 grid gap-2 sm:grid-cols-5 text-[13px]">
        {[["Reproduce", "Turn a defect on and follow its steps below."], ["Investigate", <>Inspect the request in <Link className="link" to="/api-explorer?tab=logs">API &amp; Logs</Link> (filter: Bug Lab).</>],
          ["Document", "Each defect has a full bug report with root cause."], ["Fix", "Turn the defect off: the corrected code path runs."], ["Verify", <>Re-run the linked regression case in a <Link className="link" to="/qa?tab=runs">test run</Link>.</>]].map(([t, d], i) => (
          <li key={t as string} className="card px-4 py-3"><p className="font-medium"><span className="text-teal-600 tabular-nums mr-1.5">{i + 1}</span>{t}</p><p className="text-ink-3 mt-0.5">{d}</p></li>
        ))}
      </ol>

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        {bugs.data.bugs.map((b) => (
          <Card key={b.key} className={cn("p-5", b.is_enabled && "ring-2 ring-warn-700/30")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{b.title}</p>
                <p className="font-mono text-[12px] text-ink-3 mt-0.5">{b.key}</p>
              </div>
              <label className="flex items-center gap-2 text-[13px] whitespace-nowrap">
                <span className={b.is_enabled ? "text-warn-700 font-medium" : "text-ink-3"}>{b.is_enabled ? "Active" : "Off"}</span>
                <button type="button" role="switch" aria-checked={b.is_enabled} aria-label={`Toggle ${b.title}`} data-testid={`toggle-${b.key}`}
                  disabled={!manage || !bugs.data.master_switch || toggle.isPending} onClick={() => toggle.mutate({ key: b.key, enabled: !b.is_enabled })}
                  className={cn("relative h-6 w-11 rounded-full transition-colors disabled:opacity-50", b.is_enabled ? "bg-[#c98500]" : "bg-line-strong")}>
                  <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", b.is_enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
                </button>
              </label>
            </div>
            <p className="text-[13.5px] text-ink-2 mt-3">{b.description}</p>
            <p className="text-[13px] mt-3"><span className="font-medium">To reproduce: </span>{REPRO[b.key]}</p>
            {b.bug_report && <p className="text-[13px] mt-3 flex items-center gap-2">Bug report <IdChip value={b.bug_report.bug_code} to={`/qa/bugs/${b.bug_report.id}`} /><StatusBadge status={b.bug_report.status} /></p>}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4 min-w-0">
          <Card>
            <CardHeader title="Sandbox prescriptions" description="Refill actions here go through the real refill workflow against sandbox data."
              action={<Button variant="secondary" size="sm" onClick={() => rxs.refetch()}><RotateCcw className="size-4" />Reload from server</Button>} />
            {rxs.error ? <ErrorState error={rxs.error} /> : rxs.isLoading ? <Spinner /> : (
              <Table>
                <thead><tr><Th>RX</Th><Th>Patient</Th><Th>Medication</Th><Th>Refills left</Th><Th>Latest refill</Th><Th className="text-right">Actions</Th></tr></thead>
                <tbody>
                  {rxs.data?.map((rx) => {
                    const latest = rx.refills[0];
                    const pendingCount = rx.refills.filter((r) => r.status === "pending").length;
                    return (
                      <tr key={rx.id} data-testid={`sandbox-${rx.medication.split(" ")[0]}`}>
                        <Td><span className="id-chip">{rx.rx_code}</span></Td>
                        <Td>{rx.patient}</Td>
                        <Td>{rx.medication}</Td>
                        <Td className="tabular-nums" data-testid="remaining">{rx.refills_remaining} / {rx.refills_authorized}</Td>
                        <Td>{latest ? <span className="flex items-center gap-2"><span data-testid="latest-status"><StatusBadge status={latest.status} /></span>{pendingCount > 1 && <Badge tone="bad">{pendingCount} pending</Badge>}</span> : <span className="text-ink-3">None</span>}</Td>
                        <Td className="text-right whitespace-nowrap space-x-1.5">
                          {latest?.status === "pending" ? <Button size="sm" onClick={() => approve(rx, latest)}>Approve</Button>
                            : <Button size="sm" variant="secondary" onClick={() => request(rx)}>Request refill</Button>}
                          <Button size="sm" variant="ghost" onClick={() => submitTwice(rx)}>Submit twice</Button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Sandbox patient search" />
            <form className="flex gap-2 px-5" onSubmit={(e) => { e.preventDefault(); if (search.trim()) runSearch(); }}>
              <Input aria-label="Search sandbox patients" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Try 'Nora' and 'nora'" />
              <Button type="submit">Search</Button>
            </form>
            <div className="px-5 py-4 text-[13.5px]" data-testid="sandbox-search-result">
              {searchResult && (searchResult.rows.length === 0 ? <p className="text-ink-3">No patients found for “{searchResult.q}”.</p> : (
                <ul className="space-y-1">{searchResult.rows.map((p) => <li key={p.id}><span className="id-chip mr-2">{p.patient_code}</span>{p.first_name} {p.last_name}</li>)}</ul>
              ))}
              {!searchResult && <p className="text-ink-3">Sandbox patients: Nora Haddad, Omar Khalil, Lina Nasser, Sami Barakat, Dana Saleh, Noor Hamdan.</p>}
            </div>
          </Card>
        </div>
        <Card className="h-fit 2xl:sticky 2xl:top-20">
          <CardHeader title="Last API response" description="What the server actually returned" />
          <div className="px-5 pb-5">
            {!last ? <p className="text-[13px] text-ink-3">Run an action to inspect the raw response.</p> : (
              <div className="space-y-2">
                <p className="text-[13px] font-medium">{last.label}</p>
                <p className="flex flex-wrap items-center gap-2 text-[13px]"><Badge tone={last.status >= 400 ? "bad" : "ok"}>HTTP {last.status}</Badge>{last.ms !== null && <span className="text-ink-3">{last.ms} ms</span>}</p>
                {last.requestId && <p className="text-[13px] flex items-center gap-1">Request ID <IdChip value={last.requestId} /> <Link className="link ml-1" to={`/api-explorer?tab=trace&rid=${last.requestId}`}>Trace</Link></p>}
                <pre className="rounded-xl bg-slab text-teal-50 p-3 text-[12px] font-mono overflow-auto max-h-80">{JSON.stringify(last.body, null, 2)}</pre>
              </div>
            )}
          </div>
        </Card>
      </div>
      <p className="mt-6 text-[12.5px] text-ink-3">Defect injection points in the backend are marked <span className="font-mono">DEMO-BUG</span> and documented in docs/bug-reports. Status of each defect: {bugs.data.bugs.map((b) => `${humanize(b.key)} ${b.is_enabled ? "on" : "off"}`).join(", ")}.</p>
    </>
  );
}
