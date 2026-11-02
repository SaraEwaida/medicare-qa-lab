import { useQuery } from "@tanstack/react-query";
import { Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, IdChip, PageHeader, Pagination, SearchBox, StatusBadge, Table, TableSkeleton, Td, Th, useDebounced } from "@/components/common";
import { Button, Card, Select } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Patient } from "@/lib/types";
import { fmtDate } from "@/lib/utils";
import { PatientFormDialog } from "./PatientForm";

export default function PatientsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "";
  const page = Number(params.get("page") ?? 1);
  const dq = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["patients", dq, status, sort, page],
    queryFn: () => api<Page<Patient>>("/patients", { query: { q: dq, status, sort, page, page_size: 15 } }),
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <PageHeader title="Patients" description="Fictional patient directory. Search by name, patient ID, email or phone."
        actions={can("patients:write") && <Button onClick={() => setCreating(true)}><Plus className="size-4" />New patient</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 p-4">
          <SearchBox className="flex-1 min-w-[220px]" label="Search patients" placeholder="Name, P-1001, email or phone"
            value={q} onChange={(v) => { setQ(v); update({ q: v.trim() }); }} />
          <Select aria-label="Filter by status" value={status} onChange={(e) => update({ status: e.target.value })} className="w-auto">
            <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(e) => update({ sort: e.target.value })} className="w-auto">
            <option value="">Newest first</option><option value="last_name">Last name A–Z</option>
            <option value="-last_name">Last name Z–A</option><option value="patient_code">Patient ID</option>
          </Select>
        </div>
        {!can("patients:write") && <p className="mx-4 mb-3 rounded-lg bg-info-50 px-3 py-2 text-[13px] text-info-700">Contact details are masked for your role.</p>}
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table className={isFetching && !isLoading ? "opacity-70 transition-opacity" : ""}>
              <thead><tr><Th>Patient ID</Th><Th>Name</Th><Th>Date of birth</Th><Th>Contact</Th><Th>Active Rx</Th><Th>Status</Th></tr></thead>
              {isLoading ? <TableSkeleton cols={6} /> : (
                <tbody>
                  {data?.items.length === 0 && (
                    <tr><Td colSpan={6}><EmptyState icon={<UserRound className="size-6" />} title="No patients match"
                      body={dq ? `Nothing found for “${dq}”. Check the spelling or clear filters.` : "Try a different filter."} /></Td></tr>
                  )}
                  {data?.items.map((p) => (
                    <tr key={p.id} className="hover:bg-canvas/60 cursor-pointer" onClick={() => nav(`/patients/${p.id}`)}>
                      <Td><IdChip value={p.patient_code} to={`/patients/${p.id}`} /></Td>
                      <Td className="font-medium">{p.first_name} {p.last_name}</Td>
                      <Td className="text-ink-2">{p.date_of_birth ? fmtDate(p.date_of_birth) : <span className="text-ink-3">Hidden</span>}</Td>
                      <Td className="text-ink-2"><span className="block">{p.phone ?? "—"}</span><span className="block text-[12.5px] text-ink-3">{p.email ?? ""}</span></Td>
                      <Td className="tabular-nums">{p.active_prescriptions}</Td>
                      <Td><StatusBadge status={p.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </Table>
            {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => update({ page: String(p) })} />}
          </>
        )}
      </Card>
      {creating && <PatientFormDialog open={creating} onOpenChange={setCreating} onSaved={(p) => nav(`/patients/${p.id}`)} />}
    </>
  );
}
