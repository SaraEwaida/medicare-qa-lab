import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, IdChip, PageHeader, Pagination, PriorityBadge, SearchBox, StatusBadge, Table, TableSkeleton, Td, Th, useDebounced } from "@/components/common";
import { Button, Card, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Ticket, TicketDetail } from "@/lib/types";
import { humanize, timeAgo } from "@/lib/utils";

export const CATEGORIES = ["login_access", "prescription", "refill", "patient_data", "performance", "integration", "other"];
export const PRIORITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "investigating", "escalated", "resolved", "closed"];

function detectBrowser() {
  const ua = navigator.userAgent;
  const m = ua.match(/(Edg|Chrome|Firefox|Safari)\/(\d+)/);
  const browser = m ? `${m[1] === "Edg" ? "Edge" : m[1]} ${m[2]}` : "";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return { browser, os };
}

function NewTicketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const env = detectBrowser();
  const [v, setV] = useState({ subject: "", description: "", category: "", priority: "medium", reporter_name: user?.full_name ?? "",
    reporter_email: "", browser: env.browser, os: env.os, app_version: "1.0.0", related_request_id: "", diagnostic_notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<TicketDetail>("/tickets", { method: "POST", body }),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ["tickets"] }); notifyOk("Ticket created", `${t.ticket_code} · ${t.subject}`); onOpenChange(false); nav(`/tickets/${t.id}`); },
    onError: (e) => (e instanceof ApiError && e.status === 422 ? setErrors(e.fieldErrors()) : notifyError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.subject.trim().length < 5) errs.subject = "Subject must be at least 5 characters.";
    if (v.description.trim().length < 10) errs.description = "Describe the issue in at least 10 characters.";
    if (!v.category) errs.category = "Choose a category.";
    if (v.reporter_name.trim().length < 2) errs.reporter_name = "Enter who reported the issue.";
    if (v.reporter_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.reporter_email)) errs.reporter_email = "Enter a valid email address.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    m.mutate(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() === "" ? null : x.trim()])));
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="New support ticket"
      description="Diagnostic details help support reproduce the problem. Don't paste real patient data."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" form="ticket-form" loading={m.isPending}>Create ticket</Button></>}>
      <form id="ticket-form" noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Subject" required error={errors.subject} className="sm:col-span-2">{(a) => <Input {...a} name="subject" value={v.subject} onChange={set("subject")} placeholder="e.g. Refill approval doesn't update the queue" />}</Field>
        <Field label="Category" required error={errors.category}>{(a) => <Select {...a} name="category" value={v.category} onChange={set("category")}><option value="">Choose category</option>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select>}</Field>
        <Field label="Priority" required>{(a) => <Select {...a} name="priority" value={v.priority} onChange={set("priority")}>{PRIORITIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select>}</Field>
        <Field label="Description" required error={errors.description} className="sm:col-span-2" hint="What happened, what you expected, and the steps you took.">{(a) => <Textarea {...a} name="description" rows={4} value={v.description} onChange={set("description")} />}</Field>
        <Field label="Reported by" required error={errors.reporter_name}>{(a) => <Input {...a} name="reporter_name" value={v.reporter_name} onChange={set("reporter_name")} />}</Field>
        <Field label="Reporter email" error={errors.reporter_email}>{(a) => <Input {...a} name="reporter_email" type="email" value={v.reporter_email} onChange={set("reporter_email")} />}</Field>
        <fieldset className="sm:col-span-2 grid gap-4 sm:grid-cols-3 rounded-xl border border-line p-4">
          <legend className="px-1 text-[13px] font-medium">Diagnostic information</legend>
          <Field label="Browser">{(a) => <Input {...a} name="browser" value={v.browser} onChange={set("browser")} />}</Field>
          <Field label="Operating system">{(a) => <Input {...a} name="os" value={v.os} onChange={set("os")} />}</Field>
          <Field label="App version">{(a) => <Input {...a} name="app_version" value={v.app_version} onChange={set("app_version")} />}</Field>
          <Field label="Related request ID" hint="Shown in error messages, e.g. req_3f…" className="sm:col-span-3" error={errors.related_request_id}>{(a) => <Input {...a} name="related_request_id" className="font-mono" value={v.related_request_id} onChange={set("related_request_id")} />}</Field>
          <Field label="Diagnostic notes" hint="Console errors, HAR summary, screenshots description. Visible to support and QA only." className="sm:col-span-3">{(a) => <Textarea {...a} name="diagnostic_notes" rows={3} value={v.diagnostic_notes} onChange={set("diagnostic_notes")} />}</Field>
        </fieldset>
      </form>
    </Dialog>
  );
}

