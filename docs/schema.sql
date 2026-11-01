-- MediCare QA Lab — PostgreSQL 16 schema draft (Phase 1)
-- Alembic migrations become the source of truth in Phase 3; this file documents and validates the design.
-- All data is synthetic.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- Enums ----------
CREATE TYPE user_role            AS ENUM ('pharmacist', 'support_engineer', 'qa_engineer');
CREATE TYPE patient_status       AS ENUM ('active', 'inactive', 'deceased');
CREATE TYPE prescription_status  AS ENUM ('active', 'refill_due', 'on_hold', 'completed', 'cancelled');
CREATE TYPE refill_status        AS ENUM ('pending', 'approved', 'rejected', 'dispensed', 'cancelled');
CREATE TYPE ticket_category      AS ENUM ('login_access', 'prescription', 'refill', 'patient_data', 'performance', 'integration', 'other');
CREATE TYPE ticket_priority      AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE ticket_status        AS ENUM ('open', 'investigating', 'escalated', 'resolved', 'closed');
CREATE TYPE test_result_status   AS ENUM ('not_run', 'passed', 'failed', 'blocked');
CREATE TYPE test_type            AS ENUM ('functional', 'regression', 'smoke', 'api', 'security', 'usability');
CREATE TYPE bug_severity         AS ENUM ('critical', 'major', 'minor', 'trivial');
CREATE TYPE bug_priority         AS ENUM ('p1', 'p2', 'p3', 'p4');
CREATE TYPE bug_status           AS ENUM ('new', 'confirmed', 'in_progress', 'fixed', 'verified', 'closed', 'wont_fix');
CREATE TYPE automation_framework AS ENUM ('playwright', 'pytest', 'newman');

-- ---------- Business ID sequences ----------
CREATE SEQUENCE patient_code_seq START 1001;
CREATE SEQUENCE rx_code_seq      START 5001;
CREATE SEQUENCE ticket_code_seq  START 1001;
CREATE SEQUENCE test_code_seq    START 1;
CREATE SEQUENCE bug_code_seq     START 1;

-- ---------- Users ----------
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           CITEXT NOT NULL UNIQUE,
    full_name       VARCHAR(120) NOT NULL,
    role            user_role NOT NULL,
    password_hash   TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Patients ----------
