from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # The server is running on port 8080
    page.goto("http://localhost:8080/rt/")

    # Wait for the welcome message to ensure the page is loaded
    expect(page.locator("text=Welcome to RetroTerm.")).to_be_visible()

    # Change nickname to something other than guest
    page.fill("#chat-input", "/nick Jules")
    page.press("#chat-input", "Enter")

    # Send an IM to an offline user
    page.fill("#chat-input", "/im offline_user, this message should fail")
    page.press("#chat-input", "Enter")

    # Wait for the error message to be appended
    expect(page.locator("text=IM->offline_user this message should fail [Can't send: offline_user is not available.]")).to_be_visible()

    # Take a screenshot
    page.screenshot(path="jules-scratch/verification/im_error_verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)