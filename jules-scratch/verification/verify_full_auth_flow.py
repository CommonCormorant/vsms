from playwright.sync_api import sync_playwright, Page, expect
import re

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    try:
        # --- Step 1: Auth Page ---
        print("Navigating to auth page...")
        page.goto("http://localhost:8080/auth/", wait_until="networkidle")

        # Fill in username and request token
        username = "jules-the-agent"
        page.get_by_placeholder("Enter your name").fill(username)
        page.get_by_role("button", name="Request Token").click()

        # Verify the link is displayed and get the URL
        token_display = page.locator("#tokenDisplay")
        expect(token_display).to_have_text(re.compile(r"https://vsms.gameship.online/auth2/\?token=\w+"))
        auth2_url = token_display.inner_text()
        print(f"Generated auth2 URL: {auth2_url}")

        # --- Step 2: Auth2 Page ---
        print("Navigating to auth2 page...")
        page.goto(auth2_url, wait_until="networkidle")

        # Verify token is pre-filled
        token_input = page.locator("#token")
        expect(token_input).to_have_value(re.compile(r"\w+"))
        expect(token_input).to_be_disabled()
        print("Token is pre-filled and disabled.")

        # Fill in username and authenticate
        page.get_by_placeholder("Enter your name").fill(username)
        page.get_by_role("button", name="Authenticate").click()
        print("Authenticating...")

        # --- Step 3: Final Redirect ---
        print("Waiting for redirect...")
        # Wait for the URL to change to the final destination
        expect(page).to_have_url(re.compile(r"https://www.gameship.online/info/RetroTerm/\?sID=\w+"))
        print(f"Redirected to: {page.url}")

        # Take a screenshot of the final page
        page.screenshot(path="jules-scratch/verification/verification_final.png")
        print("Screenshot of final page saved to jules-scratch/verification/verification_final.png")

    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)