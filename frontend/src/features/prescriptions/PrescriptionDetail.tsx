import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState, ErrorState, IdChip, KV, PageHeader, StatusBadge, Table, Td, Th } from "@/components/common";
import { Button, Card, CardHeader, Dialog, Field, Select, Spinner, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Prescription, RxStatus } from "@/lib/types";
import { fmtDate, fmtDateTime, humanize } from "@/lib/utils";
import { RejectDialog, useRefillActions } from "./refillActions";

const NEXT: Record<RxStatus, RxStatus[]> = {
  active: ["on_hold", "completed", "cancelled"], refill_due: ["active", "on_hold", "completed", "cancelled"],
  on_hold: ["active", "cancelled"], completed: [], cancelled: [],
};

export default function PrescriptionDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { act, submit } = useRefillActions();
  const [rejecting, setRejecting] = useState<{ id: number; rx_code: string } | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const rx = useQuery({ queryKey: ["prescription", id], queryFn: () => api<Prescription>(`/prescriptions/${id}`) });

  if (rx.isLoading) return <Spinner label="Loading prescription" />;
  if (rx.error || !rx.data) return <div className="card"><ErrorState error={rx.error} onRetry={rx.refetch} /></div>;
  const p = rx.data;
  const pending = p.refills?.find((r) => r.status === "pending");
  const canRequest = can("refills:submit") && ["active", "refill_due"].includes(p.status) && p.refills_remaining > 0 && !pending;
  const reasonNoRefill = !["active", "refill_due"].includes(p.status) ? `Prescription is ${humanize(p.status).toLowerCase()}.`
    : p.refills_remaining === 0 ? "No refills remaining." : pending ? "A refill is already pending review." : null;

  return (
    <>
      <PageHeader back={{ to: "/prescriptions", label: "Prescriptions" }}
        title={<span className="flex flex-wrap items-center gap-3">{p.medication.name} {p.medication.strength}<StatusBadge status={p.status} /></span>}
        description={<span className="flex flex-wrap items-center gap-2"><IdChip value={p.rx_code} /> for
          <Link className="link" to={`/patients/${p.patient.id}`}>{p.patient.first_name} {p.patient.last_name}</Link>
          <span className="id-chip text-ink-3">{p.patient.patient_code}</span></span>}
        actions={<>
          {can("prescriptions:write") && NEXT[p.status].length > 0 && <Button variant="secondary" onClick={() => setStatusOpen(true)}>Change status</Button>}
          {can("refills:submit") && <Button disabled={!canRequest} title={reasonNoRefill ?? undefined} onClick={() => setRequestOpen(true)}>Request refill</Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Details" />
          <div className="px-5 pb-5">
            <div className="mb-5 rounded-xl bg-teal-50 px-4 py-3">
              <p className="text-[12.5px] text-teal-700">Refills remaining</p>
              <p className="text-[28px] font-semibold tabular-nums text-ink" data-testid="refills-remaining">{p.refills_remaining} <span className="text-[15px] font-normal text-ink-3">of {p.refills_authorized}</span></p>
            </div>
            <KV items={[
              ["Dosage", p.dosage_instructions], ["Quantity", p.quantity], ["Form", humanize(p.medication.form)],
              ["Controlled", p.medication.is_controlled ? "Yes" : "No"], ["Prescriber", p.prescriber_name],
              ["Start date", fmtDate(p.start_date)], ["End date", fmtDate(p.end_date)], ["Last updated", fmtDateTime(p.updated_at)],
            ]} />
            {reasonNoRefill && can("refills:submit") && <p className="mt-4 text-[12.5px] text-ink-3">Refill unavailable: {reasonNoRefill}</p>}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Refill history" description="Every request and decision for this prescription"
            action={<Button variant="ghost" size="sm" onClick={() => rx.refetch()} aria-label="Reload"><RefreshCw className="size-4" /></Button>} />
          {!p.refills?.length ? <EmptyState title="No refill requests yet" body={canRequest ? "Request the first refill when the patient needs it." : undefined} /> : (
            <Table>
              <thead><tr><Th>Requested</Th><Th>Status</Th><Th>Reviewed</Th><Th>Notes</Th>{can("refills:review") && <Th className="text-right">Actions</Th>}</tr></thead>
              <tbody>
                {p.refills.map((r) => (
                  <tr key={r.id} data-testid={`history-refill-${r.id}`}>
                    <Td className="whitespace-nowrap">{fmtDateTime(r.requested_at)}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-ink-2 whitespace-nowrap">{fmtDateTime(r.reviewed_at)}</Td>
                    <Td className="text-ink-2">{r.rejection_reason ?? r.notes ?? "—"}</Td>
                    {can("refills:review") && (
                      <Td className="text-right whitespace-nowrap">
                        {r.status === "pending" && <>
                          <Button size="sm" variant="secondary" className="mr-2" onClick={() => setRejecting({ id: r.id, rx_code: p.rx_code })}>Reject</Button>
                          <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: "approve" })}>Approve</Button>
                        </>}
                        {r.status === "approved" && <Button size="sm" variant="subtle" onClick={() => act.mutate({ id: r.id, action: "dispense" })}>Mark dispensed</Button>}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen} title={`Request refill for ${p.rx_code}`}
        description={`${p.refills_remaining} refill(s) remaining. The request goes to the refill queue for review.`}
        footer={<><Button variant="secondary" onClick={() => setRequestOpen(false)}>Cancel</Button>
          <Button loading={submit.isPending} onClick={() => submit.mutate({ prescriptionId: p.id, notes: notes.trim() }, { onSuccess: () => { setRequestOpen(false); setNotes(""); } })}>Submit request</Button></>}>
        <Field label="Notes" hint="Optional, up to 500 characters.">
          {(a) => <Textarea {...a} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Patient called in" />}
        </Field>
      </Dialog>

      <RejectDialog refill={rejecting} onClose={() => setRejecting(null)} busy={act.isPending}
        onReject={(reason) => rejecting && act.mutate({ id: rejecting.id, action: "reject", reason }, { onSuccess: () => setRejecting(null) })} />
      {statusOpen && <StatusDialog rx={p} onClose={() => setStatusOpen(false)} onDone={(n) => qc.setQueryData(["prescription", id], n)} />}
    </>
  );
}

function StatusDialog({ rx, onClose, onDone }: { rx: Prescription; onClose: () => void; onDone: (p: Prescription) => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RxStatus>(NEXT[rx.status][0]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () => api<Prescription>(`/prescriptions/${rx.id}/status`, { method: "POST", body: { status, reason: reason.trim() || null } }),
    onSuccess: (p) => { onDone(p); qc.invalidateQueries({ queryKey: ["prescriptions"] }); notifyOk(`Status changed to ${humanize(p.status)}`); onClose(); },
    onError: (e) => (e instanceof ApiError && e.status === 422 ? setError(e.message) : notifyError(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Change status of ${rx.rx_code}`}
      description="Completing or cancelling closes any pending refill request."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => {
        if (status === "cancelled" && !reason.trim()) { setError("A reason is required to cancel."); return; }
        m.mutate();
      }}>Save status</Button></>}>
      <div className="grid gap-4">
        <Field label="New status">{(a) => <Select {...a} value={status} onChange={(e) => setStatus(e.target.value as RxStatus)}>{NEXT[rx.status].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>}</Field>
        <Field label="Reason" required={status === "cancelled"} error={error}>{(a) => <Textarea {...a} value={reason} onChange={(e) => { setReason(e.target.value); setError(undefined); }} />}</Field>
      </div>
    </Dialog>
  );
}
