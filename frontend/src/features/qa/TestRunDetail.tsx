import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ErrorState, PageHeader, PriorityBadge, ResultBar, StatusBadge } from "@/components/common";
import { Badge, Button, Card, Spinner, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { ResultStatus, RunResult, TestRunDetail as Run } from "@/lib/types";
import { cn, fmtDateTime, humanize } from "@/lib/utils";
import { BugDialog } from "./QaPage";

const CHOICES: { s: ResultStatus; label: string; cls: string }[] = [
  { s: "passed", label: "Pass", cls: "data-[on=true]:bg-ok-700 data-[on=true]:text-white data-[on=true]:border-ok-700" },
  { s: "failed", label: "Fail", cls: "data-[on=true]:bg-bad-700 data-[on=true]:text-white data-[on=true]:border-bad-700" },
  { s: "blocked", label: "Blocked", cls: "data-[on=true]:bg-[#a36d00] data-[on=true]:text-white data-[on=true]:border-[#a36d00]" },
  { s: "not_run", label: "Not run", cls: "data-[on=true]:bg-ink-2 data-[on=true]:text-white data-[on=true]:border-ink-2" },
];

function ResultRow({ run, r, editable, onFileBug }: { run: Run; r: RunResult; editable: boolean; onFileBug: (r: RunResult) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(r.actual_result ?? "");
  const [pending, setPending] = useState<ResultStatus | null>(null);
  const [err, setErr] = useState<string>();
  const m = useMutation({
    mutationFn: (status: ResultStatus) => api<Run>(`/qa/test-runs/${run.id}/results/${r.id}`, { method: "PATCH", body: { status, actual_result: actual.trim() || null } }),
    onSuccess: (d) => { qc.setQueryData(["test-run", String(run.id)], d); qc.invalidateQueries({ queryKey: ["qa-metrics"] }); qc.invalidateQueries({ queryKey: ["summary"] }); setPending(null); setErr(undefined); },
    onError: (e) => { notifyError(e); setPending(null); },
  });
  const record = (s: ResultStatus) => {
    if ((s === "failed" || s === "blocked") && !actual.trim()) { setOpen(true); setPending(s); setErr(s === "failed" ? "Describe what actually happened before marking this case failed." : "Note what blocked execution."); return; }
    if (s === "failed" && !actual.trim()) return;
    m.mutate(s);
  };
  return (
    <li className="border-b border-line last:border-0" data-testid={`result-${r.test_case.case_code}`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="size-4 shrink-0 text-ink-3" /> : <ChevronRight className="size-4 shrink-0 text-ink-3" />}
          <span className="id-chip w-14 shrink-0">{r.test_case.case_code}</span>
          <span className="truncate font-medium">{r.test_case.title}</span>
        </button>
        <PriorityBadge value={r.test_case.priority} />
        {editable ? (
          <div role="group" aria-label={`Result for ${r.test_case.case_code}`} className="flex gap-1">
            {CHOICES.map((c) => (
              <button key={c.s} type="button" data-on={r.status === c.s} disabled={m.isPending}
                onClick={() => record(c.s)} className={cn("h-7 rounded-md border border-line-strong px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-canvas transition-colors", c.cls)}>
                {c.label}
              </button>
            ))}
          </div>
        ) : <StatusBadge status={r.status} />}
      </div>
      {open && (
        <div className="px-5 pb-4 pl-12 grid gap-4 lg:grid-cols-2">
          <div className="text-[13px] space-y-2">
            {r.test_case.preconditions && <p><span className="text-ink-3">Preconditions: </span>{r.test_case.preconditions}</p>}
            <ol className="list-decimal pl-5 space-y-1">
              {r.test_case.steps.map((s) => <li key={s.step_number}>{s.action}{s.expected && <span className="block text-ink-3">Expect: {s.expected}</span>}</li>)}
            </ol>
            <p><span className="text-ink-3">Expected result: </span>{r.test_case.expected_result}</p>
          </div>
          <div className="space-y-2">
            <label className="text-[13px] font-medium" htmlFor={`actual-${r.id}`}>Actual result</label>
            <Textarea id={`actual-${r.id}`} rows={3} disabled={!editable} value={actual} aria-invalid={err ? true : undefined}
              onChange={(e) => { setActual(e.target.value); setErr(undefined); }} placeholder="What actually happened? Include request IDs or error messages." />
            {err && <p role="alert" className="text-[12.5px] text-bad-700">{err}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {editable && pending && <Button size="sm" loading={m.isPending} onClick={() => actual.trim() && m.mutate(pending)}>Save as {humanize(pending)}</Button>}
              {editable && !pending && r.status !== "not_run" && actual !== (r.actual_result ?? "") && <Button size="sm" variant="secondary" loading={m.isPending} onClick={() => m.mutate(r.status)}>Save actual result</Button>}
              {r.status === "failed" && r.linked_bug_codes.length === 0 && <Button size="sm" variant="secondary" onClick={() => onFileBug(r)}>File bug from failure</Button>}
              {r.linked_bug_codes.map((c) => <Badge key={c} tone="bad">{c}</Badge>)}
              {r.executed_at && <span className="text-[12px] text-ink-3">Recorded {fmtDateTime(r.executed_at)}</span>}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export default function TestRunDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [bugFor, setBugFor] = useState<RunResult | null>(null);
  const run = useQuery({ queryKey: ["test-run", id], queryFn: () => api<Run>(`/qa/test-runs/${id}`) });
  const complete = useMutation({
    mutationFn: () => api<Run>(`/qa/test-runs/${id}/complete`, { method: "POST" }),
    onSuccess: (d) => { qc.setQueryData(["test-run", id], d); qc.invalidateQueries({ queryKey: ["test-runs"] }); notifyOk("Run completed", "Results are now locked."); },
    onError: (e) => notifyError(e),
  });
  if (run.isLoading) return <Spinner label="Loading run" />;
  if (run.error || !run.data) return <div className="card"><ErrorState error={run.error} onRetry={run.refetch} /></div>;
  const r = run.data;
  const editable = can("qa:write") && !r.completed_at;
  return (
    <>
      <PageHeader back={{ to: "/qa?tab=runs", label: "Test runs" }} title={r.name}
        description={`${humanize(r.run_type)} run in ${r.environment}${r.build_version ? `, build ${r.build_version}` : ""}. Started ${fmtDateTime(r.started_at)} by ${r.starter?.full_name ?? "unknown"}.`}
        actions={editable && <Button variant="secondary" loading={complete.isPending} onClick={() => complete.mutate()}>Complete run</Button>} />
      <div className="grid gap-4 md:grid-cols-[1fr_2fr] mb-4">
        <Card className="px-5 py-4">
          <p className="text-[13px] text-ink-2">Pass rate</p>
          <p className="text-[32px] font-semibold tabular-nums" data-testid="run-pass-rate">{r.stats.pass_rate === null ? "—" : `${r.stats.pass_rate}%`}</p>
          <p className="text-[12.5px] text-ink-3">{r.stats.executed} of {r.stats.total} executed ({r.stats.progress}%)</p>
          {r.completed_at ? <Badge tone="neutral" className="mt-2">Completed {fmtDateTime(r.completed_at)}</Badge> : <Badge tone="info" dot className="mt-2">In progress</Badge>}
        </Card>
        <Card className="px-5 py-4 flex flex-col justify-center">
          <ResultBar passed={r.stats.passed} failed={r.stats.failed} blocked={r.stats.blocked} notRun={r.stats.not_run} />
        </Card>
      </div>
      <Card>
        <ul>{r.results.map((x) => <ResultRow key={x.id} run={r} r={x} editable={editable} onFileBug={setBugFor} />)}</ul>
      </Card>
      {bugFor && (
        <BugDialog onClose={() => setBugFor(null)} onSaved={(b) => { qc.invalidateQueries({ queryKey: ["test-run", id] }); nav(`/qa/bugs/${b.id}`); }}
          prefill={{ title: `${bugFor.test_case.case_code} fails: ${bugFor.test_case.title}`, source_result_id: bugFor.id, regression_case_id: bugFor.test_case.id,
            expected_behavior: bugFor.test_case.expected_result, actual_behavior: bugFor.actual_result ?? "",
            steps_to_reproduce: bugFor.test_case.steps.map((s) => `${s.step_number}. ${s.action}`).join("\n"),
            environment: `${r.environment}${r.build_version ? ` · build ${r.build_version}` : ""}` }} />
      )}
    </>
  );
}
