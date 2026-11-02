import { useQuery } from "@tanstack/react-query";
import { Pill, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, IdChip, PageHeader, Pagination, SearchBox, StatusBadge, Table, TableSkeleton, Td, Th, useDebounced } from "@/components/common";
import { Button, Card, Select, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Prescription, Refill } from "@/lib/types";
import { fmtDate, timeAgo } from "@/lib/utils";
import { PrescriptionFormDialog } from "./PrescriptionForm";
import { RejectDialog, useRefillActions } from "./refillActions";

function useParamState() {
  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };
  return { params, update };
}

function PrescriptionList() {
  const nav = useNavigate();
  const { params, update } = useParamState();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q.trim());
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["prescriptions", dq, status, page],
    queryFn: () => api<Page<Prescription>>("/prescriptions", { query: { q: dq, status, page, page_size: 15 } }),
    placeholderData: (prev) => prev,
  });
  return (
    <Card>
      <div className="flex flex-wrap gap-3 p-4">
        <SearchBox className="flex-1 min-w-[220px]" label="Search prescriptions" placeholder="RX code, medication, patient name or ID"
          value={q} onChange={(v) => { setQ(v); update({ q: v.trim() }); }} />
        <Select aria-label="Filter by status" value={status} onChange={(e) => update({ status: e.target.value })} className="w-auto">
          <option value="">All statuses</option><option value="active">Active</option><option value="refill_due">Refill due</option>
          <option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
        </Select>
      </div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          <Table>
            <thead><tr><Th>RX</Th><Th>Patient</Th><Th>Medication</Th><Th>Dosage</Th><Th>Refills left</Th><Th>Started</Th><Th>Status</Th></tr></thead>
            {isLoading ? <TableSkeleton cols={7} /> : (
              <tbody>
                {data?.items.length === 0 && <tr><Td colSpan={7}><EmptyState icon={<Pill className="size-6" />} title="No prescriptions match" body="Clear the search or choose another status." /></Td></tr>}
                {data?.items.map((rx) => (
                  <tr key={rx.id} className="hover:bg-canvas/60 cursor-pointer" onClick={() => nav(`/prescriptions/${rx.id}`)}>
                    <Td><IdChip value={rx.rx_code} to={`/prescriptions/${rx.id}`} /></Td>
                    <Td><span className="block font-medium">{rx.patient.first_name} {rx.patient.last_name}</span><span className="id-chip text-ink-3">{rx.patient.patient_code}</span></Td>
                    <Td>{rx.medication.name} <span className="text-ink-3">{rx.medication.strength}</span></Td>
                    <Td className="text-ink-2 max-w-[220px] truncate">{rx.dosage_instructions}</Td>
                    <Td className="tabular-nums">{rx.refills_remaining} / {rx.refills_authorized}</Td>
                    <Td className="text-ink-2 whitespace-nowrap">{fmtDate(rx.start_date)}</Td>
                    <Td><StatusBadge status={rx.status} /></Td>
                  </tr>
                ))}
              </tbody>
            )}
          </Table>
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => update({ page: String(p) })} />}
        </>
      )}
    </Card>
  );
}

function RefillQueue() {
  const { can } = useAuth();
  const { params, update } = useParamState();
  const status = params.get("rstatus") ?? "pending";
  const page = Number(params.get("page") ?? 1);
  const { act } = useRefillActions();
  const [rejecting, setRejecting] = useState<Refill | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["refills", status, page],
    queryFn: () => api<Page<Refill>>("/refill-requests", { query: { status, page, page_size: 15, sort: status === "pending" ? "requested_at" : "-requested_at" } }),
  });
  const reviewer = can("refills:review");
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <Select aria-label="Refill status" value={status} onChange={(e) => update({ rstatus: e.target.value })} className="w-auto">
          <option value="pending">Pending review</option><option value="approved">Approved</option><option value="dispensed">Dispensed</option>
          <option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="">All</option>
        </Select>
        {status === "pending" && <p className="text-[13px] text-ink-3">Oldest requests first.</p>}
      </div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          <Table>
            <thead><tr><Th>RX</Th><Th>Patient</Th><Th>Medication</Th><Th>Requested</Th><Th>Refills left</Th><Th>Status</Th>{reviewer && <Th className="text-right">Actions</Th>}</tr></thead>
            {isLoading ? <TableSkeleton cols={reviewer ? 7 : 6} /> : (
              <tbody>
                {data?.items.length === 0 && <tr><Td colSpan={7}><EmptyState title={status === "pending" ? "No refills waiting" : "Nothing here"} body={status === "pending" ? "New refill requests will appear here for review." : undefined} /></Td></tr>}
                {data?.items.map((r) => (
                  <tr key={r.id} data-testid={`refill-row-${r.id}`}>
                    <Td><IdChip value={r.rx_code} to={`/prescriptions/${r.prescription_id}`} /></Td>
                    <Td>{r.patient.first_name} {r.patient.last_name}</Td>
                    <Td>{r.medication}</Td>
                    <Td className="text-ink-2 whitespace-nowrap" >{timeAgo(r.requested_at)}{r.requested_by && <span className="block text-[12px] text-ink-3">by {r.requested_by}</span>}</Td>
                    <Td className="tabular-nums">{r.refills_remaining}</Td>
                    <Td><StatusBadge status={r.status} />{r.rejection_reason && <span className="block text-[12px] text-ink-3 mt-0.5">{r.rejection_reason}</span>}</Td>
                    {reviewer && (
                      <Td className="text-right whitespace-nowrap">
                        {r.status === "pending" && <>
                          <Button size="sm" variant="secondary" className="mr-2" onClick={() => setRejecting(r)}>Reject</Button>
                          <Button size="sm" loading={act.isPending && act.variables?.id === r.id && act.variables.action === "approve"}
                            onClick={() => act.mutate({ id: r.id, action: "approve" })}>Approve</Button>
                        </>}
                        {r.status === "approved" && <Button size="sm" variant="subtle" onClick={() => act.mutate({ id: r.id, action: "dispense" })}>Mark dispensed</Button>}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            )}
          </Table>
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => update({ page: String(p) })} />}
        </>
      )}
      <RejectDialog refill={rejecting} onClose={() => setRejecting(null)} busy={act.isPending}
        onReject={(reason) => rejecting && act.mutate({ id: rejecting.id, action: "reject", reason }, { onSuccess: () => setRejecting(null) })} />
    </Card>
  );
}

export default function PrescriptionsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { params, update } = useParamState();
  const [creating, setCreating] = useState(false);
  const tab = params.get("tab") ?? "list";
  return (
    <>
      <PageHeader title="Prescriptions" description="Prescription records and the refill review queue."
        actions={can("prescriptions:write") && <Button onClick={() => setCreating(true)}><Plus className="size-4" />New prescription</Button>} />
      <Tabs value={tab} onValueChange={(t) => update({ tab: t === "list" ? "" : t, status: "", q: "" })}>
        <TabsList className="mb-4">
          <TabsTrigger value="list">All prescriptions</TabsTrigger>
          <TabsTrigger value="refills">Refill queue</TabsTrigger>
        </TabsList>
        <TabsContent value="list"><PrescriptionList /></TabsContent>
        <TabsContent value="refills"><RefillQueue /></TabsContent>
      </Tabs>
      {creating && <PrescriptionFormDialog open={creating} onOpenChange={setCreating} onSaved={(rx) => nav(`/prescriptions/${rx.id}`)} />}
    </>
  );
}
