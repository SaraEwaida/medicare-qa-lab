import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { KV, PageHeader } from "@/components/common";
import { Badge, Button, Card, CardHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL, humanize } from "@/lib/utils";

const DENSITY_KEY = "mcqa.density";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string; database: string; version: string; environment: string; demo_bugs_enabled: boolean }>("/health") });
  const [density, setDensity] = useState(() => { try { return localStorage.getItem(DENSITY_KEY) ?? "comfortable"; } catch { return "comfortable"; } });
  const applyDensity = (v: string) => {
    setDensity(v);
    try { localStorage.setItem(DENSITY_KEY, v); } catch { /* storage unavailable */ }
    document.documentElement.style.fontSize = v === "compact" ? "15px" : "";
  };
  if (!user) return null;
  return (
    <>
      <PageHeader title="Settings" description="Your account, display preferences and environment details." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" description="Demo accounts are shared, so profile details can't be edited." />
          <div className="px-5 pb-5">
            <KV items={[["Name", user.full_name], ["Email", user.email], ["Role", ROLE_LABEL[user.role]], ["Session", "Expires 60 minutes after sign-in; closing the tab signs you out."]]} />
            <Button variant="secondary" className="mt-5" onClick={() => logout()}>Sign out</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Permissions" description="Enforced by the API. The interface only hides what you can't use." />
          <ul className="px-5 pb-5 flex flex-wrap gap-1.5">
            {user.permissions.map((p) => <li key={p}><Badge tone="teal">{p}</Badge></li>)}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Display" />
          <div className="px-5 pb-5 grid gap-2 max-w-xs">
            <label htmlFor="density" className="text-[13px] font-medium">Density</label>
            <Select id="density" value={density} onChange={(e) => applyDensity(e.target.value)}>
              <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
            </Select>
            <p className="text-[12.5px] text-ink-3">Saved in this browser only.</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Environment" />
          <div className="px-5 pb-5">
            {health.data ? (
              <KV items={[
                ["Version", health.data.version], ["Environment", humanize(health.data.environment)],
                ["API", <Badge tone={health.data.status === "ok" ? "ok" : "bad"} dot>{humanize(health.data.status)}</Badge>],
                ["Database", <Badge tone={health.data.database === "ok" ? "ok" : "bad"} dot>{health.data.database === "ok" ? "Connected" : "Unreachable"}</Badge>],
                ["Bug Lab", health.data.demo_bugs_enabled ? "Available (sandbox only)" : "Disabled"],
                ["API docs", <a className="link" href="/api/docs" target="_blank" rel="noreferrer">Swagger UI</a>],
              ]} />
            ) : <p className="text-ink-3 text-[13px]">Checking…</p>}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Privacy and data" />
          <div className="px-5 pb-5 text-[13.5px] text-ink-2 space-y-2 max-w-[80ch]">
            <p>All patients, prescriptions and tickets are fictional and generated for demonstration. This application is not HIPAA-compliant and has not been independently audited. Do not enter real personal or health information.</p>
            <p>Request logs and audit entries are redacted before they're stored: names, emails, phone numbers, addresses, search terms and diagnostic notes are masked. Non-pharmacist roles see masked contact details.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