CREATE TABLE patients (
    id              BIGSERIAL PRIMARY KEY,
    patient_code    VARCHAR(12) NOT NULL UNIQUE DEFAULT ('P-' || nextval('patient_code_seq')),
    first_name      VARCHAR(60) NOT NULL CHECK (length(trim(first_name)) > 0),
    last_name       VARCHAR(60) NOT NULL CHECK (length(trim(last_name)) > 0),
    date_of_birth   DATE NOT NULL CHECK (date_of_birth > DATE '1900-01-01' AND date_of_birth <= CURRENT_DATE),
    email           CITEXT,
    phone           VARCHAR(20) CHECK (phone ~ '^\+?[0-9 ()-]{7,20}$'),
    address         VARCHAR(200),
    allergies       TEXT,
    status          patient_status NOT NULL DEFAULT 'active',
    is_sandbox      BOOLEAN NOT NULL DEFAULT FALSE,   -- Bug Lab data only
    created_by      BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Duplicate-patient guard: same name + DOB among real patients
CREATE UNIQUE INDEX uq_patient_identity
    ON patients (lower(first_name), lower(last_name), date_of_birth) WHERE NOT is_sandbox;
CREATE INDEX ix_patients_status ON patients (status);
CREATE INDEX ix_patients_name   ON patients (lower(last_name), lower(first_name));

-- ---------- Medication catalog ----------
CREATE TABLE medications (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    strength        VARCHAR(40)  NOT NULL,         -- e.g. '500 mg'
    form            VARCHAR(40)  NOT NULL,         -- tablet, capsule, inhaler...
    is_controlled   BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (name, strength, form)
);

-- ---------- Prescriptions ----------
CREATE TABLE prescriptions (
    id                  BIGSERIAL PRIMARY KEY,
    rx_code             VARCHAR(12) NOT NULL UNIQUE DEFAULT ('RX-' || nextval('rx_code_seq')),
    patient_id          BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    medication_id       BIGINT NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
    prescriber_name     VARCHAR(120) NOT NULL,
    dosage_instructions VARCHAR(255) NOT NULL,     -- e.g. '1 tablet twice daily'
    quantity            INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
    refills_authorized  SMALLINT NOT NULL CHECK (refills_authorized BETWEEN 0 AND 12),
    refills_remaining   SMALLINT NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE,
    status              prescription_status NOT NULL DEFAULT 'active',
    is_sandbox          BOOLEAN NOT NULL DEFAULT FALSE,
    created_by          BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (refills_remaining BETWEEN 0 AND refills_authorized),
    CHECK (end_date IS NULL OR end_date >= start_date)
);
-- Duplicate guard: one active prescription per patient + medication
CREATE UNIQUE INDEX uq_active_rx_per_med
    ON prescriptions (patient_id, medication_id)
    WHERE status IN ('active', 'refill_due', 'on_hold') AND NOT is_sandbox;
CREATE INDEX ix_prescriptions_patient ON prescriptions (patient_id);
CREATE INDEX ix_prescriptions_status  ON prescriptions (status);

-- ---------- Refill requests ----------
CREATE TABLE refill_requests (
    id                BIGSERIAL PRIMARY KEY,
    prescription_id   BIGINT NOT NULL REFERENCES prescriptions(id) ON DELETE RESTRICT,
    status            refill_status NOT NULL DEFAULT 'pending',
    requested_by      BIGINT REFERENCES users(id),
    requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by       BIGINT REFERENCES users(id),
    reviewed_at       TIMESTAMPTZ,
    rejection_reason  VARCHAR(255),
    notes             VARCHAR(500),
    idempotency_key   VARCHAR(64) UNIQUE,          -- protects against double-submit
    is_sandbox        BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    CHECK ((status = 'pending') = (reviewed_at IS NULL))
);
-- Defense in depth: only one pending refill per prescription (real data)
CREATE UNIQUE INDEX uq_one_pending_refill
    ON refill_requests (prescription_id) WHERE status = 'pending' AND NOT is_sandbox;
CREATE INDEX ix_refills_status ON refill_requests (status, requested_at DESC);

-- ---------- Support tickets ----------
CREATE TABLE support_tickets (
    id                  BIGSERIAL PRIMARY KEY,
    ticket_code         VARCHAR(12) NOT NULL UNIQUE DEFAULT ('SUP-' || nextval('ticket_code_seq')),
    subject             VARCHAR(160) NOT NULL CHECK (length(trim(subject)) >= 5),
    description         TEXT NOT NULL,
    category            ticket_category NOT NULL,
    priority            ticket_priority NOT NULL DEFAULT 'medium',
    status              ticket_status NOT NULL DEFAULT 'open',
    reporter_name       VARCHAR(120) NOT NULL,     -- fictional customer (pharmacy staff / clinic)
    reporter_email      CITEXT,
    -- Diagnostic info supplied with the ticket
    browser             VARCHAR(80),
    os                  VARCHAR(80),
    app_version         VARCHAR(20),
    related_request_id  VARCHAR(40),               -- links to app_logs.request_id
    diagnostic_notes    TEXT,                      -- redacted in logs
    patient_id          BIGINT REFERENCES patients(id) ON DELETE SET NULL,
    prescription_id     BIGINT REFERENCES prescriptions(id) ON DELETE SET NULL,
    assignee_id         BIGINT REFERENCES users(id),
    created_by          BIGINT REFERENCES users(id),
    resolution          TEXT,
    resolved_at         TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status NOT IN ('resolved', 'closed') OR resolution IS NOT NULL)
);
CREATE INDEX ix_tickets_status   ON support_tickets (status, priority);
CREATE INDEX ix_tickets_assignee ON support_tickets (assignee_id);

