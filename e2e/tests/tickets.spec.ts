import { expect, test } from "@playwright/test";
import { loginAs, unique } from "./helpers";

test.describe("Support Center", () => {
  test("[TC-021] [TC-024] create a ticket with diagnostics, investigate, and convert it to a bug", async ({ page }) => {
    const subject = `Refill queue not refreshing ${unique("")}`;
    await loginAs(page, "support");
    await page.goto("/tickets");
    await page.getByRole("button", { name: "New ticket" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Subject").fill(subject);
    await dialog.getByLabel("Category").selectOption("refill");
    await dialog.getByLabel("Priority").selectOption("high");
    await dialog.getByLabel("Description").fill("Approved a refill; the queue still shows it pending until refresh.");
    await dialog.getByLabel("Related request ID").fill("req_e2e0000000000001");
    await dialog.getByLabel("Diagnostic notes").fill("Console clean; network tab shows 200 on approve.");
    await dialog.getByRole("button", { name: "Create ticket" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject);
    await expect(page.getByText(/SUP-\d+/).first()).toBeVisible();
    await expect(page.getByText("req_e2e0000000000001")).toBeVisible();
    await expect(page.getByText("created the ticket")).toBeVisible();

    await page.getByRole("button", { name: "Start investigating" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Investigating").first()).toBeVisible();

    await page.getByLabel("Add a note").fill("Reproduced in staging with the customer's request ID.");
    await page.getByRole("button", { name: "Add internal note" }).click();
    await expect(page.getByText("Reproduced in staging")).toBeVisible();

    await page.getByRole("button", { name: "Convert to bug" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create bug" }).click();
    await expect(page).toHaveURL(/\/qa\/bugs\/\d+/);
    await expect(page.getByText(/BUG-\d+/).first()).toBeVisible();
    await expect(page.getByText("req_e2e0000000000001")).toBeVisible();
  });

  test("[TC-022] escalation requires a note", async ({ page }) => {
    await loginAs(page, "support");
    await page.goto("/tickets?status=open");
    await page.locator("tbody tr").first().click();
    await page.getByRole("button", { name: "Escalate" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog.getByText("Explain why this needs escalation.")).toBeVisible();
  });
});
