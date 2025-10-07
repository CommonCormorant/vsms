import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Navigate to the local HTML file
        await page.goto("file:///app/client/public/RetroTerm/index.html")

        # Wait for the initial connection message
        await expect(page.locator("p:has-text('Connected!')")).to_be_visible(timeout=10000)

        # 1. Send the first /kill 9 command
        await page.fill("#chat-input", "/kill 9")
        await page.press("#chat-input", "Enter")

        # Give the server a moment to process the first request
        await asyncio.sleep(1)

        # 2. Send the second /kill 9 command
        await page.fill("#chat-input", "/kill 9")
        await page.press("#chat-input", "Enter")

        # 3. Wait for the "Session canceled" message
        await expect(page.locator("p:has-text('***Session Canceled***')")).to_be_visible(timeout=5000)

        # 4. Wait for the countdown message
        await expect(page.locator("p:has-text('***Countdown to client close: 30 Seconds***')")).to_be_visible(timeout=5000)

        # 5. Take a screenshot to verify the UI
        await page.screenshot(path="jules-scratch/verification/verification.png")

        # 6. Wait for the final deletion message
        await expect(page.locator("p:has-text('***SESSION DELETED*** :: Resetting clients.')")).to_be_visible(timeout=35000)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())