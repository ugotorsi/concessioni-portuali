import { expect, test } from "playwright/test";

test("security headers su /login", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.ok()).toBe(true);

  const headers = response.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBeTruthy();
});
