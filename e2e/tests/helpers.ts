import { expect, type Page } from "@playwright/test";

/** Logs in as the seeded mock user (e2e/mocks/tauri-core.ts). */
export async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("alice_vance").fill("alice");
  await page.getByPlaceholder("••••••••••••").fill("password123");
  await page.getByRole("button", { name: "Unlock & Sign In" }).click();
  // Wait for the main chat shell specifically — "Bloop" alone is ambiguous
  // once logged in (it also appears in the center empty-state heading).
  await expect(
    page.getByRole("button", { name: /Hey, are we still on for tomorrow/ }),
  ).toBeVisible();
}

/**
 * The Sidebar renders both a contacts strip and the conversation list, so a
 * contact's bare display name (e.g. "Bob") is ambiguous. Each conversation
 * list item's accessible name also includes its latest-message preview,
 * which is unique — use that to target the right row reliably.
 */
export function conversationRow(page: Page, previewSnippet: string) {
  return page.getByRole("button", { name: new RegExp(previewSnippet) });
}
