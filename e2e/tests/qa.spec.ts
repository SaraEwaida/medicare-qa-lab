import { expect, test } from "@playwright/test";
import { loginAs, unique } from "./helpers";

test.describe("QA Lab", () => {
  test("[TC-025] record pass, fail and blocked results; pass rate recalculates", async ({ page }) => {
    await loginAs(page, "qa");
    await page.goto("/qa?tab=runs");
    await page.getByRole("button", { name: "New run" }).click();
    const dialog = page.getByRole("dialog");
    const name = `E2E fixture run (automated test data) ${unique("")}`;
    await dialog.getByLabel("Run name").fill(name);
    for (const code of ["TC-001", "TC-002", "TC-003"]) {
      await dialog.locator("label", { hasText: code }).getByRole("checkbox").check();
    }
    await dialog.getByRole("button", { name: "Create run" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByTestId("run-pass-rate")).toHaveText("—");

    const row = (code: string) => page.getByTestId(`result-${code}`);
    await row("TC-001").getByRole("button", { name: "Pass" }).click();
    await expect(row("TC-001").getByRole("button", { name: "Pass" })).toHaveAttribute("data-on", "true");

    // Fail without an actual result is blocked by validation.
    await row("TC-002").getByRole("button", { name: "Fail" }).click();
    await expect(row("TC-002").getByText("Describe what actually happened")).toBeVisible();
    await row("TC-002").getByLabel("Actual result").fill("Error banner shown instead of dashboard.");
    await row("TC-002").getByRole("button", { name: "Save as Failed" }).click();

    await row("TC-003").getByRole("button", { name: "Blocked" }).click();
    await row("TC-003").getByLabel("Actual result").fill("Rate limiter shared with another tester.");
    await row("TC-003").getByRole("button", { name: "Save as Blocked" }).click();

    await expect(page.getByTestId("run-pass-rate")).toHaveText("33.3%");
    await expect(page.getByText("3 of 3 executed (100%)")).toBeVisible();
  });
});
