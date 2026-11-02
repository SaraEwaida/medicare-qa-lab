import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Lock, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorState, IdChip, KV, PageHeader, PriorityBadge, StatusBadge } from "@/components/common";
import { Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Bug as BugT, TicketDetail as T, TicketStatus, UserRef } from "@/lib/types";
import { cn, fmtDateTime, humanize, timeAgo } from "@/lib/utils";
import { PRIORITIES } from "./TicketsPage";

const NEXT: Record<TicketStatus, { to: TicketStatus; label: string }[]> = {
  open: [{ to: "investigating", label: "Start investigating" }, { to: "escalated", label: "Escalate" }],
  investigating: [{ to: "escalated", label: "Escalate" }, { to: "resolved", label: "Resolve" }],
  escalated: [{ to: "investigating", label: "Back to investigating" }, { to: "resolved", label: "Resolve" }],
  resolved: [{ to: "closed", label: "Close" }, { to: "investigating", label: "Reopen" }],
  closed: [],
};

function eventText(e: T["events"][number]) {
  switch (e.event_type) {
    case "created": return "created the ticket";
    case "assigned": return e.to_value ? `assigned to ${e.to_value}` : "removed the assignee";
    case "status_changed": return `changed status ${humanize(e.from_value)} → ${humanize(e.to_value)}`;
    case "escalated": return "escalated the ticket";
    case "priority_changed": return `changed priority ${humanize(e.from_value)} → ${humanize(e.to_value)}`;
    case "note_added": return `added ${e.to_value === "public" ? "a reply" : "an internal note"}`;
    case "converted_to_bug": return `converted to bug ${e.to_value}`;
    default: return humanize(e.event_type);
  }
}

