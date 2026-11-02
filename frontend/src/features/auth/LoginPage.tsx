import { ClipboardCheck, LifeBuoy, Pill } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const DEMO_PASSWORD = "Demo@2026!";
const DEMO_ACCOUNTS = [
  { email: "pharmacist@medicare.example.com", role: "Pharmacist", icon: Pill,
    does: "Manage patients, prescriptions and refill approvals." },
  { email: "support@medicare.example.com", role: "Support Engineer", icon: LifeBuoy,
    does: "Investigate tickets with logs and request IDs." },
  { email: "qa@medicare.example.com", role: "QA Engineer", icon: ClipboardCheck,
    does: "Run test cases, file bugs, reproduce defects in the Bug Lab." },
];

export default function LoginPage() {
  const { user, login, sessionMessage } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string; requestId?: string | null }>({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={loc.state?.from ?? "/"} replace />;

  async function submit(e: FormEvent, override?: { email: string; password: string }) {
    e.preventDefault();
    const creds = override ?? { email: email.trim(), password };
    const next: typeof errors = {};
    if (!creds.email) next.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(creds.email)) next.email = "Enter a valid email address.";
    if (!creds.password) next.password = "Enter your password.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await login(creds.email, creds.password);
      nav(loc.state?.from ?? "/", { replace: true });
    } catch (err) {
      const e2 = err instanceof ApiError ? err : null;
      setErrors({ form: e2?.message ?? "Sign-in failed.", requestId: e2?.requestId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="hidden lg:flex flex-col justify-between bg-slab text-teal-50 p-12 relative overflow-hidden">
        <svg aria-hidden viewBox="0 0 600 600" className="absolute -right-40 -bottom-40 w-[640px] opacity-[0.07]">
          <path d="M240 60h120v180h180v120H360v180H240V360H60V240h180z" fill="#fff" />
        </svg>
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 32 32" className="size-10" aria-hidden><rect width="32" height="32" rx="8" fill="#0b7a75" /><path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#fff" /></svg>
          <span className="text-lg font-semibold text-white">MediCare QA Lab</span>
        </div>
        <div className="max-w-[34rem] relative">
          <h1 className="text-[40px] leading-[1.1] font-semibold text-white">The pharmacy runs here. So does every test, ticket and trace behind it.</h1>
          <p className="mt-5 text-[16px] text-teal-50/75 max-w-[46ch]">
            A working pharmacy and support platform with its own QA workspace: real APIs, real database checks,
            and defects you can switch on to reproduce, investigate and verify.
          </p>
        </div>
        <p className="text-[13px] text-teal-50/50">All patients and records are fictional. Not HIPAA-compliant; not for clinical use.</p>
      </section>

      <section className="flex flex-col justify-center px-6 py-10 sm:px-12 bg-card">
        <div className="w-full max-w-sm mx-auto">
          <h2 className="text-[24px] font-semibold">Sign in</h2>
          <p className="text-ink-3 mt-1">Use a demo account below or your own credentials.</p>
          {sessionMessage && <p className="mt-4 rounded-lg bg-warn-50 px-3 py-2 text-[13px] text-warn-700">{sessionMessage}</p>}

          <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
            <Field label="Email" error={errors.email}>
              {(a) => <Input {...a} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label="Password" error={errors.password}>
              {(a) => <Input {...a} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            {errors.form && (
              <div role="alert" className="rounded-lg bg-bad-50 px-3 py-2 text-[13px] text-bad-700">
                {errors.form}
                {errors.requestId && <span className="block text-[12px] opacity-80 mt-0.5">Request ID <span className="font-mono">{errors.requestId}</span></span>}
              </div>
            )}
            <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
          </form>

          <div className="mt-8">
            <p className="text-[13px] font-medium">Demo accounts</p>
            <p className="text-[12.5px] text-ink-3">Password for all: <span className="font-mono text-ink">{DEMO_PASSWORD}</span></p>
            <ul className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button type="button" disabled={busy} data-testid={`demo-${a.role.split(" ")[0].toLowerCase()}`}
                    onClick={(e) => { setEmail(a.email); setPassword(DEMO_PASSWORD); submit(e as unknown as FormEvent, { email: a.email, password: DEMO_PASSWORD }); }}
                    className="w-full flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 text-left hover:border-teal-600 hover:bg-teal-50/40 transition-colors">
                    <a.icon className="size-5 mt-0.5 text-teal-600 shrink-0" aria-hidden />
                    <span>
                      <span className="block text-[14px] font-medium">Continue as {a.role}</span>
                      <span className="block text-[12.5px] text-ink-3">{a.does}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
