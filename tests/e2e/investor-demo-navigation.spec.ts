import { expect, test, type Page } from "playwright/test";

const DEMO_NAV_STEPS = [
  { label: "Demo", expectedPath: "/demo" },
  { label: "Verticali", expectedPath: "/verticali" },
  { label: "Concessioni", expectedPath: "/concessioni" },
  { label: "Procedimenti", expectedPath: "/procedimenti" },
  { label: "Documenti", expectedPath: "/documenti" },
  { label: "Scadenze", expectedPath: "/scadenze" },
  { label: "Normativa", expectedPath: "/normativa" },
  { label: "Orchestrazione", expectedPath: "/normativa/orchestrazione" },
];

function bindDiagnostics(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: Array<{ url: string; status: number }> = [];
  const nonAuthApiCalls: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
  });

  page.on("response", (response) => {
    if (response.status() >= 500) {
      failedResponses.push({ url: response.url(), status: response.status() });
    }

    const url = response.url();
    if (url.includes("/api/") && !url.includes("/api/auth/")) {
      nonAuthApiCalls.push(`${response.status()} ${url}`);
    }
  });

  return { consoleErrors, pageErrors, failedResponses, nonAuthApiCalls };
}

async function clickPrimaryNav(page: Page, label: string) {
  await page
    .getByLabel("Navigazione principale")
    .getByRole("link", { name: label, exact: true })
    .click();
}

test.describe("investor demo navigation desktop", () => {
  test.skip(process.env.INVESTOR_DEMO_MODE !== "true", "Run this suite only with INVESTOR_DEMO_MODE=true");

  test("navigates all investor routes from dashboard without runtime errors", async ({ page }) => {
    const diag = bindDiagnostics(page);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();

    for (const step of DEMO_NAV_STEPS) {
      await clickPrimaryNav(page, step.label);
      await expect(page).toHaveURL(new RegExp(`${step.expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
      await expect(page.getByTestId("investor-demo-banner")).toBeVisible();
    }

    await clickPrimaryNav(page, "Dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);

    expect(diag.consoleErrors).toEqual([]);
    expect(diag.pageErrors).toEqual([]);
    expect(diag.failedResponses).toEqual([]);
    expect(diag.nonAuthApiCalls).toEqual([]);
  });
});

test.describe("investor demo navigation mobile", () => {
  test.skip(process.env.INVESTOR_DEMO_MODE !== "true", "Run this suite only with INVESTOR_DEMO_MODE=true");

  test.use({ viewport: { width: 390, height: 844 } });

  test("supports mobile navigation without blocking overlays", async ({ page }) => {
    const diag = bindDiagnostics(page);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();

    const possibleMenuButton = page.getByRole("button", { name: /menu|navigazione/i });
    if ((await possibleMenuButton.count()) > 0 && (await possibleMenuButton.first().isVisible())) {
      await possibleMenuButton.first().click();
    }

    await clickPrimaryNav(page, "Demo");
    await expect(page).toHaveURL(/\/demo$/);

    await clickPrimaryNav(page, "Verticali");
    await expect(page).toHaveURL(/\/verticali$/);

    await clickPrimaryNav(page, "Normativa");
    await expect(page).toHaveURL(/\/normativa$/);

    await clickPrimaryNav(page, "Dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();

    expect(diag.consoleErrors).toEqual([]);
    expect(diag.pageErrors).toEqual([]);
    expect(diag.failedResponses).toEqual([]);
    expect(diag.nonAuthApiCalls).toEqual([]);
  });
});
