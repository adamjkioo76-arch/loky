import { expect, test } from "@playwright/test";

test("auth screen shows the sign-in form", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "مرحباً بعودتك" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل الدخول" })).toBeVisible();
  await expect(page.getByLabel("البريد الإلكتروني")).toBeVisible();
  await expect(page.getByLabel("كلمة المرور", { exact: true })).toBeVisible();
});

test("user can navigate between sign in, sign up, and password recovery", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "أنشئ حساباً جديداً" }).click();
  await expect(page.getByRole("heading", { name: "ابدأ رحلتك المالية" })).toBeVisible();
  await expect(page.getByLabel("الاسم الكامل")).toBeVisible();
  await page.getByRole("button", { name: "سجّل الدخول" }).click();
  await page.getByRole("button", { name: "نسيت كلمة المرور؟" }).click();
  await expect(page.getByRole("heading", { name: "نسيت كلمة المرور؟" })).toBeVisible();
});

test("auth screen fits common mobile, tablet, and desktop widths", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  for (const width of [320, 375, 760, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => {
      const panel = document.querySelector(".form-panel").getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        panelLeft: panel.left,
        panelRight: panel.right,
      };
    });

    expect(dimensions.document, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.panelLeft, `panel starts outside viewport at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(dimensions.panelRight, `panel ends outside viewport at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
  }
});
