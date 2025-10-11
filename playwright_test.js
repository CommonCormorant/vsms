const { test, expect } = require('@playwright/test');

test.describe('RetroTerm Frontend', () => {
  test('should load the page and allow typing in the input', async ({ page }) => {
    // Mock the initializeSession function to prevent redirection
    await page.addInitScript(() => {
      window.initializeSession = async () => {
        console.log('Mocked initializeSession called');
        // Simulate a successful session initialization
        window.session = { id: 'mock_session_id' };
        // Prevent the real function from running
        return new Promise(resolve => resolve(false));
      };
      // Mock serverApi to prevent any real API calls
      window.serverApi = {
        checkSession: async () => ({ valid: true }),
        wasSessionDeleted: async () => ({ was_real: false }),
        getHistory: async () => ([]),
      };
      // Mock connectWebSocket to prevent it from actually connecting
      window.connectWebSocket = () => {
          console.log("Mocked connectWebSocket called");
      }
    });

    await page.goto('http://localhost:8080/RetroTerm/');

    // Wait for the main chat window to be visible
    await expect(page.locator('#chat-window')).toBeVisible();

    // Check if the chat input is present and enabled
    const chatInput = page.locator('#chat-input');
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEnabled();

    // Type a message into the input
    await chatInput.type('Hello, this is a test message.');
    await expect(chatInput).toHaveValue('Hello, this is a test message.');

    // Simulate sending the message
    await chatInput.press('Enter');

    // Because we mocked connectWebSocket, the message won't actually be "sent"
    // or displayed in the chat. We are primarily testing that the UI components
    // load and are interactive.

    // Take a screenshot to verify the final state
    await page.screenshot({ path: 'retroterm_verification.png' });
  });
});