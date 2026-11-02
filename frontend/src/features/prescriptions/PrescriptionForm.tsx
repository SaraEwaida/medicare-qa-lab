import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useDebounced } from "@/components/common";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";
import { ApiError, api, type Page } from "@/lib/api";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Medication, Patient, Prescription } from "@/lib/types";
import { todayISO } from "@/lib/utils";

type Values = { patient_id: string; medication_id: string; prescriber_name: string; dosage_instructions: string;
  quantity: string; refills_authorized: string; start_date: string; end_date: string };

export function validateRx(v: Values) {
  const e: Partial<Record<keyof Values, string>> = {};
  if (!v.patient_id) e.patient_id = "Choose a patient.";
  if (!v.medication_id) e.medication_id = "Choose a medication.";
  if (v.prescriber_name.trim().length < 3) e.prescriber_name = "Enter the prescriber's name.";
  if (v.dosage_instructions.trim().length < 3) e.dosage_instructions = "Enter dosage instructions.";
  const q = Number(v.quantity);
  if (!v.quantity || !Number.isInteger(q) || q < 1 || q > 1000) e.quantity = "Quantity must be a whole number from 1 to 1000.";
  const r = Number(v.refills_authorized);
  if (v.refills_authorized === "" || !Number.isInteger(r) || r < 0 || r > 12) e.refills_authorized = "Refills must be from 0 to 12.";
  if (!v.start_date) e.start_date = "Start date is required.";
  if (v.end_date && v.start_date && v.end_date < v.start_date) e.end_date = "End date must be on or after the start date.";
  return e;
}

export function PrescriptionFormDialog({ open, onOpenChange, patient, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; patient?: Patient; onSaved?: (rx: Prescription) => void;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState<Values>({ patient_id: patient ? String(patient.id) : "", medication_id: "", prescriber_name: "",
    dosage_instructions: "", quantity: "30", refills_authorized: "3", start_date: todayISO(), end_date: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pq, setPq] = useState("");
  const dpq = useDebounced(pq.trim());
  const meds = useQuery({ queryKey: ["medications"], queryFn: () => api<Medication[]>("/medications"), staleTime: 300_000 });
  const patients = useQuery({ queryKey: ["patients", "picker", dpq], enabled: !patient && dpq.length >= 2,
    queryFn: () => api<Page<Patient>>("/patients", { query: { q: dpq, status: "active", page_size: 8 } }) });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Prescription>("/prescriptions", { method: "POST", body }),
    onSuccess: (rx) => {
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
      notifyOk("Prescription created", `${rx.rx_code} · ${rx.medication.name} for ${rx.patient.first_name} ${rx.patient.last_name}`);
      onOpenChange(false);
      onSaved?.(rx);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422 && err.details.length) setErrors(err.fieldErrors() as typeof errors);
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) setFormError(err.message);
      else notifyError(err);
    },
  });

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateRx(v);
    setErrors(errs); setFormError(null);
    if (Object.keys(errs).length) return;
    save.mutate({ patient_id: Number(v.patient_id), medication_id: Number(v.medication_id), prescriber_name: v.prescriber_name.trim(),
      dosage_instructions: v.dosage_instructions.trim(), quantity: Number(v.quantity), refills_authorized: Number(v.refills_authorized),
      start_date: v.start_date, end_date: v.end_date || null });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="New prescription"
      description={patient ? `For ${patient.first_name} ${patient.last_name} (${patient.patient_code})` : "Fictional prescriptions only."}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="submit" form="rx-form" loading={save.isPending}>Create prescription</Button></>}>
      <form id="rx-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {!patient && (
          <div className="sm:col-span-2 grid gap-2">
            <Field label="Find patient" hint="Type at least 2 characters of a name or patient ID.">
              {(a) => <Input {...a} value={pq} onChange={(e) => setPq(e.target.value)} placeholder="e.g. Turner or P-1001" />}
            </Field>
            <Field label="Patient" required error={errors.patient_id}>
              {(a) => (
                <Select {...a} name="patient_id" value={v.patient_id} onChange={set("patient_id")}>
                  <option value="">{patients.data ? `${patients.data.total} match(es) — choose one` : "Search above first"}</option>
                  {patients.data?.items.map((p) => <option key={p.id} value={p.id}>{p.patient_code} · {p.first_name} {p.last_name}</option>)}
                </Select>
              )}
            </Field>
          </div>
        )}
        <Field label="Medication" required error={errors.medication_id} className="sm:col-span-2">
          {(a) => (
            <Select {...a} name="medication_id" value={v.medication_id} onChange={set("medication_id")}>
              <option value="">Choose medication</option>
              {meds.data?.map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength} ({m.form}){m.is_controlled ? " · controlled" : ""}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Prescriber" required error={errors.prescriber_name}>{(a) => <Input {...a} name="prescriber_name" value={v.prescriber_name} onChange={set("prescriber_name")} placeholder="Dr. Rana Aziz" />}</Field>
        <Field label="Dosage instructions" required error={errors.dosage_instructions}>{(a) => <Input {...a} name="dosage_instructions" value={v.dosage_instructions} onChange={set("dosage_instructions")} placeholder="1 tablet once daily" />}</Field>
        <Field label="Quantity" required error={errors.quantity} hint="1–1000">{(a) => <Input {...a} name="quantity" type="number" inputMode="numeric" min={1} max={1000} value={v.quantity} onChange={set("quantity")} />}</Field>
        <Field label="Refills authorized" required error={errors.refills_authorized} hint="0–12">{(a) => <Input {...a} name="refills_authorized" type="number" inputMode="numeric" min={0} max={12} value={v.refills_authorized} onChange={set("refills_authorized")} />}</Field>
        <Field label="Start date" required error={errors.start_date}>{(a) => <Input {...a} name="start_date" type="date" value={v.start_date} onChange={set("start_date")} />}</Field>
        <Field label="End date" error={errors.end_date} hint="Optional">{(a) => <Input {...a} name="end_date" type="date" min={v.start_date} value={v.end_date} onChange={set("end_date")} />}</Field>
        {formError && <p role="alert" className="sm:col-span-2 rounded-lg bg-bad-50 px-3 py-2 text-[13px] text-bad-700">{formError}</p>}
      </form>
    </Dialog>
  );
}
