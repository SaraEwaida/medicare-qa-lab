"""Root conftest: point every test at the test database *before* the app (and its engine) is imported."""

import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://medicare:medicare@localhost:5432/medicare_test")
os.environ.setdefault("DEMO_BUGS_ENABLED", "true")
os.environ.setdefault("CORS_ORIGINS", "")
