export type Role = "pharmacist" | "support_engineer" | "qa_engineer";

export type Me = { id: number; email: string; full_name: string; role: Role; permissions: string[] };
export type UserRef = { id: number; full_name: string; role: Role };

export type PatientStatus = "active" | "inactive";
export type Patient = {
  id: number; patient_code: string; first_name: string; last_name: string; date_of_birth: string | null;
  email: string | null; phone: string | null; address: string | null; allergies: string | null;
  status: PatientStatus; created_at: string; updated_at: string; active_prescriptions: number; contact_masked: boolean;
};
export type PatientRef = { id: number; patient_code: string; first_name: string; last_name: string };

export type Medication = { id: number; name: string; strength: string; form: string; is_controlled: boolean };
export type RxStatus = "active" | "refill_due" | "on_hold" | "completed" | "cancelled";
export type RefillStatus = "pending" | "approved" | "rejected" | "dispensed" | "cancelled";

export type RefillBrief = {
  id: number; status: RefillStatus; requested_at: string; reviewed_at: string | null;
  rejection_reason: string | null; notes: string | null;
};
export type Prescription = {
  id: number; rx_code: string; patient: PatientRef; medication: Medication; prescriber_name: string;
  dosage_instructions: string; quantity: number; refills_authorized: number; refills_remaining: number;
  start_date: string; end_date: string | null; status: RxStatus; created_at: string; updated_at: string;
  refills?: RefillBrief[];
};
export type Refill = {
  id: number; prescription_id: number; rx_code: string; patient: PatientRef; medication: string; status: RefillStatus;
  refills_remaining: number; requested_at: string; requested_by: string | null; reviewed_at: string | null;
  reviewed_by: string | null; rejection_reason: string | null; notes: string | null;
};

export type TicketStatus = "open" | "investigating" | "escalated" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "critical";
export type TicketCategory = "login_access" | "prescription" | "refill" | "patient_data" | "performance" | "integration" | "other";
export type Ticket = {
  id: number; ticket_code: string; subject: string; category: TicketCategory; priority: TicketPriority;
  status: TicketStatus; reporter_name: string; assignee: UserRef | null; created_at: string; updated_at: string;
};
export type TicketNote = { id: number; body: string; is_internal: boolean; author: UserRef; created_at: string };
export type TicketEvent = {
  id: number; event_type: string; from_value: string | null; to_value: string | null; actor: UserRef | null; created_at: string;
};
export type TicketDetail = Ticket & {
  description: string; reporter_email: string | null; browser: string | null; os: string | null;
  app_version: string | null; related_request_id: string | null; diagnostic_notes: string | null;
  patient_id: number | null; prescription_id: number | null; resolution: string | null; resolved_at: string | null;
  closed_at: string | null; creator: UserRef | null; notes: TicketNote[]; events: TicketEvent[];
  linked_bugs: { id: number; bug_code: string; title: string; status: string }[];
};

export type ResultStatus = "not_run" | "passed" | "failed" | "blocked";
export type TestType = "functional" | "regression" | "smoke" | "api" | "security" | "usability";
export type QPriority = "p1" | "p2" | "p3" | "p4";
export type TestCase = {
  id: number; case_code: string; title: string; module: string; type: TestType; priority: QPriority;
  preconditions: string | null; expected_result: string; is_automated: boolean; automation_ref: string | null;
  is_archived: boolean; steps: { step_number: number; action: string; expected: string | null }[];
  created_at: string; updated_at: string; last_status: ResultStatus | null;
};
export type RunStats = {
  total: number; passed: number; failed: number; blocked: number; not_run: number; executed: number;
  pass_rate: number | null; progress: number;
};
export type TestRun = {
  id: number; name: string; run_type: TestType; environment: string; build_version: string | null;
  started_at: string; completed_at: string | null; starter: UserRef | null; stats: RunStats;
};
export type RunResult = {
  id: number; test_case: TestCase; status: ResultStatus; actual_result: string | null; executed_at: string | null;
  duration_ms: number | null; linked_bug_codes: string[];
};
export type TestRunDetail = TestRun & { results: RunResult[] };

export type BugStatus = "new" | "confirmed" | "in_progress" | "fixed" | "verified" | "closed" | "wont_fix";
export type Severity = "critical" | "major" | "minor" | "trivial";
export type Bug = {
  id: number; bug_code: string; title: string; description: string; environment: string; preconditions: string | null;
  steps_to_reproduce: string; expected_behavior: string; actual_behavior: string; severity: Severity; priority: QPriority;
  status: BugStatus; root_cause: string | null; fix_notes: string | null; evidence: Record<string, string>[];
  source_ticket_code: string | null; source_ticket_id: number | null; source_result_id: number | null;
  regression_case_code: string | null; regression_case_id: number | null; demo_bug_key: string | null;
  reporter: UserRef | null; created_at: string; updated_at: string;
};
export type AutomationRun = {
  id: number; framework: "playwright" | "pytest" | "newman"; suite_name: string; commit_sha: string | null;
  branch: string | null; started_at: string; duration_ms: number; total: number; passed: number; failed: number;
  skipped: number; created_at: string;
};
export type AutomationRunDetail = AutomationRun & {
  results: { id: number; test_name: string; file_path: string | null; status: string; duration_ms: number;
    error_message: string | null; case_code: string | null }[];
};

export type LogEntry = {
  id: number; ts: string; level: "INFO" | "WARNING" | "ERROR"; request_id: string | null; method: string | null;
  path: string | null; status_code: number | null; duration_ms: number | null; user_id: number | null;
  user_role: Role | null; message: string; context: Record<string, unknown>; is_demo: boolean;
};
export type AuditEntry = {
  id: number; ts: string; action: string; entity_type: string; entity_id: string | null; request_id: string | null;
  changes: Record<string, unknown>; actor: UserRef | null;
};
