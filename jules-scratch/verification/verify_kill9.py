import asyncio
from playwright.sync_api import sync_playwright, expect

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Get the absolute path to the index.html file
    import os
    file_path = os.path.abspath('client/public/RetroTerm/index.html')
    page.goto(f'file://{file_path}')

    # Wait for the app to initialize
    expect(page.locator('text=Welcome to RetroTerm')).to_be_visible()

    # 1. Simulate KILL9_WARN broadcast
    warn_data = {
        "timestamp": "2025-10-06T18:55:00Z",
        "message": "KILL9_WARN|TestUser|First /kill 9 request received. A second command within 12 minutes will terminate the session."
    }
    page.evaluate("data => displayBroadcastMessage(data)", warn_data)
    page.screenshot(path="jules-scratch/verification/01_kill9_warn.png")

    # 2. Simulate KILL9_CANCEL broadcast to trigger the countdown
    cancel_data = {
        "timestamp": "2025-10-06T18:56:00Z",
        "message": "KILL9_CANCEL|vsms|% **Session canceled**"
    }
    page.evaluate("data => displayBroadcastMessage(data)", cancel_data)
    page.screenshot(path="jules-scratch/verification/02_kill9_cancel_and_countdown_start.png")

    # 3. Wait for the countdown to progress
    page.wait_for_timeout(5100) # Wait for the next countdown message
    page.screenshot(path="jules-scratch/verification/03_kill9_countdown_progress.png")

    # 4. Simulate the final DELETED message (the countdown handles the rest)
    deleted_data = {
        "timestamp": "2025-10-06T18:56:01Z",
        "message": "KILL9_DELETED|vsms|% ***SESSION DELETED*** :: Resetting clients."
    }
    page.evaluate("data => displayBroadcastMessage(data)", deleted_data)
    page.screenshot(path="jules-scratch/verification/04_kill9_deleted.png")

    print("Verification script executed successfully.")
    browser.close()

with sync_playwright() as p:
    run_verification(p)