export default function TicketDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [transition, setTransition] = useState<TicketStatus | null>(null);
  const [converting, setConverting] = useState(false);
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(true);
  const t = useQuery({ queryKey: ["ticket", id], queryFn: () => api<T>(`/tickets/${id}`) });
  const users = useQuery({ queryKey: ["users"], enabled: can("tickets:manage"), queryFn: () => api<UserRef[]>("/users"), staleTime: 300_000 });
  const setData = (d: T) => { qc.setQueryData(["ticket", id], d); qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); };

  const assign = useMutation({ mutationFn: (assignee_id: number | null) => api<T>(`/tickets/${id}/assign`, { method: "POST", body: { assignee_id } }),
    onSuccess: (d) => { setData(d); notifyOk(d.assignee ? `Assigned to ${d.assignee.full_name}` : "Assignee removed"); }, onError: (e) => notifyError(e) });
  const prio = useMutation({ mutationFn: (priority: string) => api<T>(`/tickets/${id}`, { method: "PATCH", body: { priority } }),
    onSuccess: (d) => { setData(d); notifyOk(`Priority set to ${humanize(d.priority)}`); }, onError: (e) => notifyError(e) });
  const addNote = useMutation({ mutationFn: () => api(`/tickets/${id}/notes`, { method: "POST", body: { body: note.trim(), is_internal: internal } }),
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: ["ticket", id] }); notifyOk(internal ? "Internal note added" : "Reply added"); }, onError: (e) => notifyError(e) });

  if (t.isLoading) return <Spinner label="Loading ticket" />;
  if (t.error || !t.data) return <div className="card"><ErrorState error={t.error} onRetry={t.refetch} /></div>;
  const d = t.data;
  const manage = can("tickets:manage");
  const assignable = users.data?.filter((u) => u.role !== "pharmacist") ?? [];

  return (
    <>
      <PageHeader back={{ to: "/tickets", label: "Support Center" }}
        title={d.subject}
        description={<span className="flex flex-wrap items-center gap-2"><IdChip value={d.ticket_code} /><StatusBadge status={d.status} /><PriorityBadge value={d.priority} /><span className="text-ink-3">opened {timeAgo(d.created_at)} by {d.reporter_name}</span></span>}
        actions={<>
          {can("tickets:convert") && <Button variant="secondary" onClick={() => setConverting(true)}><Bug className="size-4" />Convert to bug</Button>}
          {manage && NEXT[d.status].map((n, i) => (
            <Button key={n.to} variant={i === 0 ? "primary" : "secondary"} onClick={() => setTransition(n.to)}>{n.label}</Button>
          ))}
        </>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader title="Customer report" />
            <div className="px-5 pb-5">
              <p className="whitespace-pre-wrap leading-relaxed max-w-[75ch]">{d.description}</p>
              {d.resolution && (
                <div className="mt-4 rounded-xl bg-ok-50 px-4 py-3">
                  <p className="text-[13px] font-medium text-ok-700">Resolution</p>
                  <p className="text-[13.5px] mt-0.5 whitespace-pre-wrap">{d.resolution}</p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Investigation" description={can("tickets:notes_read") ? "Internal notes are visible to support and QA only." : "Replies from the support team."} />
            <ol className="px-5 space-y-3">
              {d.notes.length === 0 && <li className="text-[13px] text-ink-3 pb-2">No notes yet.</li>}
              {d.notes.map((n) => (
                <li key={n.id} className={cn("rounded-xl border px-4 py-3", n.is_internal ? "border-warn-700/20 bg-warn-50/60" : "border-line")}>
                  <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                    <span className="font-medium text-ink">{n.author.full_name}</span>
                    {n.is_internal ? <span className="inline-flex items-center gap-1 text-warn-700"><Lock className="size-3" />Internal</span> : <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" />Reply</span>}
                    <span>{fmtDateTime(n.created_at)}</span>
                  </p>
                  <p className="text-[13.5px] mt-1 whitespace-pre-wrap">{n.body}</p>
                </li>
              ))}
            </ol>
            {manage && d.status !== "closed" && (
              <form className="p-5 grid gap-3" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
                <Field label="Add a note">{(a) => <Textarea {...a} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Findings, request IDs checked, next steps…" />}</Field>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-[13px] text-ink-2">
                    <input type="checkbox" className="size-4 accent-teal-600" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (hidden from the reporter)
                  </label>
                  <Button type="submit" size="sm" disabled={!note.trim()} loading={addNote.isPending}>{internal ? "Add internal note" : "Send reply"}</Button>
                </div>
              </form>
            )}
            {!manage && <div className="h-4" />}
          </Card>

          <Card>
            <CardHeader title="History" />
            <ol className="px-5 pb-5 space-y-2.5">
              {d.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-[13px]">
                  <span className="text-ink-3 w-28 shrink-0 whitespace-nowrap">{fmtDateTime(e.created_at)}</span>
                  <span><span className="font-medium">{e.actor?.full_name ?? "System"}</span> {eventText(e)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Ticket" />
            <div className="px-5 pb-5 space-y-4">
              {manage && d.status !== "closed" ? (
                <>
                  <Field label="Assignee">{(a) => (
                    <Select {...a} value={d.assignee?.id ?? ""} disabled={assign.isPending} onChange={(e) => assign.mutate(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Unassigned</option>
                      {assignable.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </Select>)}</Field>
                  <Field label="Priority">{(a) => (
                    <Select {...a} value={d.priority} disabled={prio.isPending} onChange={(e) => prio.mutate(e.target.value)}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                    </Select>)}</Field>
                </>
              ) : <KV items={[["Assignee", d.assignee?.full_name ?? "Unassigned"], ["Priority", humanize(d.priority)]]} />}
              <KV items={[
                ["Category", humanize(d.category)], ["Reporter", d.reporter_name], ["Reporter email", d.reporter_email],
                ["Created by", d.creator?.full_name], ["Resolved", fmtDateTime(d.resolved_at)], ["Closed", fmtDateTime(d.closed_at)],
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Diagnostics" />
            <div className="px-5 pb-5">
              <KV items={[
                ["Browser", d.browser], ["OS", d.os], ["App version", d.app_version],
                ["Request ID", d.related_request_id ? (
                  <span className="flex flex-col gap-1"><IdChip value={d.related_request_id} />
                    {can("logs:read") && <Link className="link text-[12.5px]" to={`/api-explorer?tab=trace&rid=${encodeURIComponent(d.related_request_id)}`}>Trace in logs</Link>}</span>
                ) : null],
                ["Related patient", d.patient_id ? <Link className="link" to={`/patients/${d.patient_id}`}>Open patient</Link> : null],
                ["Related Rx", d.prescription_id ? <Link className="link" to={`/prescriptions/${d.prescription_id}`}>Open prescription</Link> : null],
              ]} />
              {d.diagnostic_notes && <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-[13px] whitespace-pre-wrap">{d.diagnostic_notes}</p>}
            </div>
          </Card>
          {d.linked_bugs.length > 0 && (
            <Card>
              <CardHeader title="Linked bugs" />
              <ul className="px-5 pb-4 space-y-2">
                {d.linked_bugs.map((b) => <li key={b.id} className="flex items-center gap-2"><IdChip value={b.bug_code} to={`/qa/bugs/${b.id}`} /><span className="flex-1 truncate text-[13px]">{b.title}</span><StatusBadge status={b.status} /></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {transition && <TransitionDialog ticket={d} to={transition} onClose={() => setTransition(null)} onDone={setData} />}
      {converting && <ConvertDialog ticket={d} onClose={() => setConverting(false)} onDone={(b) => { qc.invalidateQueries({ queryKey: ["ticket", id] }); nav(`/qa/bugs/${b.id}`); }} />}
    </>
  );
}

function TransitionDialog({ ticket, to, onClose, onDone }: { ticket: T; to: TicketStatus; onClose: () => void; onDone: (d: T) => void }) {
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState(ticket.resolution ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api<T>(`/tickets/${ticket.id}/status`, { method: "POST", body: { status: to, note: note.trim() || null, resolution: resolution.trim() || null } }),
    onSuccess: (d) => { onDone(d); notifyOk(`Ticket ${humanize(to).toLowerCase()}`, ticket.ticket_code); onClose(); },
    onError: (e) => (e instanceof ApiError && e.status === 422 ? setErrors(e.fieldErrors()) : notifyError(e)),
  });
  const needsNote = to === "escalated";
  const needsResolution = to === "resolved";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${humanize(ticket.status)} → ${humanize(to)}`} description={ticket.ticket_code}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => {
        const errs: Record<string, string> = {};
        if (needsNote && !note.trim()) errs.note = "Explain why this needs escalation.";
        if (needsResolution && !resolution.trim()) errs.resolution = "Describe how the issue was resolved.";
        setErrors(errs);
        if (!Object.keys(errs).length) m.mutate();
      }}>Confirm</Button></>}>
      <div className="grid gap-4">
        {needsResolution && <Field label="Resolution" required error={errors.resolution}>{(a) => <Textarea {...a} rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />}</Field>}
        <Field label={needsNote ? "Escalation note" : "Internal note"} required={needsNote} error={errors.note} hint={needsNote ? undefined : "Optional"}>
          {(a) => <Textarea {...a} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

function ConvertDialog({ ticket, onClose, onDone }: { ticket: T; onClose: () => void; onDone: (b: BugT) => void }) {
  const [title, setTitle] = useState(ticket.subject);
  const [severity, setSeverity] = useState("major");
  const [priority, setPriority] = useState("p2");
  const [steps, setSteps] = useState("");
  const m = useMutation({
    mutationFn: () => api<BugT>(`/tickets/${ticket.id}/convert-to-bug`, { method: "POST", body: { title: title.trim(), severity, priority, steps_to_reproduce: steps.trim() || null } }),
    onSuccess: (b) => { notifyOk(`${b.bug_code} created`, `Linked to ${ticket.ticket_code}`); onDone(b); },
    onError: (e) => notifyError(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="Convert to engineering bug"
      description="Creates a bug report pre-filled from this ticket, linked in both directions. Diagnostics and request ID are copied as evidence."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Create bug</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bug title" required className="sm:col-span-2">{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Severity" hint="Impact on users">{(a) => <Select {...a} value={severity} onChange={(e) => setSeverity(e.target.value)}>{["critical", "major", "minor", "trivial"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>}</Field>
        <Field label="Priority" hint="Order of fixing">{(a) => <Select {...a} value={priority} onChange={(e) => setPriority(e.target.value)}>{["p1", "p2", "p3", "p4"].map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</Select>}</Field>
        <Field label="Steps to reproduce" hint="Optional now; QA confirms during triage." className="sm:col-span-2">{(a) => <Textarea {...a} rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={"1. Log in as Pharmacist\n2. …"} />}</Field>
      </div>
    </Dialog>
  );
}
