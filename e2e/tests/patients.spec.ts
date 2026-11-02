import { expect, test } from "@playwright/test";
import { loginAs, uniqueName } from "./helpers";

test.describe("Patient management", () => {
  test.beforeEach(async ({ page }) => loginAs(page, "pharmacist"));

  test("[TC-007] create a patient with valid data", async ({ page }) => {
    const first = uniqueName("Ava");
    await page.goto("/patients");
    await page.getByRole("button", { name: "New patient" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("First name").fill(first);
    await dialog.getByLabel("Last name").fill("Playwright");
    await dialog.getByLabel("Date of birth").fill("1991-04-12");
    await dialog.getByLabel("Phone").fill("+970 59 123 4567");
    await dialog.getByRole("button", { name: "Create patient" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${first} Playwright`);
    await expect(page.getByText(/P-\d{4}/).first()).toBeVisible();
    await expect(page.getByText("Patient created")).toBeVisible();
  });

  test("[TC-008] form shows inline errors for a future date of birth and bad phone", async ({ page }) => {
    await page.goto("/patients");
    await page.getByRole("button", { name: "New patient" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("First name").fill("Future");
    await dialog.getByLabel("Last name").fill("Case");
    await dialog.getByLabel("Date of birth").fill("2999-01-01");
    await dialog.getByLabel("Phone").fill("abc");
    await dialog.getByRole("button", { name: "Create patient" }).click();
    await expect(dialog.getByText("Date of birth cannot be in the future.")).toBeVisible();
    await expect(dialog.getByText(/Use digits, spaces/)).toBeVisible();
    await expect(dialog.getByLabel("Date of birth")).toHaveAttribute("aria-invalid", "true");
  });

  test("[TC-010] search is case-insensitive", async ({ page }) => {
    await page.goto("/patients");
    const search = page.getByRole("searchbox", { name: "Search patients" });
    await search.fill("JOHN TURNER");
    await expect(page.getByRole("cell", { name: "John Turner" })).toBeVisible();
    await search.fill("john turner");
    await expect(page.getByRole("cell", { name: "John Turner" })).toBeVisible();
    await expect(page).toHaveURL(/q=john/);
  });

  test("[TC-009] duplicate patient shows the existing patient code", async ({ page }) => {
    await page.goto("/patients");
    await page.getByRole("button", { name: "New patient" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("First name").fill("john");
    await dialog.getByLabel("Last name").fill("TURNER");
    await dialog.getByLabel("Date of birth").fill("1985-06-14");
    await dialog.getByRole("button", { name: "Create patient" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Patient already exists as P-1001");
  });
});
