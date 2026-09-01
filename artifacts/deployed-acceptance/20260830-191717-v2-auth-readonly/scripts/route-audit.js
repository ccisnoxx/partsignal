async (page) => {
  const baseUrl = "https://geo.962850.xyz";
  const routes = [
    "/",
    "/products",
    "/content/tasks",
    "/publishing/work",
    "/publishing/articles",
    "/publishing/issues",
    "/geo/insights",
    "/geo/topics",
    "/geo/observations",
    "/settings/platforms",
    "/settings/platforms/types",
    "/settings/prompts",
    "/settings/ai",
    "/system/users",
    "/system/audit",
  ];
  const screenshotByRoute = new Map([
    ["/", "artifacts/deployed-acceptance/20260830-191717-v2-auth-readonly/screenshots/02-workbench-1440.png"],
    ["/products", "artifacts/deployed-acceptance/20260830-191717-v2-auth-readonly/screenshots/03-products-1440.png"],
    ["/settings/ai", "artifacts/deployed-acceptance/20260830-191717-v2-auth-readonly/screenshots/04-ai-1440.png"],
    ["/system/audit", "artifacts/deployed-acceptance/20260830-191717-v2-auth-readonly/screenshots/05-audit-1440.png"],
  ]);

  const nonReadRequests = [];
  const failedResponses = [];
  const requestFailures = [];
  const consoleErrors = [];
  const pageErrors = [];
  const pathOf = (url) => url.replace(/^https?:\/\/[^/]+/, "").split("?")[0].split("#")[0];

  page.on("request", (request) => {
    const method = request.method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      nonReadRequests.push({ method, path: pathOf(request.url()) });
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push({
        status: response.status(),
        path: pathOf(response.url()),
      });
    }
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      method: request.method(),
      path: pathOf(request.url()),
      category: request.failure() ? "request-failed" : "unknown",
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push("console-error");
    }
  });
  page.on("pageerror", () => {
    pageErrors.push("page-error");
  });

  const results = [];
  for (const route of routes) {
    await page.goto(`${baseUrl}${route}`);
    await page.waitForLoadState("networkidle");
    const main = page.locator("main");
    await main.waitFor({ state: "visible", timeout: 15000 });

    const result = await page.evaluate(() => {
      const heading = document.querySelector("main h1")?.textContent?.trim() ?? null;
      const activeNav = document.querySelector('nav[aria-label="主导航"] [aria-current="page"]')?.textContent?.trim() ?? null;
      const mainText = document.querySelector("main")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return {
        heading,
        activeNav,
        mainSummary: mainText.slice(0, 180),
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    results.push({
      requestedRoute: route,
      finalPath: pathOf(page.url()),
      ...result,
    });

    const screenshotPath = screenshotByRoute.get(route);
    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, type: "png" });
    }
  }

  return {
    results,
    nonReadRequests,
    failedResponses,
    requestFailures,
    consoleErrors,
    pageErrors,
  };
}