export default function TicketsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);
  const status = params.get("status") ?? "active";
  const priority = params.get("priority") ?? "";
  const category = params.get("category") ?? "";
  const unassigned = params.get("unassigned") === "true";
  const page = Number(params.get("page") ?? 1);
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };
  const statusFilter = status === "active" ? ["open", "investigating", "escalated"] : status === "all" ? [] : [status];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["tickets", dq, status, priority, category, unassigned, page],
    queryFn: () => api<Page<Ticket>>("/tickets", { query: { q: dq, status: statusFilter, priority, category, unassigned: unassigned || undefined, page, page_size: 15 } }),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader title="Support Center" description={can("tickets:read_all") ? "Customer issues, investigation and resolution." : "Report problems and follow their progress."}
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" />New ticket</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 p-4">
          <SearchBox className="flex-1 min-w-[220px]" label="Search tickets" placeholder="SUP code, subject, reporter or request ID" value={q} onChange={(v) => { setQ(v); update({ q: v.trim() }); }} />
          <Select aria-label="Status" value={status} onChange={(e) => update({ status: e.target.value })} className="w-auto">
            <option value="active">Open, investigating, escalated</option><option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select aria-label="Priority" value={priority} onChange={(e) => update({ priority: e.target.value })} className="w-auto">
            <option value="">Any priority</option>{PRIORITIES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select aria-label="Category" value={category} onChange={(e) => update({ category: e.target.value })} className="w-auto">
            <option value="">Any category</option>{CATEGORIES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          {can("tickets:read_all") && (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" className="size-4 accent-teal-600" checked={unassigned} onChange={(e) => update({ unassigned: e.target.checked ? "true" : "" })} /> Unassigned only
            </label>
          )}
        </div>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <thead><tr><Th>Ticket</Th><Th>Subject</Th><Th>Category</Th><Th>Priority</Th><Th>Status</Th><Th>Assignee</Th><Th>Created</Th></tr></thead>
              {isLoading ? <TableSkeleton cols={7} /> : (
                <tbody>
                  {data?.items.length === 0 && <tr><Td colSpan={7}><EmptyState icon={<LifeBuoy className="size-6" />} title="No tickets match" body="Change the filters, or create a ticket to report a problem." /></Td></tr>}
                  {data?.items.map((t) => (
                    <tr key={t.id} className="hover:bg-canvas/60 cursor-pointer" onClick={() => nav(`/tickets/${t.id}`)}>
                      <Td><IdChip value={t.ticket_code} to={`/tickets/${t.id}`} /></Td>
                      <Td className="font-medium max-w-[320px]"><span className="line-clamp-1">{t.subject}</span><span className="block text-[12px] text-ink-3 font-normal">{t.reporter_name}</span></Td>
                      <Td className="text-ink-2">{humanize(t.category)}</Td>
                      <Td><PriorityBadge value={t.priority} /></Td>
                      <Td><StatusBadge status={t.status} /></Td>
                      <Td className="text-ink-2">{t.assignee?.full_name ?? <span className="text-ink-3">Unassigned</span>}</Td>
                      <Td className="text-ink-2 whitespace-nowrap">{timeAgo(t.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </Table>
            {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => update({ page: String(p) })} />}
          </>
        )}
      </Card>
      {creating && <NewTicketDialog open={creating} onOpenChange={setCreating} />}
    </>
  );
}
