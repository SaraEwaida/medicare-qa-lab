import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { notifyError, notifyOk } from "@/lib/notify";
import type { Patient } from "@/lib/types";
import { todayISO } from "@/lib/utils";

type Values = { first_name: string; last_name: string; date_of_birth: string; email: string; phone: string; address: string; allergies: string };
const EMPTY: Values = { first_name: "", last_name: "", date_of_birth: "", email: "", phone: "", address: "", allergies: "" };

export function validatePatient(v: Values): Partial<Record<keyof Values, string>> {
  const e: Partial<Record<keyof Values, string>> = {};
  if (!v.first_name.trim()) e.first_name = "First name is required.";
  else if (v.first_name.trim().length > 60) e.first_name = "Use 60 characters or fewer.";
  if (!v.last_name.trim()) e.last_name = "Last name is required.";
  else if (v.last_name.trim().length > 60) e.last_name = "Use 60 characters or fewer.";
  if (!v.date_of_birth) e.date_of_birth = "Date of birth is required.";
  else if (v.date_of_birth > todayISO()) e.date_of_birth = "Date of birth cannot be in the future.";
  else if (v.date_of_birth <= "1900-01-01") e.date_of_birth = "Date of birth must be after 1900-01-01.";
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.email = "Enter a valid email address.";
  if (v.phone && !/^\+?[0-9 ()-]{7,20}$/.test(v.phone)) e.phone = "Use digits, spaces, dashes or brackets (7–20 characters).";
  return e;
}

export function PatientFormDialog({ open, onOpenChange, patient, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; patient?: Patient; onSaved?: (p: Patient) => void;
}) {
  const qc = useQueryClient();
  const initial: Values = patient ? {
    first_name: patient.first_name, last_name: patient.last_name, date_of_birth: patient.date_of_birth ?? "",
    email: patient.email ?? "", phone: patient.phone ?? "", address: patient.address ?? "", allergies: patient.allergies ?? "",
  } : EMPTY;
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => patient
      ? api<Patient>(`/patients/${patient.id}`, { method: "PATCH", body: { ...body, updated_at: patient.updated_at } })
      : api<Patient>("/patients", { method: "POST", body }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["patient", String(p.id)] });
      notifyOk(patient ? "Patient updated" : "Patient created", `${p.patient_code} · ${p.first_name} ${p.last_name}`);
      onOpenChange(false);
      onSaved?.(p);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        setErrors(err.fieldErrors() as typeof errors);
        setFormError(err.details.some((d) => !d.field) ? err.message : null);
      } else if (err instanceof ApiError && err.status === 409) {
        setFormError(err.message);
      } else notifyError(err);
    },
  });

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validatePatient(v);
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() === "" ? null : x.trim()]));
    save.mutate(body);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setErrors({}); setFormError(null); setV(initial); } }}
      title={patient ? `Edit ${patient.patient_code}` : "New patient"} description="Fictional data only. Fields marked * are required." wide
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="submit" form="patient-form" loading={save.isPending}>{patient ? "Save changes" : "Create patient"}</Button>
      </>}>
      <form id="patient-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required error={errors.first_name}>{(a) => <Input {...a} name="first_name" value={v.first_name} onChange={set("first_name")} autoFocus />}</Field>
        <Field label="Last name" required error={errors.last_name}>{(a) => <Input {...a} name="last_name" value={v.last_name} onChange={set("last_name")} />}</Field>
        <Field label="Date of birth" required error={errors.date_of_birth}>{(a) => <Input {...a} name="date_of_birth" type="date" max={todayISO()} value={v.date_of_birth} onChange={set("date_of_birth")} />}</Field>
        <Field label="Phone" error={errors.phone} hint="e.g. +970 59 123 4567">{(a) => <Input {...a} name="phone" type="tel" value={v.phone} onChange={set("phone")} />}</Field>
        <Field label="Email" error={errors.email} className="sm:col-span-2">{(a) => <Input {...a} name="email" type="email" value={v.email} onChange={set("email")} />}</Field>
        <Field label="Address" error={errors.address} className="sm:col-span-2">{(a) => <Input {...a} name="address" value={v.address} onChange={set("address")} />}</Field>
        <Field label="Allergies" error={errors.allergies} hint="Leave empty if none are known." className="sm:col-span-2">{(a) => <Textarea {...a} name="allergies" rows={2} value={v.allergies} onChange={set("allergies")} />}</Field>
        {formError && <p role="alert" className="sm:col-span-2 rounded-lg bg-bad-50 px-3 py-2 text-[13px] text-bad-700">{formError}</p>}
      </form>
    </Dialog>
  );
}
