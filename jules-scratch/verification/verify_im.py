import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        # Launch browser
        browser = await p.chromium.launch()

        # Create two separate browser contexts
        user1_context = await browser.new_context()
        user2_context = await browser.new_context()

        # Create pages for each user
        user1_page = await user1_context.new_page()
        user2_page = await user2_context.new_page()

        try:
            # User 1 navigates to the chat
            await user1_page.goto("http://localhost:8080/rt/?sID=test-session")
            # Set user 1's name
            await user1_page.fill("#chat-input", "/name User1")
            await user1_page.press("#chat-input", "Enter")

            # User 2 navigates to the chat
            await user2_page.goto("http://localhost:8080/rt/?sID=test-session")
            # Set user 2's name
            await user2_page.fill("#chat-input", "/name User2")
            await user2_page.press("#chat-input", "Enter")

            # User 1 sends an IM to User 2
            await user1_page.fill("#chat-input", "/im User2, Hello User2!")
            await user1_page.press("#chat-input", "Enter")

            # Check if the message appears in User 2's chat
            await expect(user2_page.locator("p.private-message")).to_contain_text("[IM from User1]: Hello User2!")

            # Take a screenshot of User 2's view
            await user2_page.screenshot(path="jules-scratch/verification/im_verification.png")

        finally:
            await browser.close()

asyncio.run(main())