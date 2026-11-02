import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { ErrorState, IdChip, PageHeader, StatusBadge, Table, Td, Th } from "@/components/common";
import { Badge, Card, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { AutomationRunDetail as R } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

export default function AutomationRunDetail() {
  const { id = "" } = useParams();
  const [filter, setFilter] = useState("");
  const run = useQuery({ queryKey: ["automation-run", id], queryFn: () => api<R>(`/qa/automation-runs/${id}`) });
  if (run.isLoading) return <Spinner />;
  if (run.error || !run.data) return <div className="card"><ErrorState error={run.error} onRetry={run.refetch} /></div>;
  const r = run.data;
  const rows = r.results.filter((x) => !filter || x.status === filter);
  return (
    <>
      <PageHeader back={{ to: "/qa?tab=automation", label: "Automation" }} title={r.suite_name}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone="teal">{r.framework}</Badge> executed {fmtDateTime(r.started_at)} in {(r.duration_ms / 1000).toFixed(1)} s{r.commit_sha && <> at commit <IdChip value={r.commit_sha.slice(0, 7)} /></>}</span>} />
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[["Passed", r.passed, "text-ok-700"], ["Failed", r.failed, "text-bad-700"], ["Skipped", r.skipped, "text-ink-2"]].map(([k, v, c]) => (
          <Card key={k as string} className="px-5 py-4"><p className="text-[13px] text-ink-2">{k}</p><p className={`text-[28px] font-semibold tabular-nums ${c}`}>{v}</p></Card>
        ))}
      </div>
      <Card>
        <div className="p-4"><Select aria-label="Filter results" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
          <option value="">All results ({r.total})</option><option value="failed">Failed</option><option value="passed">Passed</option><option value="skipped">Skipped</option>
        </Select></div>
        <Table>
          <thead><tr><Th>Test</Th><Th>Linked case</Th><Th>Result</Th><Th>Duration</Th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <Td><span className="block font-mono text-[12.5px] break-all">{x.test_name}</span>{x.file_path && <span className="block text-[12px] text-ink-3">{x.file_path}</span>}{x.error_message && <pre className="mt-1 whitespace-pre-wrap text-[12px] text-bad-700 max-h-28 overflow-auto">{x.error_message}</pre>}</Td>
                <Td>{x.case_code ? <span className="id-chip">{x.case_code}</span> : <span className="text-ink-3">—</span>}</Td>
                <Td><StatusBadge status={x.status} /></Td>
                <Td className="tabular-nums text-ink-2">{x.duration_ms} ms</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
