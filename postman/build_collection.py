"""Generates MediCare-QA-Lab.postman_collection.json and local.postman_environment.json.

Run: python3 postman/build_collection.py
"""
import json, os, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
def t(*lines): return [{"listen": "test", "script": {"type": "text/javascript", "exec": list(lines)}}]
def pre(*lines): return [{"listen": "prerequest", "script": {"type": "text/javascript", "exec": list(lines)}}]
def req(name, method, path, body=None, token="{{pharmacist_token}}", tests=(), prereq=(), headers=()):
    h = [{"key": "Content-Type", "value": "application/json"}] if body is not None else []
    h += [{"key": k, "value": v} for k, v in headers]
    if token: h.append({"key": "Authorization", "value": f"Bearer {token}"})
    raw = "{{baseUrl}}/api/v1" + path
    path_part, _, query = path.partition("?")
    url = {"raw": raw, "host": ["{{baseUrl}}"], "path": ["api", "v1"] + [p for p in path_part.split("/") if p]}
    if query: url["query"] = [{"key": kv.split("=")[0], "value": kv.split("=",1)[1] if "=" in kv else ""} for kv in query.split("&")]
    item = {"name": name, "request": {"method": method, "header": h, "url": url}, "event": t(*tests) + (pre(*prereq) if prereq else [])}
    if body is not None: item["request"]["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2)}
    return item

COMMON = ['pm.test("has X-Request-ID header", () => pm.response.to.have.header("X-Request-ID"));',
          'pm.test("responds in under 1500 ms", () => pm.expect(pm.response.responseTime).to.be.below(1500));']
ERR = ['pm.test("error envelope with request_id", () => { const e = pm.response.json().error; pm.expect(e).to.have.keys("code","message","details","request_id"); pm.expect(e.request_id).to.eql(pm.response.headers.get("X-Request-ID")); });']

def login(role, var):
    return req(f"Login as {role}", "POST", "/auth/login", {"email": f"{role}@medicare.example.com", "password": "{{demo_password}}"}, token=None, tests=[
        'pm.test("200 OK", () => pm.response.to.have.status(200));',
        'const b = pm.response.json();',
        'pm.test("returns bearer token", () => { pm.expect(b.token_type).to.eql("bearer"); pm.expect(b.access_token).to.be.a("string"); });',
        f'pm.test("role is {role}", () => pm.expect(b.user.email).to.include("{role}@"));',
        f'pm.collectionVariables.set("{var}", b.access_token);', *COMMON])

folders = [
 {"name": "1. Auth & system", "item": [
   req("Health check", "GET", "/health", token=None, tests=['pm.test("200 and database ok", () => { pm.response.to.have.status(200); pm.expect(pm.response.json().database).to.eql("ok"); });', *COMMON]),
   login("pharmacist", "pharmacist_token"), login("support", "support_token"), login("qa", "qa_token"),
   req("Login with wrong password → 401 [TC-002]", "POST", "/auth/login", {"email": "pharmacist@medicare.example.com", "password": "wrong"}, token=None,
       tests=['pm.test("401", () => pm.response.to.have.status(401));', 'pm.test("generic message", () => pm.expect(pm.response.json().error.message).to.eql("Invalid email or password."));', *ERR]),
   req("Me (permissions)", "GET", "/auth/me", tests=['pm.test("200", () => pm.response.to.have.status(200));', 'pm.test("pharmacist can review refills", () => pm.expect(pm.response.json().permissions).to.include("refills:review"));', *COMMON]),
   req("No token → 401 [TC-004]", "GET", "/patients", token=None, tests=['pm.test("401", () => pm.response.to.have.status(401));', *ERR]),
 ]},
 {"name": "2. Patients", "item": [
   req("Search patients", "GET", "/patients?q=turner&page_size=5", tests=['pm.test("200", () => pm.response.to.have.status(200));', 'const b = pm.response.json();', 'pm.test("paginated envelope", () => pm.expect(b).to.have.keys("items","total","page","page_size"));', 'pm.test("every result matches", () => b.items.forEach(p => pm.expect((p.first_name+" "+p.last_name).toLowerCase()).to.include("turner")));', *COMMON]),
   req("Create patient", "POST", "/patients", {"first_name": "Postman", "last_name": "{{unique_last}}", "date_of_birth": "1988-08-08", "phone": "+970 59 222 3333", "email": "postman.patient@example.com"},
       prereq=['pm.collectionVariables.set("unique_last", "Test" + Array.from({length:8},()=>"abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random()*26)]).join(""));'],
       tests=['pm.test("201 Created", () => pm.response.to.have.status(201));', 'const b = pm.response.json();', 'pm.test("patient code format", () => pm.expect(b.patient_code).to.match(/^P-\\d+$/));', 'pm.collectionVariables.set("patient_id", b.id);', 'pm.collectionVariables.set("patient_updated_at", b.updated_at);', *COMMON]),
   req("Validation errors → 422 [TC-026]", "POST", "/patients", {"first_name": "", "last_name": "X", "date_of_birth": "2999-01-01", "email": "not-an-email"},
       tests=['pm.test("422", () => pm.response.to.have.status(422));', 'const fields = pm.response.json().error.details.map(d => d.field);', 'pm.test("lists invalid fields", () => { pm.expect(fields).to.include("first_name"); pm.expect(fields).to.include("email"); pm.expect(fields).to.include("date_of_birth"); });', *ERR]),
   req("Duplicate patient → 409 [TC-009]", "POST", "/patients", {"first_name": "john", "last_name": "TURNER", "date_of_birth": "1985-06-14"},
       tests=['pm.test("409", () => pm.response.to.have.status(409));', 'pm.test("code PATIENT_DUPLICATE", () => pm.expect(pm.response.json().error.code).to.eql("PATIENT_DUPLICATE"));', *ERR]),
   req("Update patient phone", "PATCH", "/patients/{{patient_id}}", {"phone": "+970 59 444 5555", "updated_at": "{{patient_updated_at}}"},
       tests=['pm.test("200", () => pm.response.to.have.status(200));', 'pm.test("phone saved", () => pm.expect(pm.response.json().phone).to.eql("+970 59 444 5555"));', *COMMON]),
   req("Stale update → 409 [TC-012]", "PATCH", "/patients/{{patient_id}}", {"phone": "+970 59 000 0000", "updated_at": "{{patient_updated_at}}"},
       tests=['pm.test("409 STALE_WRITE", () => { pm.response.to.have.status(409); pm.expect(pm.response.json().error.code).to.eql("STALE_WRITE"); });', *ERR]),
   req("Support sees masked contact [TC-013]", "GET", "/patients/{{patient_id}}", token="{{support_token}}",
       tests=['pm.test("200", () => pm.response.to.have.status(200));', 'const b = pm.response.json();', 'pm.test("contact masked", () => { pm.expect(b.contact_masked).to.be.true; pm.expect(b.phone).to.eql("***-***-5555"); pm.expect(b.date_of_birth).to.be.null; });', *COMMON]),
   req("Unknown patient → 404", "GET", "/patients/999999", tests=['pm.test("404", () => pm.response.to.have.status(404));', *ERR]),
 ]},
 {"name": "3. Prescriptions & refills", "item": [
   req("Create prescription", "POST", "/prescriptions", {"patient_id": "{{patient_id}}", "medication_id": 8, "prescriber_name": "Dr. Postman Fictional", "dosage_instructions": "1 tablet once daily", "quantity": 30, "refills_authorized": 2, "start_date": "2026-11-01"},
       tests=['pm.test("201", () => pm.response.to.have.status(201));', 'const b = pm.response.json();', 'pm.test("remaining = authorized", () => pm.expect(b.refills_remaining).to.eql(b.refills_authorized));', 'pm.collectionVariables.set("rx_id", b.id);', *COMMON]),
   req("Quantity 1001 → 422 [TC-015]", "POST", "/prescriptions", {"patient_id": "{{patient_id}}", "medication_id": 9, "prescriber_name": "Dr. X", "dosage_instructions": "daily", "quantity": 1001, "refills_authorized": 1, "start_date": "2026-11-01"},
       tests=['pm.test("422 on quantity", () => { pm.response.to.have.status(422); pm.expect(pm.response.json().error.details[0].field).to.eql("quantity"); });', *ERR]),
   req("Submit refill", "POST", "/refill-requests", {"prescription_id": "{{rx_id}}", "notes": "Postman"}, headers=[("Idempotency-Key", "{{$guid}}")],
       tests=['pm.test("201", () => pm.response.to.have.status(201));', 'const b = pm.response.json();', 'pm.test("pending", () => pm.expect(b.status).to.eql("pending"));', 'pm.collectionVariables.set("refill_id", b.id);', *COMMON]),
   req("Duplicate pending refill → 409 [TC-018]", "POST", "/refill-requests", {"prescription_id": "{{rx_id}}"},
       tests=['pm.test("409 REFILL_DUPLICATE", () => { pm.response.to.have.status(409); pm.expect(pm.response.json().error.code).to.eql("REFILL_DUPLICATE"); });', *ERR]),
   req("Support approves → 403 [TC-005]", "POST", "/refill-requests/{{refill_id}}/approve", token="{{support_token}}",
       tests=['pm.test("403 FORBIDDEN", () => pm.response.to.have.status(403));', *ERR]),
   req("Pharmacist approves", "POST", "/refill-requests/{{refill_id}}/approve",
       tests=['pm.test("200", () => pm.response.to.have.status(200));', 'const b = pm.response.json();', 'pm.test("approved and decremented", () => { pm.expect(b.status).to.eql("approved"); pm.expect(b.refills_remaining).to.eql(1); });', *COMMON]),
   req("Approve again → 409", "POST", "/refill-requests/{{refill_id}}/approve",
       tests=['pm.test("409 INVALID_TRANSITION", () => { pm.response.to.have.status(409); pm.expect(pm.response.json().error.code).to.eql("INVALID_TRANSITION"); });', *ERR]),
   req("Pending refill queue", "GET", "/refill-requests?status=pending&page_size=5",
       tests=['pm.test("200", () => pm.response.to.have.status(200));', 'pm.test("all pending", () => pm.response.json().items.forEach(r => pm.expect(r.status).to.eql("pending")));', *COMMON]),
 ]},
 {"name": "4. Support tickets", "item": [
   req("Create ticket", "POST", "/tickets", {"subject": "Postman: refill queue not refreshing", "description": "Created by the Postman collection run.", "category": "refill", "priority": "high", "reporter_name": "Postman", "related_request_id": "req_postman00000001"}, token="{{support_token}}",
       tests=['pm.test("201", () => pm.response.to.have.status(201));', 'const b = pm.response.json();', 'pm.test("open", () => pm.expect(b.status).to.eql("open"));', 'pm.collectionVariables.set("ticket_id", b.id);', *COMMON]),
   req("Invalid transition open → resolved [TC-022]", "POST", "/tickets/{{ticket_id}}/status", {"status": "resolved"}, token="{{support_token}}",
       tests=['pm.test("409", () => pm.response.to.have.status(409));', *ERR]),
   req("Start investigating", "POST", "/tickets/{{ticket_id}}/status", {"status": "investigating"}, token="{{support_token}}",
       tests=['pm.test("200 investigating", () => { pm.response.to.have.status(200); pm.expect(pm.response.json().status).to.eql("investigating"); });', *COMMON]),
   req("Convert to bug", "POST", "/tickets/{{ticket_id}}/convert-to-bug", {"severity": "major", "priority": "p2"}, token="{{support_token}}",
       tests=['pm.test("201", () => pm.response.to.have.status(201));', 'pm.test("linked to ticket", () => pm.expect(pm.response.json().source_ticket_id).to.eql(pm.collectionVariables.get("ticket_id")));', *COMMON]),
 ]},
 {"name": "5. QA & diagnostics", "item": [
   req("QA metrics", "GET", "/qa/metrics", token="{{qa_token}}", tests=['pm.test("200", () => pm.response.to.have.status(200));', 'pm.test("has coverage", () => pm.expect(pm.response.json()).to.have.property("coverage"));', *COMMON]),
   req("Pharmacist reads logs → 403", "GET", "/logs", tests=['pm.test("403", () => pm.response.to.have.status(403));', *ERR]),
   req("Recent 4xx logs", "GET", "/logs?status_class=4xx&page_size=10", token="{{qa_token}}",
       tests=['pm.test("200", () => pm.response.to.have.status(200));', 'pm.test("all 4xx", () => pm.response.json().items.forEach(l => pm.expect(l.status_code).to.be.within(400, 499)));', 'pm.test("search terms redacted", () => pm.response.json().items.forEach(l => { if (l.context.query && l.context.query.q) pm.expect(l.context.query.q).to.eql("[REDACTED]"); }));', *COMMON]),
   req("Database consistency checks [TC-030]", "GET", "/diagnostics/db-checks", token="{{qa_token}}",
       tests=['pm.test("200", () => pm.response.to.have.status(200));', 'pm.response.json().forEach(c => pm.test("DB check passes: " + c.key, () => pm.expect(c.passed, JSON.stringify(c.violations)).to.be.true));', *COMMON]),
 ]},
]
collection = {
  "info": {"_postman_id": str(uuid.UUID(int=20261102)), "name": "MediCare QA Lab API",
           "description": "End-to-end API checks for MediCare QA Lab (synthetic data). Run in order: requests chain IDs through collection variables.\n\nnpx newman run postman/MediCare-QA-Lab.postman_collection.json -e postman/local.postman_environment.json",
           "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
  "item": folders,
  "variable": [{"key": k, "value": ""} for k in ["pharmacist_token", "support_token", "qa_token", "patient_id", "patient_updated_at", "rx_id", "refill_id", "ticket_id", "unique_last"]],
}
json.dump(collection, open(os.path.join(HERE, "MediCare-QA-Lab.postman_collection.json"), "w"), indent=2)
for name, url in [("local", "http://localhost:8000")]:
    json.dump({"id": str(uuid.UUID(int=1)), "name": f"MediCare QA Lab ({name})", "values": [
        {"key": "baseUrl", "value": url, "enabled": True}, {"key": "demo_password", "value": "Demo@2026!", "enabled": True}]},
        open(os.path.join(HERE, f"{name}.postman_environment.json"), "w"), indent=2)
print(sum(len(f["item"]) for f in folders), "requests")
