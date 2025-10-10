import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()

        try:
            await page.goto("http://localhost:8080/rt/?sID=test-session")
            await page.fill("#chat-input", "/name User1")
            await page.press("#chat-input", "Enter")

            # Try to send an IM to a user who is not online
            await page.fill("#chat-input", "/im OfflineUser, ¿Hola?")
            await page.press("#chat-input", "Enter")

            # Check for the specific failure message
            fail_message_locator = page.locator("p.private-message-fail")
            await expect(fail_message_locator).to_contain_text("> [IM to OfflineUser]: ¿Hola? [Fail: OfflineUser isn't here]")

            await page.screenshot(path="jules-scratch/verification/im_fail_verification.png")

        finally:
            await browser.close()

asyncio.run(main())