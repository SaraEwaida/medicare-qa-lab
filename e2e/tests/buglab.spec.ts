import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

async function setDefect(page: Page, key: string, on: boolean) {
  const sw = page.getByTestId(`toggle-${key}`);
  if ((await sw.getAttribute("aria-checked")) !== String(on)) {
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", String(on));
  }
}

test.describe("Bug Lab: reproduce, fix, regression-test", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "qa");
    await page.goto("/bug-lab");
    await page.getByRole("button", { name: "Reset sandbox" }).click();
    await expect(page.getByText("Sandbox data reset")).toBeVisible();
  });

  test("search_case_sensitive reproduces, and [TC-010] passes once fixed", async ({ page }) => {
    const search = async (q: string) => {
      await page.getByLabel("Search sandbox patients").fill(q);
      await page.getByRole("button", { name: "Search", exact: true }).click();
    };
    await setDefect(page, "search_case_sensitive", true);
    await search("nora");
    await expect(page.getByTestId("sandbox-search-result")).toContainText("No patients found");

    await setDefect(page, "search_case_sensitive", false); // fix applied
    await search("nora");
    await expect(page.getByTestId("sandbox-search-result")).toContainText("Nora Haddad");
  });

  test("refill_status_stale shows stale UI; [TC-017] regression passes with defect off", async ({ page }) => {
    const row = page.getByTestId("sandbox-Lisinopril");
    await setDefect(page, "refill_status_stale", true);
    await row.getByRole("button", { name: "Request refill" }).click();
    await expect(row.getByTestId("latest-status")).toContainText("Pending");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("last-status")).toContainText("HTTP 200");
    await expect(row.getByTestId("latest-status")).toContainText("Pending"); // defect: stale response
    await page.getByRole("button", { name: "Reload from server" }).click();
    await expect(row.getByTestId("latest-status")).toContainText("Approved"); // database was right all along

    await setDefect(page, "refill_status_stale", false);
    await row.getByRole("button", { name: "Request refill" }).click();
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row.getByTestId("latest-status")).toContainText("Approved");
  });

  test.afterEach(async ({ page }) => {
    for (const key of ["refill_status_stale", "search_case_sensitive"]) await setDefect(page, key, false);
  });
});
