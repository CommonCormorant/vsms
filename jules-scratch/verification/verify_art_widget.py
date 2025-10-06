from playwright.sync_api import sync_playwright, Page, expect
import time

def verify_emoji_art(page: Page):
    """
    This script verifies the entire emoji art workflow:
    1. Navigates to the chat application.
    2. Clicks the art button to open the widget.
    3. Draws a simple pattern in the emoji art canvas.
    4. Sends the art to the chat.
    5. Verifies the art is correctly displayed in the chat window.
    """
    # 1. Navigate to the application
    page.goto("http://localhost:8080/rt/")

    # Wait for the welcome message to ensure the app is loaded
    expect(page.get_by_text("Welcome to RetroTerm.")).to_be_visible(timeout=10000)

    # 2. Open the art widget
    art_button = page.locator("#art-button")
    expect(art_button).to_be_visible()
    art_button.click()

    art_widget = page.locator("#art-widget")
    expect(art_widget).to_be_visible()

    # The widget loads an iframe, so we need to target the frame's content
    frame = page.frame_locator("#art-widget iframe")

    # 3. Draw in the widget
    # Input a custom emoji
    custom_emoji_input = frame.locator("#customEmojiInput")
    expect(custom_emoji_input).to_be_visible()
    custom_emoji_input.fill("❤️")

    # Select the brush tool (it's active by default, but good to be explicit)
    brush_tool = frame.locator("[data-tool='brush']")
    brush_tool.click()

    # Click on a few cells to draw a heart
    # Coords are 0-indexed, from top-left
    cells_to_draw = [
        (1, 1), (1, 2),
        (2, 0), (2, 3),
        (3, 1), (3, 2),
        (4, 1)
    ]
    for x, y in cells_to_draw:
        cell = frame.locator(f".canvas-cell[data-x='{x}'][data-y='{y}']")
        cell.click()

    # Give a moment for the drawing to render visually
    time.sleep(0.5)

    # 4. Send the art
    send_button = frame.locator("button.btn:has-text('Send')")
    expect(send_button).to_be_visible()
    send_button.click()

    # 5. Verify the result
    # The widget should now be hidden
    expect(art_widget).to_be_hidden()

    # The art should appear in the chat output
    # We look for the container of the art content
    art_content_container = page.locator(".art-content")
    expect(art_content_container).to_be_visible(timeout=5000)

    # Take a screenshot for visual verification
    page.screenshot(path="jules-scratch/verification/verification.png")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_emoji_art(page)
            print("Verification script ran successfully.")
        except Exception as e:
            print(f"An error occurred: {e}")
            # Save screenshot on failure for debugging
            page.screenshot(path="jules-scratch/verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    main()