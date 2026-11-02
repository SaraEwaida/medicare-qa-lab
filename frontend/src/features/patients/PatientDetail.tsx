import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState, ErrorState, IdChip, KV, PageHeader, StatusBadge, Table, Td, Th } from "@/components/common";
import { Button, Card, CardHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Patient, Prescription } from "@/lib/types";
import { cn, fmtDate, fmtDateTime, humanize } from "@/lib/utils";
import { PrescriptionFormDialog } from "../prescriptions/PrescriptionForm";
import { PatientFormDialog } from "./PatientForm";

type HistoryEvent = { at: string; type: string; rx_code: string; medication: string; detail: string };

export default function PatientDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [prescribing, setPrescribing] = useState(false);
  const patient = useQuery({ queryKey: ["patient", id], queryFn: () => api<Patient>(`/patients/${id}`) });
  const rxs = useQuery({ queryKey: ["patient", id, "rx"], queryFn: () => api<Prescription[]>(`/patients/${id}/prescriptions`) });
  const history = useQuery({ queryKey: ["patient", id, "history"], queryFn: () => api<HistoryEvent[]>(`/patients/${id}/medication-history`) });

  const toggle = useMutation({
    mutationFn: (action: "deactivate" | "reactivate") => api<Patient>(`/patients/${id}/${action}`, { method: "POST" }),
    onSuccess: (p) => { qc.setQueryData(["patient", id], p); qc.invalidateQueries({ queryKey: ["patients"] }); notifyOk(`Patient ${p.status === "active" ? "reactivated" : "deactivated"}`); },
    onError: (e) => notifyError(e),
  });

  if (patient.isLoading) return <Spinner label="Loading patient" />;
  if (patient.error || !patient.data) return <div className="card"><ErrorState error={patient.error} onRetry={patient.refetch} /></div>;
  const p = patient.data;
  const writable = can("patients:write");

  return (
    <>
      <PageHeader back={{ to: "/patients", label: "Patients" }}
        title={<span className="flex flex-wrap items-center gap-3">{p.first_name} {p.last_name} <StatusBadge status={p.status} /></span>}
        description={<span className="flex items-center gap-2">Patient ID <IdChip value={p.patient_code} /></span>}
        actions={writable && <>
          <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" />Edit</Button>
          {p.status === "active"
            ? <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate("deactivate")}>Deactivate</Button>
            : <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate("reactivate")}>Reactivate</Button>}
          {p.status === "active" && can("prescriptions:write") && <Button onClick={() => setPrescribing(true)}><Plus className="size-4" />New prescription</Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Profile" description={p.contact_masked ? "Contact details masked for your role" : undefined} />
          <div className="px-5 pb-5">
            <KV items={[
              ["Date of birth", p.date_of_birth ? fmtDate(p.date_of_birth) : "Hidden"],
              ["Phone", p.phone], ["Email", p.email], ["Address", p.contact_masked ? "Hidden" : p.address],
              ["Allergies", p.contact_masked ? "Hidden" : p.allergies ? <span className="text-bad-700 font-medium">{p.allergies}</span> : "None recorded"],
              ["Created", fmtDateTime(p.created_at)], ["Last updated", fmtDateTime(p.updated_at)],
            ]} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Prescriptions" description={`${p.active_prescriptions} active`} />
          {rxs.error ? <ErrorState error={rxs.error} onRetry={rxs.refetch} /> : rxs.isLoading ? <Spinner /> : rxs.data?.length === 0 ? (
            <EmptyState title="No prescriptions yet" body={writable ? "Create the first prescription for this patient." : undefined}
              action={writable && p.status === "active" && <Button size="sm" onClick={() => setPrescribing(true)}>New prescription</Button>} />
          ) : (
            <Table>
              <thead><tr><Th>RX</Th><Th>Medication</Th><Th>Dosage</Th><Th>Refills</Th><Th>Status</Th></tr></thead>
              <tbody>
                {rxs.data?.map((rx) => (
                  <tr key={rx.id}>
                    <Td><IdChip value={rx.rx_code} to={`/prescriptions/${rx.id}`} /></Td>
                    <Td className="font-medium">{rx.medication.name} <span className="text-ink-3 font-normal">{rx.medication.strength}</span></Td>
                    <Td className="text-ink-2">{rx.dosage_instructions}</Td>
                    <Td className="tabular-nums">{rx.refills_remaining} of {rx.refills_authorized}</Td>
                    <Td><StatusBadge status={rx.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Medication history" description="Prescriptions and refill decisions, newest first" />
        <div className="px-5 pb-5">
          {history.isLoading ? <Spinner /> : !history.data?.length ? <p className="text-ink-3 text-[13px]">No history yet.</p> : (
            <ol className="relative border-l border-line ml-2 space-y-4">
              {history.data.slice(0, 40).map((h, i) => (
                <li key={i} className="pl-5 relative">
                  <span className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-2 ring-card",
                    h.type === "prescribed" ? "bg-sky-600" : h.type.includes("rejected") ? "bg-bad-700" : h.type.includes("approved") || h.type.includes("dispensed") ? "bg-ok-700" : "bg-line-strong")} />
                  <p className="text-[13.5px]"><span className="font-medium">{humanize(h.type)}</span> · {h.medication} <Link to={`/prescriptions?q=${h.rx_code}`} className="id-chip link ml-1">{h.rx_code}</Link></p>
                  <p className="text-[12.5px] text-ink-3">{fmtDateTime(h.at)} · {h.detail}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      {editing && <PatientFormDialog open={editing} onOpenChange={setEditing} patient={p} />}
      {prescribing && <PrescriptionFormDialog open={prescribing} onOpenChange={setPrescribing} patient={p}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["patient", id] }); }} />}
    </>
  );
}
