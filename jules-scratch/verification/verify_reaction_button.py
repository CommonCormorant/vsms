from playwright.sync_api import sync_playwright, expect
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Get the absolute path to the HTML file
        html_file_path = os.path.abspath('client/public/RetroTerm/index.html')

        # Go to the local HTML file
        page.goto(f'file://{html_file_path}')

        # Find the reaction button and click it
        reaction_button = page.locator("#reaction-button")
        expect(reaction_button).to_be_visible()
        reaction_button.click()

        # Wait for the widget to be visible
        reaction_widget = page.locator("#reaction-widget")
        expect(reaction_widget).not_to_have_class("hidden")
        expect(reaction_widget).to_be_visible()

        # Take a screenshot
        page.screenshot(path="jules-scratch/verification/reaction-widget-visible.png")

        browser.close()

if __name__ == "__main__":
    run()