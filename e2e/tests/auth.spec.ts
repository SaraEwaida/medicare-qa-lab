import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, loginAs } from "./helpers";

test.describe("Authentication", () => {
  test("[TC-001] pharmacist signs in with valid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("pharmacist@medicare.example.com");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Maya");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Patients" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Prescriptions" })).toBeVisible();
  });

  test("[TC-002] wrong password shows a generic error and stays on login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("pharmacist@medicare.example.com");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Invalid email or password.");
    await expect(alert).toContainText("Request ID");
    await expect(page).toHaveURL(/\/login/);
  });

  test("client-side validation blocks an empty form", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
  });

  test("signing out returns to the login page and protects routes", async ({ page }) => {
    await loginAs(page, "support");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/login/);
  });
});
