import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState, IdChip, KV, PageHeader, PriorityBadge, StatusBadge } from "@/components/common";
import { Badge, Button, Card, CardHeader, Field, Select, Spinner, Textarea } from "@/components/ui";
import { ApiError, api, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Bug, BugStatus, TestCase } from "@/lib/types";
import { fmtDateTime, humanize } from "@/lib/utils";

const STATUSES: BugStatus[] = ["new", "confirmed", "in_progress", "fixed", "verified", "closed", "wont_fix"];

function Section({ title, children, tone }: { title: string; children: string | null; tone?: "ok" | "bad" }) {
  if (!children) return null;
  return (
    <div className={tone === "ok" ? "rounded-xl bg-ok-50 px-4 py-3" : tone === "bad" ? "rounded-xl bg-bad-50 px-4 py-3" : ""}>
      <p className="text-[13px] font-medium mb-1">{title}</p>
      <p className="text-[13.5px] whitespace-pre-wrap leading-relaxed">{children}</p>
    </div>
  );
}

export default function BugDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const bug = useQuery({ queryKey: ["bug", id], queryFn: () => api<Bug>(`/qa/bugs/${id}`) });
  const cases = useQuery({ queryKey: ["test-cases", "all"], enabled: can("bugs:write"), queryFn: () => api<Page<TestCase>>("/qa/test-cases", { query: { page_size: 100 } }) });
  const [form, setForm] = useState<{ status: BugStatus; root_cause: string; fix_notes: string; regression_case_id: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api<Bug>(`/qa/bugs/${id}`, { method: "PATCH", body: { status: form!.status, root_cause: form!.root_cause.trim() || null,
      fix_notes: form!.fix_notes.trim() || null, regression_case_id: form!.regression_case_id ? Number(form!.regression_case_id) : null } }),
    onSuccess: (b) => { qc.setQueryData(["bug", id], b); qc.invalidateQueries({ queryKey: ["bugs"] }); setForm(null); setErrors({}); notifyOk("Bug updated", `${b.bug_code} is ${humanize(b.status).toLowerCase()}`); },
    onError: (e) => (e instanceof ApiError && e.status === 422 ? setErrors(e.fieldErrors()) : notifyError(e)),
  });
  if (bug.isLoading) return <Spinner />;
  if (bug.error || !bug.data) return <div className="card"><ErrorState error={bug.error} onRetry={bug.refetch} /></div>;
  const b = bug.data;
  const f = form ?? { status: b.status, root_cause: b.root_cause ?? "", fix_notes: b.fix_notes ?? "", regression_case_id: b.regression_case_id ? String(b.regression_case_id) : "" };
  return (
    <>
      <PageHeader back={{ to: "/qa?tab=bugs", label: "Bug reports" }} title={b.title}
        description={<span className="flex flex-wrap items-center gap-2"><IdChip value={b.bug_code} /><StatusBadge status={b.status} /><span className="text-ink-3">Severity</span><PriorityBadge value={b.severity} /><span className="text-ink-3">Priority</span><PriorityBadge value={b.priority} />{b.demo_bug_key && <Badge tone="teal">Bug Lab defect</Badge>}</span>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Report" />
          <div className="px-5 pb-5 space-y-4">
            <Section title="Description">{b.description}</Section>
            <Section title="Preconditions">{b.preconditions}</Section>
            <Section title="Steps to reproduce">{b.steps_to_reproduce}</Section>
            <div className="grid gap-3 md:grid-cols-2">
              <Section title="Expected" tone="ok">{b.expected_behavior}</Section>
              <Section title="Actual" tone="bad">{b.actual_behavior}</Section>
            </div>
            <Section title="Root cause">{b.root_cause}</Section>
            <Section title="Fix and verification notes">{b.fix_notes}</Section>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <div className="px-5 pb-5">
              <KV items={[
                ["Environment", b.environment],
                ["Source ticket", b.source_ticket_code && b.source_ticket_id ? <IdChip value={b.source_ticket_code} to={`/tickets/${b.source_ticket_id}`} /> : null],
                ["Regression test", b.regression_case_code && b.regression_case_id ? <IdChip value={b.regression_case_code} to={`/qa/cases/${b.regression_case_id}`} /> : "Not linked"],
                ["Reported by", b.reporter?.full_name], ["Reported", fmtDateTime(b.created_at)], ["Updated", fmtDateTime(b.updated_at)],
              ]} />
              {b.evidence.length > 0 && (
                <div className="mt-4">
                  <p className="text-[13px] font-medium mb-1.5">Evidence</p>
                  <ul className="space-y-1 text-[13px]">
                    {b.evidence.map((e, i) => (
                      <li key={i}>{e.type === "log" && e.request_id
                        ? <span>Log: {can("logs:read") ? <Link className="font-mono link" to={`/api-explorer?tab=trace&rid=${e.request_id}`}>{e.request_id}</Link> : <span className="font-mono">{e.request_id}</span>}</span>
                        : <span>{humanize(e.type)}: <span className="font-mono">{e.ref ?? JSON.stringify(e)}</span></span>}</li>
                    ))}
                  </ul>
                </div>
              )}
              {b.demo_bug_key && <Link to="/bug-lab" className="link text-[13px] mt-3 inline-block">Reproduce in the Bug Lab</Link>}
            </div>
          </Card>
          {can("bugs:write") && (
            <Card>
              <CardHeader title="Triage and verification" description="Verified needs a root cause and a linked regression test." />
              <div className="px-5 pb-5 grid gap-3">
                <Field label="Status">{(a) => <Select {...a} value={f.status} onChange={(e) => setForm({ ...f, status: e.target.value as BugStatus })}>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>}</Field>
                <Field label="Root cause" error={errors.root_cause}>{(a) => <Textarea {...a} rows={3} value={f.root_cause} onChange={(e) => setForm({ ...f, root_cause: e.target.value })} />}</Field>
                <Field label="Fix notes">{(a) => <Textarea {...a} rows={2} value={f.fix_notes} onChange={(e) => setForm({ ...f, fix_notes: e.target.value })} />}</Field>
                <Field label="Regression test case" error={errors.regression_case_id}>{(a) => (
                  <Select {...a} value={f.regression_case_id} onChange={(e) => setForm({ ...f, regression_case_id: e.target.value })}>
                    <option value="">None</option>{cases.data?.items.map((c) => <option key={c.id} value={c.id}>{c.case_code} · {c.title}</option>)}
                  </Select>)}</Field>
                <Button disabled={!form} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
