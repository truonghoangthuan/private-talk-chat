import { test, expect } from "@playwright/test";
import { login, conversationRow } from "./helpers";

test.describe("messaging", () => {
  test("selecting a conversation loads its message history", async ({ page }) => {
    await login(page);
    await conversationRow(page, "Hey, are we still on for tomorrow").click();
    await expect(page.getByText("Hey Alice!")).toBeVisible();
    await expect(
      page.getByText("Hey, are we still on for tomorrow?").first(),
    ).toBeVisible();
  });

  test("sending a message appends it to the timeline immediately", async ({
    page,
  }) => {
    await login(page);
    await conversationRow(page, "Hey, are we still on for tomorrow").click();

    const composer = page.getByPlaceholder("Write an encrypted message...");
    await composer.fill("See you at 6pm!");
    await page.getByRole("button", { name: "Send encrypted message" }).click();

    await expect(page.getByText("See you at 6pm!")).toBeVisible();
    // Composer clears after a successful send.
    await expect(composer).toHaveValue("");
  });

  test("switching conversations loads the other conversation's history", async ({
    page,
  }) => {
    await login(page);
    await conversationRow(page, "Hey, are we still on for tomorrow").click();
    await expect(page.getByText("Hey Alice!")).toBeVisible();

    await conversationRow(page, "Sounds good").click();
    await expect(page.getByText("Sounds good!").first()).toBeVisible();
    await expect(page.getByText("Hey Alice!")).not.toBeVisible();
  });
});
