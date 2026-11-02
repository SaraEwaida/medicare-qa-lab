import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ErrorState, IdChip, KV, PageHeader, PriorityBadge, StatusBadge } from "@/components/common";
import { Badge, Button, Card, CardHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { TestCase } from "@/lib/types";
import { fmtDateTime, humanize } from "@/lib/utils";
import { TestCaseDialog } from "./QaPage";

export default function TestCaseDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const tc = useQuery({ queryKey: ["test-case", id], queryFn: () => api<TestCase>(`/qa/test-cases/${id}`) });
  const archive = useMutation({
    mutationFn: () => api(`/qa/test-cases/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["test-cases"] }); notifyOk("Test case archived", "Past results are kept."); nav("/qa?tab=cases"); },
    onError: (e) => notifyError(e),
  });
  if (tc.isLoading) return <Spinner />;
  if (tc.error || !tc.data) return <div className="card"><ErrorState error={tc.error} onRetry={tc.refetch} /></div>;
  const c = tc.data;
  return (
    <>
      <PageHeader back={{ to: "/qa?tab=cases", label: "Test cases" }} title={c.title}
        description={<span className="flex flex-wrap items-center gap-2"><IdChip value={c.case_code} /><PriorityBadge value={c.priority} />{c.is_archived && <Badge>Archived</Badge>}</span>}
        actions={can("qa:write") && !c.is_archived && <>
          <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="secondary" loading={archive.isPending} onClick={() => archive.mutate()}>Archive</Button>
        </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Steps" />
          <div className="px-5 pb-5 space-y-4">
            {c.preconditions && <div className="rounded-xl bg-canvas px-4 py-3 text-[13.5px]"><span className="font-medium">Preconditions. </span>{c.preconditions}</div>}
            <ol className="space-y-3">
              {c.steps.map((s) => (
                <li key={s.step_number} className="grid grid-cols-[28px_1fr] gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-teal-50 text-[12px] font-semibold text-teal-700">{s.step_number}</span>
                  <div><p>{s.action}</p>{s.expected && <p className="text-[13px] text-ink-3">Expected: {s.expected}</p>}</div>
                </li>
              ))}
            </ol>
            <div className="rounded-xl border border-ok-700/20 bg-ok-50 px-4 py-3">
              <p className="text-[13px] font-medium text-ok-700">Expected result</p>
              <p className="text-[13.5px] mt-0.5">{c.expected_result}</p>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <div className="px-5 pb-5">
            <KV items={[
              ["Module", humanize(c.module)], ["Type", humanize(c.type)],
              ["Last result", c.last_status ? <StatusBadge status={c.last_status} /> : "Never run"],
              ["Automation", c.is_automated ? <span className="font-mono text-[12.5px] break-all">{c.automation_ref ?? "Yes"}</span> : "Manual only"],
              ["Created", fmtDateTime(c.created_at)], ["Updated", fmtDateTime(c.updated_at)],
            ]} />
          </div>
        </Card>
      </div>
      {editing && <TestCaseDialog initial={c} onClose={() => setEditing(false)} onSaved={() => undefined} />}
    </>
  );
}
