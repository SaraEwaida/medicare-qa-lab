from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models.enums import AutomationFramework, BugSeverity, BugStatus, Priority, TestResultStatus, TestType
from app.schemas.common import ORM, UserRef, text

MODULES = ("auth", "patients", "prescriptions", "refills", "tickets", "qa", "api", "dashboard", "security")


class StepIn(BaseModel):
    action: text(3, 2000)
    expected: text(0, 2000) | None = None


class StepOut(ORM):
    step_number: int
    action: str
    expected: str | None


class TestCaseIn(BaseModel):
    title: text(5, 200)
    module: text(2, 40)
    type: TestType = TestType.functional
    priority: Priority = Priority.p2
    preconditions: text(0, 2000) | None = None
    expected_result: text(3, 2000)
    is_automated: bool = False
    automation_ref: text(0, 200) | None = None
    steps: list[StepIn] = Field(min_length=1, max_length=30)


class TestCaseOut(ORM):
    id: int
    case_code: str
    title: str
    module: str
    type: TestType
    priority: Priority
    preconditions: str | None
    expected_result: str
    is_automated: bool
    automation_ref: str | None
    is_archived: bool
    steps: list[StepOut] = []
    created_at: datetime
    updated_at: datetime
    last_status: TestResultStatus | None = None


class TestRunCreate(BaseModel):
    name: text(3, 160)
    run_type: TestType = TestType.functional
    environment: text(2, 40) = "local"
    build_version: text(0, 40) | None = None
    test_case_ids: list[int] = Field(min_length=1, max_length=200)


class ResultUpdate(BaseModel):
    status: TestResultStatus
    actual_result: text(0, 5000) | None = None
    duration_ms: int | None = Field(default=None, ge=0, le=86_400_000)

    @model_validator(mode="after")
    def failed_needs_actual(self):
        if self.status == TestResultStatus.failed and not self.actual_result:
            raise ValueError("actual_result is required when a test fails.")
        return self


class ResultOut(ORM):
    id: int
    test_case: TestCaseOut
    status: TestResultStatus
    actual_result: str | None
    executed_at: datetime | None
    duration_ms: int | None
    linked_bug_codes: list[str] = []


class RunStats(BaseModel):
    total: int
    passed: int
    failed: int
    blocked: int
    not_run: int
    executed: int
    pass_rate: float | None
    progress: float


class TestRunOut(ORM):
    id: int
    name: str
    run_type: TestType
    environment: str
    build_version: str | None
    started_at: datetime
    completed_at: datetime | None
    starter: UserRef | None
    stats: RunStats


class TestRunDetail(TestRunOut):
    results: list[ResultOut]


class BugIn(BaseModel):
    title: text(5, 200)
    description: text(5, 5000)
    environment: text(2, 120)
    preconditions: text(0, 2000) | None = None
    steps_to_reproduce: text(5, 5000)
    expected_behavior: text(3, 2000)
    actual_behavior: text(3, 2000)
    severity: BugSeverity
    priority: Priority
    source_result_id: int | None = None
    regression_case_id: int | None = None
    evidence: list[dict] = []


class BugUpdate(BaseModel):
    title: text(5, 200) | None = None
    status: BugStatus | None = None
    severity: BugSeverity | None = None
    priority: Priority | None = None
    root_cause: text(0, 5000) | None = None
    fix_notes: text(0, 5000) | None = None
    regression_case_id: int | None = None
    assignee_id: int | None = None


class BugOut(ORM):
    id: int
    bug_code: str
    title: str
    description: str
    environment: str
    preconditions: str | None
    steps_to_reproduce: str
    expected_behavior: str
    actual_behavior: str
    severity: BugSeverity
    priority: Priority
    status: BugStatus
    root_cause: str | None
    fix_notes: str | None
    evidence: list
    source_ticket_code: str | None = None
    source_ticket_id: int | None
    source_result_id: int | None
    regression_case_code: str | None = None
    regression_case_id: int | None
    demo_bug_key: str | None
    reporter: UserRef | None
    created_at: datetime
    updated_at: datetime


class AutomationResultIn(BaseModel):
    test_name: text(1, 300)
    file_path: text(0, 300) | None = None
    status: str = Field(pattern="^(passed|failed|skipped)$")
    duration_ms: int = Field(ge=0)
    error_message: str | None = None
    case_code: str | None = None


class AutomationRunIn(BaseModel):
    framework: AutomationFramework
    suite_name: text(1, 120)
    commit_sha: text(0, 40) | None = None
    branch: text(0, 120) | None = None
    started_at: datetime
    duration_ms: int = Field(ge=0)
    results: list[AutomationResultIn] = Field(min_length=1, max_length=2000)


class AutomationResultOut(ORM):
    id: int
    test_name: str
    file_path: str | None
    status: str
    duration_ms: int
    error_message: str | None
    case_code: str | None = None


class AutomationRunOut(ORM):
    id: int
    framework: AutomationFramework
    suite_name: str
    commit_sha: str | None
    branch: str | None
    started_at: datetime
    duration_ms: int
    total: int
    passed: int
    failed: int
    skipped: int
    created_at: datetime


class AutomationRunDetail(AutomationRunOut):
    results: list[AutomationResultOut]
