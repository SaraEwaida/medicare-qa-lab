"""Role → permission map. The API enforces these; the frontend only uses them to shape navigation."""

from app.models.enums import UserRole

P = UserRole.pharmacist
S = UserRole.support_engineer
Q = UserRole.qa_engineer

PERMISSIONS: dict[str, set[UserRole]] = {
    "dashboard:read": {P, S, Q},
    "patients:read": {P, S, Q},
    "patients:write": {P},
    "prescriptions:read": {P, S, Q},
    "prescriptions:write": {P},
    "refills:read": {P, S, Q},
    "refills:submit": {P},
    "refills:review": {P},
    "tickets:create": {P, S, Q},
    "tickets:read_all": {S, Q},
    "tickets:manage": {S},
    "tickets:notes_read": {S, Q},
    "tickets:convert": {S, Q},
    "qa:read": {S, Q},
    "qa:write": {Q},
    "bugs:create": {S, Q},
    "bugs:write": {Q},
    "logs:read": {S, Q},
    "demo:manage": {Q},
}


def permissions_for(role: UserRole) -> list[str]:
    return sorted(p for p, roles in PERMISSIONS.items() if role in roles)


def has_permission(role: UserRole, permission: str) -> bool:
    return role in PERMISSIONS.get(permission, set())
