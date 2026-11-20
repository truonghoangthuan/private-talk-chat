import { test, expect } from "@playwright/test";
import { login, conversationRow } from "./helpers";

// Regression coverage for PR #17 (fix(chat): persist composer drafts per
// conversation instead of leaking): an unsent draft in one conversation
// must not appear in another conversation's composer, and must still be
// there when switching back.
test.describe("per-conversation composer drafts", () => {
  test("an unsent draft does not leak into a different conversation", async ({
    page,
  }) => {
    await login(page);

    await conversationRow(page, "Hey, are we still on for tomorrow").click();
    const composer = page.getByPlaceholder("Write an encrypted message...");
    await composer.fill("Draft meant only for Bob");

    await conversationRow(page, "Sounds good").click();
    await expect(composer).toHaveValue("");
    await expect(composer).not.toHaveValue("Draft meant only for Bob");

    await conversationRow(page, "Hey, are we still on for tomorrow").click();
    await expect(composer).toHaveValue("Draft meant only for Bob");
  });

  test("sending a message clears that conversation's draft", async ({ page }) => {
    await login(page);

    await conversationRow(page, "Hey, are we still on for tomorrow").click();
    const composer = page.getByPlaceholder("Write an encrypted message...");
    await composer.fill("Final text");
    await page.getByRole("button", { name: "Send encrypted message" }).click();
    await expect(composer).toHaveValue("");

    await conversationRow(page, "Sounds good").click();
    await conversationRow(page, "Hey, are we still on for tomorrow").click();
    await expect(composer).toHaveValue("");
  });
});
