import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Dialog, Field, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Refill } from "@/lib/types";
import { uid } from "@/lib/utils";

/** Shared refill mutations. Every success invalidates refills, prescriptions and dashboard so status is never stale. */
export function useRefillActions() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const k of ["refills", "prescriptions", "prescription", "summary", "recent", "notifications", "patient"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: "approve" | "reject" | "dispense" | "cancel"; reason?: string }) =>
      api<Refill>(`/refill-requests/${id}/${action}`, { method: "POST", body: action === "reject" ? { reason } : undefined }),
    onSuccess: (r, vars) => {
      const verb = { approve: "approved", reject: "rejected", dispense: "marked dispensed", cancel: "cancelled" }[vars.action];
      notifyOk(`Refill ${verb}`, `${r.rx_code} · ${r.refills_remaining} refill(s) remaining`);
      refresh();
    },
    onError: (e) => { notifyError(e); refresh(); },
  });
  const submit = useMutation({
    mutationFn: ({ prescriptionId, notes }: { prescriptionId: number; notes?: string }) =>
      api<Refill>("/refill-requests", { method: "POST", body: { prescription_id: prescriptionId, notes: notes || null },
        headers: { "Idempotency-Key": uid() } }),
    onSuccess: (r) => { notifyOk("Refill requested", `${r.rx_code} is waiting for review`); refresh(); },
    onError: (e) => notifyError(e),
  });
  return { act, submit };
}

export function RejectDialog({ refill, onClose, onReject, busy }: {
  refill: { id: number; rx_code: string } | null; onClose: () => void; onReject: (reason: string) => void; busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  return (
    <Dialog open={Boolean(refill)} onOpenChange={(o) => !o && onClose()} title={`Reject refill for ${refill?.rx_code ?? ""}`}
      description="The reason is visible in the prescription's refill history."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} onClick={() => {
          if (reason.trim().length < 3) { setError("Enter a reason (at least 3 characters)."); return; }
          onReject(reason.trim());
        }}>Reject refill</Button></>}>
      <Field label="Reason" required error={error}>
        {(a) => <Textarea {...a} value={reason} onChange={(e) => { setReason(e.target.value); setError(undefined); }} placeholder="e.g. Prescriber requested hold" />}
      </Field>
    </Dialog>
  );
}