-- Internal investigation notes (visible to support + QA only)
CREATE TABLE ticket_notes (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_id   BIGINT NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL CHECK (length(trim(body)) > 0),
    is_internal BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ticket_notes_ticket ON ticket_notes (ticket_id, created_at);

-- Status/assignment history (support history timeline)
CREATE TABLE ticket_events (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    actor_id    BIGINT REFERENCES users(id),
    event_type  VARCHAR(30) NOT NULL,  -- created, status_changed, assigned, escalated, priority_changed, converted_to_bug
    from_value  VARCHAR(60),
    to_value    VARCHAR(60),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ticket_events_ticket ON ticket_events (ticket_id, created_at);

-- ---------- QA: test cases ----------
CREATE TABLE test_cases (
    id               BIGSERIAL PRIMARY KEY,
    case_code        VARCHAR(12) NOT NULL UNIQUE DEFAULT ('TC-' || lpad(nextval('test_code_seq')::text, 3, '0')),
    title            VARCHAR(200) NOT NULL,
    module           VARCHAR(40) NOT NULL,   -- auth, patients, prescriptions, refills, tickets, qa, api
    type             test_type NOT NULL DEFAULT 'functional',
    priority         bug_priority NOT NULL DEFAULT 'p2',
    preconditions    TEXT,
    expected_result  TEXT NOT NULL,
    is_automated     BOOLEAN NOT NULL DEFAULT FALSE,
    automation_ref   VARCHAR(200),           -- e.g. 'e2e/tests/refills.spec.ts > approves refill'
    is_archived      BOOLEAN NOT NULL DEFAULT FALSE,
    created_by       BIGINT REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE test_case_steps (
    id               BIGSERIAL PRIMARY KEY,
    test_case_id     BIGINT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    step_number      SMALLINT NOT NULL CHECK (step_number > 0),
    action           TEXT NOT NULL,
    expected         TEXT,
    UNIQUE (test_case_id, step_number)
);

-- ---------- QA: test runs ----------
CREATE TABLE test_runs (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(160) NOT NULL,
    run_type      test_type NOT NULL DEFAULT 'functional',  -- 'regression' runs feed regression reports
    environment   VARCHAR(40) NOT NULL DEFAULT 'local',
    build_version VARCHAR(40),
    started_by    BIGINT REFERENCES users(id),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ
);

CREATE TABLE test_run_results (
    id             BIGSERIAL PRIMARY KEY,
    test_run_id    BIGINT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    test_case_id   BIGINT NOT NULL REFERENCES test_cases(id) ON DELETE RESTRICT,
    status         test_result_status NOT NULL DEFAULT 'not_run',
    actual_result  TEXT,
    executed_by    BIGINT REFERENCES users(id),
    executed_at    TIMESTAMPTZ,
    duration_ms    INTEGER CHECK (duration_ms >= 0),
    UNIQUE (test_run_id, test_case_id),
    CHECK (status <> 'failed' OR actual_result IS NOT NULL)
);

-- ---------- QA: bug reports ----------
CREATE TABLE bug_reports (
    id                   BIGSERIAL PRIMARY KEY,
    bug_code             VARCHAR(12) NOT NULL UNIQUE DEFAULT ('BUG-' || lpad(nextval('bug_code_seq')::text, 3, '0')),
    title                VARCHAR(200) NOT NULL,
    description          TEXT NOT NULL,
    environment          VARCHAR(120) NOT NULL,
    preconditions        TEXT,
    steps_to_reproduce   TEXT NOT NULL,
    expected_behavior    TEXT NOT NULL,
    actual_behavior      TEXT NOT NULL,
    severity             bug_severity NOT NULL,
    priority             bug_priority NOT NULL,
    status               bug_status NOT NULL DEFAULT 'new',
    root_cause           TEXT,
    fix_notes            TEXT,
    evidence             JSONB NOT NULL DEFAULT '[]',  -- [{type:'log', request_id:'…'}, {type:'screenshot', path:'…'}]
    source_ticket_id     BIGINT REFERENCES support_tickets(id) ON DELETE SET NULL,   -- ticket → bug conversion
    source_result_id     BIGINT REFERENCES test_run_results(id) ON DELETE SET NULL,  -- failed test → bug
    regression_case_id   BIGINT REFERENCES test_cases(id) ON DELETE SET NULL,        -- verifies the fix
    demo_bug_key         VARCHAR(40),                                                -- links to demo_bug_flags.key
    reported_by          BIGINT REFERENCES users(id),
    assignee_id          BIGINT REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status NOT IN ('verified', 'closed') OR root_cause IS NOT NULL)
);
CREATE INDEX ix_bugs_status ON bug_reports (status, severity);

-- ---------- QA: automated test results (ingested from real reports) ----------
CREATE TABLE automation_runs (
    id            BIGSERIAL PRIMARY KEY,
    framework     automation_framework NOT NULL,
    commit_sha    VARCHAR(40),
    branch        VARCHAR(120),
    started_at    TIMESTAMPTZ NOT NULL,
    duration_ms   INTEGER NOT NULL CHECK (duration_ms >= 0),
    total         INTEGER NOT NULL CHECK (total >= 0),
    passed        INTEGER NOT NULL CHECK (passed >= 0),
    failed        INTEGER NOT NULL CHECK (failed >= 0),
    skipped       INTEGER NOT NULL CHECK (skipped >= 0),
    uploaded_by   BIGINT REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (passed + failed + skipped = total)
);

CREATE TABLE automation_results (
    id                 BIGSERIAL PRIMARY KEY,
    automation_run_id  BIGINT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
    test_name          VARCHAR(300) NOT NULL,
    file_path          VARCHAR(300),
    status             VARCHAR(10) NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
    duration_ms        INTEGER NOT NULL CHECK (duration_ms >= 0),
    error_message      TEXT,
    test_case_id       BIGINT REFERENCES test_cases(id) ON DELETE SET NULL  -- maps automation to manual case for coverage
);

-- ---------- Controlled bug demonstration ----------
CREATE TABLE demo_bug_flags (
    key            VARCHAR(40) PRIMARY KEY,     -- 'refill_status_stale', 'search_filter_case', ...
    title          VARCHAR(160) NOT NULL,
    description    TEXT NOT NULL,
    is_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by     BIGINT REFERENCES users(id),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Observability ----------
CREATE TABLE app_logs (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    level         VARCHAR(8) NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARNING', 'ERROR')),
    request_id    VARCHAR(40),
    method        VARCHAR(8),
    path          VARCHAR(300),
    status_code   SMALLINT,
    duration_ms   INTEGER,
    user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    user_role     user_role,
    message       TEXT NOT NULL,                -- already redacted before insert
    context       JSONB NOT NULL DEFAULT '{}',  -- already redacted before insert
    is_demo       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_app_logs_ts         ON app_logs (ts DESC);
CREATE INDEX ix_app_logs_request_id ON app_logs (request_id);
CREATE INDEX ix_app_logs_status     ON app_logs (status_code, ts DESC);

CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action        VARCHAR(40) NOT NULL,         -- create, update, delete, status_change, login, login_failed, permission_denied
    entity_type   VARCHAR(40) NOT NULL,
    entity_id     VARCHAR(40),
    request_id    VARCHAR(40),
    changes       JSONB NOT NULL DEFAULT '{}'   -- {"field": {"from": "…", "to": "…"}}, PII redacted
);
CREATE INDEX ix_audit_entity ON audit_logs (entity_type, entity_id, ts DESC);

COMMIT;
