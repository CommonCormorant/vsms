from playwright.sync_api import sync_playwright, expect

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # 1. Navigate to the chat application
        page.goto("http://localhost:8080/rt/")

        # 2. Wait for the connection and welcome messages
        expect(page.locator("p:text('Welcome to RetroTerm.')")).to_be_visible()
        expect(page.locator("p:text('Connecting to server...')")).to_be_visible()
        # The app should authenticate and connect to the WebSocket
        expect(page.locator("p:text('Connected! You are known as guest.')")).to_be_visible(timeout=10000) # Increased timeout for auth
        expect(page.locator("p:text('Real-time connection established.')")).to_be_visible()

        # 3. Send a regular chat message
        chat_input = page.locator("#chat-input")
        chat_input.fill("Hello, world!")
        chat_input.press("Enter")

        # 4. Send a broadcast command
        chat_input.fill("/roll 20")
        chat_input.press("Enter")

        # 5. Assert that the messages appear in the chat output
        # The messages are broadcast back via WebSocket, so we wait for them to appear.
        # The server formats the message, so we check for the user's name prefix.
        expect(page.locator('p.user-message:has-text("guest: Hello, world!")')).to_be_visible()
        expect(page.locator('p.user-message:has-text("guest: 🎲 Rolled a d20:")')).to_be_visible()

        # 6. Take a screenshot for visual confirmation
        page.screenshot(path="jules-scratch/verification/verification.png")
        print("Screenshot saved to jules-scratch/verification/verification.png")

    except Exception as e:
        print(f"An error occurred during verification: {e}")
        # Save a screenshot on error for debugging
        page.screenshot(path="jules-scratch/verification/error.png")
        print("Error screenshot saved to jules-scratch/verification/error.png")

    finally:
        browser.close()

with sync_playwright() as playwright:
    run_verification(playwright)