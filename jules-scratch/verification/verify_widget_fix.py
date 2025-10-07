from playwright.sync_api import Page, expect, sync_playwright
import os

def verify_widget_fix(page: Page):
    """
    This script verifies that the celebration emoji has been removed and the
    reaction widget has been nudged to the left.
    """
    # This init script runs before any page scripts. It redefines the serverApi
    # methods to prevent actual network requests and simulate a valid session.
    mock_script = """
    window.serverApi = {
        checkSession: () => Promise.resolve({ valid: true }),
        wasSessionDeleted: () => Promise.resolve({ was_real: false }),
        sendMessage: () => Promise.resolve({}),
        getHistory: () => Promise.resolve([]),
        getArchive: () => Promise.resolve([]),
    };
    window.connectWebSocket = () => {};
    """
    page.add_init_script(mock_script)

    # Get the absolute path to the HTML file
    file_path = os.path.abspath('client/public/RetroTerm/index.html')
    # Provide a dummy session ID in the URL to satisfy the initial check
    url_to_goto = f'file://{file_path}?sID=test-session'

    # Go to the local HTML file
    page.goto(url_to_goto)

    # Find and click the reaction button
    reaction_button = page.locator('#reaction-button')
    expect(reaction_button).to_be_visible(timeout=10000)
    reaction_button.click()

    # Find the reaction widget
    reaction_widget = page.locator('#reaction-widget')
    expect(reaction_widget).to_be_visible()

    # Assert that the celebration emoji is no longer present
    celebration_button = reaction_widget.locator('button', has_text='🎉')
    expect(celebration_button).not_to_be_visible()

    # Take a screenshot of the whole app container for visual verification of the position
    app_container = page.locator('#app-container')
    app_container.screenshot(path='jules-scratch/verification/verification.png')

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_widget_fix(page)
        finally:
            browser.close()

if __name__ == '__main__':
    main()