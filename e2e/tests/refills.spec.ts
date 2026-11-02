import { expect, test } from "@playwright/test";
import { loginAs, uniqueName } from "./helpers";

test.describe("Prescriptions and refill workflow", () => {
  test("[TC-014] [TC-017] create prescription, request and approve a refill without reloading", async ({ page }) => {
    await loginAs(page, "pharmacist");
    // Fresh patient so the prescription is never a duplicate.
    const first = uniqueName("Rx");
    await page.goto("/patients");
    await page.getByRole("button", { name: "New patient" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("First name").fill(first);
    await dialog.getByLabel("Last name").fill("Refill");
    await dialog.getByLabel("Date of birth").fill("1975-02-02");
    await dialog.getByRole("button", { name: "Create patient" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(first);

    await page.getByRole("button", { name: "New prescription" }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Medication").selectOption({ label: "Amlodipine 5 mg (tablet)" });
    await dialog.getByLabel("Prescriber").fill("Dr. Playwright Fictional");
    await dialog.getByLabel("Dosage instructions").fill("1 tablet once daily");
    await dialog.getByLabel("Quantity").fill("30");
    await dialog.getByLabel("Refills authorized").fill("3");
    await dialog.getByRole("button", { name: "Create prescription" }).click();
    await expect(page.getByText("Prescription created")).toBeVisible();

    await page.getByRole("link", { name: /RX-\d+/ }).first().click();
    await expect(page.getByTestId("refills-remaining")).toContainText("3");

    await page.getByRole("button", { name: "Request refill" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Refill requested")).toBeVisible();
    await expect(page.getByRole("table").getByText("Pending")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request refill" })).toBeDisabled();

    await page.getByRole("button", { name: "Approve" }).click();
    // Status and counter update in place: no page reload.
    await expect(page.getByRole("table").getByText("Approved")).toBeVisible();
    await expect(page.getByTestId("refills-remaining")).toContainText("2");
  });

  test("[TC-020] rejecting a refill requires a reason", async ({ page }) => {
    await loginAs(page, "pharmacist");
    await page.goto("/prescriptions?tab=refills");
    const firstRow = page.locator("[data-testid^=refill-row-]").first();
    await firstRow.getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Reject refill" }).click();
    await expect(dialog.getByText("Enter a reason")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Prescriber requested hold");
    await dialog.getByRole("button", { name: "Reject refill" }).click();
    await expect(page.getByText("Refill rejected")).toBeVisible();
  });
});
