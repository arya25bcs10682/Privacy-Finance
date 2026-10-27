import { test, expect } from "@playwright/test";
import path from "path";

test.describe.configure({ mode: "serial" });

test.describe("Zero-Knowledge Vault & Authentication E2E Suite", () => {
  const timestamp = Date.now();
  const testEmail = `investor-${timestamp}@privacy.test`;
  const testPassword = "Password123!Secure";
  const masterSecretKey = "MasterSecretKey-2026-ZeroKnowledge!";

  test("1. User Signup: generates keys, displays recovery code, and opens vault", async ({
    page,
  }) => {
    await page.goto("/");

    // Open signup modal from top header
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByText("Create Encrypted Account")).toBeVisible();

    // Fill registration credentials
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[placeholder*="Min 8 characters"]', testPassword);
    await page.fill(
      'input[placeholder="Unique phrase (never transmitted to server)"]',
      masterSecretKey
    );

    // Proceed to Step 2: Recovery code generation (PBKDF2 600,000 iterations)
    await page.getByRole("button", { name: "Next: Generate Recovery Code" }).click();
    await expect(page.getByText("Save Your Recovery Code")).toBeVisible({ timeout: 15000 });

    // Confirm saving recovery code
    await page.locator('input[type="checkbox"]').check();

    // Complete registration
    await page
      .getByRole("button", { name: "Complete Registration & Open Vault" })
      .click();

    // Verify vault is unlocked and user session is active
    await expect(page.getByRole("button", { name: /Lock Vault/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(testEmail)).toBeVisible();
  });

  test("2. Login on a 'Second Device' with master secret key", async ({ browser }) => {
    // Simulate a completely clean second browser device (no cookies, empty storage)
    const secondDeviceContext = await browser.newContext();
    const page = await secondDeviceContext.newPage();

    await page.goto("/");

    // Open login modal
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.getByText("Log In to Account")).toBeVisible();

    // Step 1: Enter email and password
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.getByRole("button", { name: "Continue to Vault Decryption" }).click();

    // Step 2: Prompted for master secret key
    await expect(page.getByText("Enter Secret Key")).toBeVisible({ timeout: 15000 });
    await page.fill(
      'input[placeholder="Your client-side secret key"]',
      masterSecretKey
    );

    // Click Unlock Vault (PBKDF2 unwrap)
    await page.getByRole("button", { name: "Unlock Vault" }).click();

    // Verify vault unlocked on second device
    await expect(page.getByRole("button", { name: /Lock Vault/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(testEmail)).toBeVisible();

    await secondDeviceContext.close();
  });

  test("3. Wrong-Key Failure: rejects incorrect secret key and keeps vault locked", async ({
    browser,
  }) => {
    // Simulate another device or session
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/");
    await page.getByRole("button", { name: "Log In" }).click();

    // Step 1: Valid credentials
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.getByRole("button", { name: "Continue to Vault Decryption" }).click();

    // Step 2: Enter WRONG secret key
    await expect(page.getByText("Enter Secret Key")).toBeVisible({ timeout: 15000 });
    await page.fill(
      'input[placeholder="Your client-side secret key"]',
      "CompletelyWrongKey999!"
    );

    // Attempt to unlock
    await page.getByRole("button", { name: "Unlock Vault" }).click();

    // Expect decryption failure error message
    const errorAlert = page.getByText(/Incorrect Secret Key|Decryption failed|Invalid key/i);
    await expect(errorAlert).toBeVisible({ timeout: 15000 });

    // Verify vault remains strictly locked (Secret key prompt remains visible)
    await expect(page.getByText("Enter Secret Key")).toBeVisible();

    await context.close();
  });

  test("4. Statement upload with deduplication and client-side encryption", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Log in and unlock vault
    await page.goto("/");
    await page.getByRole("button", { name: "Log In" }).click();
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.getByRole("button", { name: "Continue to Vault Decryption" }).click();
    await expect(page.getByText("Enter Secret Key")).toBeVisible({ timeout: 15000 });
    await page.fill(
      'input[placeholder="Your client-side secret key"]',
      masterSecretKey
    );
    await page.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(page.getByRole("button", { name: /Lock Vault/i })).toBeVisible({ timeout: 15000 });

    // Mock /api/parse to return realistic parsed statement rows deterministically
    await page.route("**/api/parse", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          transactions: [
            {
              date: "2026-03-01",
              narration: "SALARY TECH CORP CREDIT",
              type: "credit",
              amount: 75000,
              balance: 100000,
            },
            {
              date: "2026-03-05",
              narration: "AMAZON SHOPPING BANGALORE",
              type: "debit",
              amount: 1500,
              balance: 98500,
            },
          ],
          count: 2,
          pageNumber: 1,
        }),
      });
    });

    // Navigate to /upload via SPA link so in-memory master encryption key is preserved
    await page.getByRole("complementary").getByRole("link", { name: "Upload Statement" }).click();
    await expect(page.getByText("1. Select Bank Layout")).toBeVisible({ timeout: 10000 });

    // Attach sample statement PDF
    const pdfPath = path.resolve("e2e/fixtures/sample-statement.pdf");
    await page.setInputFiles('input[type="file"]', pdfPath);

    // Click Parse Statement
    await page.getByRole("button", { name: /Parse Statement/i }).click();

    // Wait for validation and deduplication preview
    await expect(page.getByText("Deduplication & Hash Status:")).toBeVisible({ timeout: 15000 });

    // Initial check: 2 new, 0 duplicates
    await expect(page.getByText("2 New", { exact: true })).toBeVisible();
    await expect(page.getByText("0 Duplicates", { exact: true })).toBeVisible();

    // Click "Encrypt & Upload 2 New"
    await page.getByRole("button", { name: /Encrypt & Upload 2 New/i }).click();

    // Verify upload success notice
    await expect(
      page.getByText(/Successfully encrypted and inserted 2 new transactions/i)
    ).toBeVisible({ timeout: 15000 });

    // Test Deduplication: Click "Upload Another" and re-upload the same statement
    await page.getByRole("button", { name: /Upload Another/i }).click();
    await page.setInputFiles('input[type="file"]', pdfPath);
    await page.getByRole("button", { name: /Parse Statement/i }).click();

    // Second check: Dedupe engine identifies previously uploaded rows
    await expect(page.getByText("Deduplication & Hash Status:")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("0 New", { exact: true })).toBeVisible();
    await expect(page.getByText("2 Duplicates", { exact: true })).toBeVisible();

    // Upload button should be disabled for 0 new
    const uploadBtn = page.getByRole("button", { name: /Encrypt & Upload 0 New/i });
    await expect(uploadBtn).toBeDisabled();

    await context.close();
  });
});
