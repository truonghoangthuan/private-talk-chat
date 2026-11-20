import { test, expect } from "@playwright/test";
import { login, conversationRow } from "./helpers";

test.describe("auth", () => {
  test("shows the login screen on first load", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Bloop" })).toBeVisible();
    await expect(
      page.getByText("Zero-knowledge Windows encrypted chat"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unlock & Sign In" }),
    ).toBeVisible();
  });

  test("rejects a too-short password before calling the backend", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("alice_vance").fill("alice");
    await page.getByPlaceholder("••••••••••••").fill("short");
    await page.getByRole("button", { name: "Unlock & Sign In" }).click();
    await expect(
      page.getByText("Password must be at least 8 characters long."),
    ).toBeVisible();
  });

  test("shows an error for wrong credentials and stays on the login screen", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByPlaceholder("alice_vance").fill("alice");
    await page.getByPlaceholder("••••••••••••").fill("wrongpassword");
    await page.getByRole("button", { name: "Unlock & Sign In" }).click();
    await expect(
      page.getByText("Invalid username or password."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unlock & Sign In" }),
    ).toBeVisible();
  });

  test("logs in with valid credentials and reaches the main chat UI", async ({
    page,
  }) => {
    await login(page);
    await expect(
      conversationRow(page, "Hey, are we still on for tomorrow"),
    ).toBeVisible();
    await expect(conversationRow(page, "Sounds good")).toBeVisible();
  });

  test("registering a new account reaches the main chat UI", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.getByPlaceholder("alice_vance").fill("newuser");
    await page.getByPlaceholder("Alice Vance").fill("New User");
    await page.getByPlaceholder("••••••••••••").fill("password123");
    await page.getByRole("button", { name: "Generate Keys & Register" }).click();
    await expect(
      conversationRow(page, "Hey, are we still on for tomorrow"),
    ).toBeVisible();
  });
});
