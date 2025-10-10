from playwright.sync_api import sync_playwright, expect
import requests
import time

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(no_viewport=True)
    page = context.new_page()

    session_id = None
    try:
        # 1. Manually perform the auth flow to get a valid session ID
        # Step 1a: Request a token
        token_res = requests.post("http://localhost:8080/api/auth/request", json={"name": "TestUser"})
        token_res.raise_for_status()
        token = token_res.json()["token"]

        # Step 1b: Verify the token to create a session
        verify_res = requests.post("http://localhost:8080/api/auth/verify", json={"name": "TestUser", "token": token})
        verify_res.raise_for_status()
        session_id = verify_res.json()["session_id"]

        print(f"Successfully created session: {session_id}")

        # 2. Navigate to the chat page with the valid session ID
        page.goto(f"http://localhost:8080/rt/?sID={session_id}")

        # 3. Wait for the connection and initial registration
        expect(page.get_by_text("You are now known as TestUser.")).to_be_visible(timeout=15000)

        # 4. Change the nickname
        page.get_by_role("textbox").fill("/nick NewNick")
        page.get_by_role("button", name="Send").click()

        # 5. Verify the nickname change messages
        expect(page.get_by_text("* TestUser is now known as NewNick.")).to_be_visible(timeout=10000)

        # 6. Take a screenshot
        page.screenshot(path="jules-scratch/verification/verification.png")
        print("Screenshot taken successfully.")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")

    finally:
        browser.close()

with sync_playwright() as p:
    run_verification(p)