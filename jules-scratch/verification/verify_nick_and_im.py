from playwright.sync_api import sync_playwright, expect

import re
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Define the mock script to be injected
    mock_script = "<script>window.initializeSession = () => Promise.resolve(true);</script>"

    def handle_route(route):
        response = route.fetch()
        body = response.body().decode()
        # Inject the mock script at the end of the <head> section
        body = body.replace("</head>", f"{mock_script}</head>")
        route.fulfill(response=response, body=body)

    # Intercept the request for the main page and inject the script
    page.route("http://localhost:8080/rt/", handle_route)

    # Go to the page. The mock will be active from the start.
    page.goto("http://localhost:8080/rt/")

    # Wait for the welcome message to ensure the page is loaded
    expect(page.locator("text=Welcome to RetroTerm.")).to_be_visible()

    # Change nickname
    page.fill("#chat-input", "/nick Jules")
    page.press("#chat-input", "Enter")

    # Verify nickname change message
    expect(page.locator("text=You are now known as Jules.")).to_be_visible()

    # Send an IM to an offline user
    page.fill("#chat-input", "/im offline_user, this message should fail")
    page.press("#chat-input", "Enter")

    # Wait for the error message to be appended
    expect(page.locator("text=IM->offline_user this message should fail [Can't send: offline_user is not available.]")).to_be_visible()

    # Take a screenshot
    page.screenshot(path="jules-scratch/verification/nick_and_im_verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)