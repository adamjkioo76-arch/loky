import { expect, test } from "@playwright/test";

test("auth screen explains required Supabase setup", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "مرحباً بعودتك" })).toBeVisible();
  await expect(page.getByText("أضف بيانات مشروع Supabase في")).toBeVisible();
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
