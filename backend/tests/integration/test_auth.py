from app.db.seed_data import DEMO_PASSWORD

API = "/api/v1"


def test_tc001_login_success_returns_token_and_user(client):
    r = client.post(f"{API}/auth/login", json={"email": "PHARMACIST@medicare.example.com", "password": DEMO_PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer" and body["expires_in"] == 3600
    assert body["user"]["role"] == "pharmacist"
    assert "password_hash" not in body["user"]


def test_tc002_wrong_password_generic_401(client):
    r1 = client.post(f"{API}/auth/login", json={"email": "pharmacist@medicare.example.com", "password": "nope"})
    r2 = client.post(f"{API}/auth/login", json={"email": "nobody@medicare.example.com", "password": "nope"})
    assert r1.status_code == r2.status_code == 401
    # Same message for unknown email and wrong password: no account enumeration.
    assert r1.json()["error"]["message"] == r2.json()["error"]["message"] == "Invalid email or password."


def test_tc003_login_rate_limited_after_five_attempts(client):
    for _ in range(5):
        assert client.post(f"{API}/auth/login", json={"email": "qa@medicare.example.com", "password": "x"}).status_code == 401
    r = client.post(f"{API}/auth/login", json={"email": "qa@medicare.example.com", "password": DEMO_PASSWORD})
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "RATE_LIMITED"
    assert int(r.headers["Retry-After"]) > 0


def test_successful_logins_do_not_trigger_rate_limit(client):
    """Regression: the limiter used to count successful sign-ins, locking out users who signed in 5x a minute."""
    for _ in range(8):
        r = client.post(f"{API}/auth/login", json={"email": "support@medicare.example.com", "password": DEMO_PASSWORD})
        assert r.status_code == 200


def test_tc004_missing_and_invalid_token_return_401_with_request_id(client):
    for headers in ({}, {"Authorization": "Bearer invalid"}):
        r = client.get(f"{API}/patients", headers=headers)
        assert r.status_code == 401
        err = r.json()["error"]
        assert err["code"] == "UNAUTHORIZED"
        assert err["request_id"] == r.headers["X-Request-ID"]


def test_client_supplied_request_id_is_echoed(client, auth):
    r = client.get(f"{API}/auth/me", headers=auth(**{"X-Request-ID": "req_from_postman_123"}))
    assert r.headers["X-Request-ID"] == "req_from_postman_123"


def test_login_validation_error_for_bad_email(client):
    r = client.post(f"{API}/auth/login", json={"email": "not-an-email", "password": "x"})
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "email"


def test_malformed_json_returns_400(client):
    r = client.post(f"{API}/auth/login", content="{bad json", headers={"Content-Type": "application/json"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "MALFORMED_JSON"


def test_me_returns_permissions(client, auth):
    r = client.get(f"{API}/auth/me", headers=auth("qa"))
    assert r.status_code == 200 and "demo:manage" in r.json()["permissions"]


def test_unknown_api_route_returns_json_404(client):
    r = client.get(f"{API}/does-not-exist")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_health(client):
    assert client.get(f"{API}/health").json()["database"] == "ok"
