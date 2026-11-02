import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe("Role-based navigation", () => {
  test("[TC-006] each role sees only its permitted modules", async ({ page }) => {
    await loginAs(page, "pharmacist");
    let nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Prescriptions" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "API & Logs" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Bug Lab" })).toHaveCount(0);

    // Direct URL to a hidden module shows the restricted state instead of data.
    await page.goto("/api-explorer");
    await expect(page.getByText("Access restricted")).toBeVisible();

    await page.context().clearCookies();
    await page.evaluate(() => sessionStorage.clear());
    await loginAs(page, "qa");
    nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["QA Lab", "Bug Lab", "API & Logs"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  });

  test("[TC-013] support engineer sees masked patient contact details", async ({ page }) => {
    await loginAs(page, "support");
    await page.goto("/patients/1");
    await expect(page.getByText("Contact details masked for your role")).toBeVisible();
    await expect(page.getByText(/\*\*\*-\*\*\*-\d{4}/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });
});
