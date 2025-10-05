const serverApi = {
    async requestToken(name) {
        const response = await fetch('/api/auth/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!response.ok) {
            throw new Error(`Token request failed: ${response.statusText}`);
        }
        return response.json();
    },

    async verifyToken(name, token) {
        const response = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, token }),
        });
        if (!response.ok) {
            throw new Error(`Token verification failed: ${response.statusText}`);
        }
        return response.json();
    },

    async sendMessage(session_id, message) {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id, message }),
        });
        if (!response.ok) {
            throw new Error(`Send message failed: ${response.statusText}`);
        }
        return response.json();
    }
};

const session = {
    id: null,
    SESSION_STORAGE_KEY: 'retroTermSession'
};

async function initializeSession(userName) {
    // 1. Check for session ID in the URL first
    const urlParams = new URLSearchParams(window.location.search);
    const sID = urlParams.get('sID');
    if (sID) {
        session.id = sID;
        localStorage.setItem(session.SESSION_STORAGE_KEY, JSON.stringify({ id: session.id }));
        console.log('Session loaded from URL (sID):', session.id);
        // Clean the URL
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }

    // 2. Try to load session from localStorage
    const savedSession = localStorage.getItem(session.SESSION_STORAGE_KEY);
    if (savedSession) {
        session.id = JSON.parse(savedSession).id;
        console.log('Session loaded from localStorage:', session.id);
        return;
    }

    // 3. If no session, start auth flow
    console.log(`No session found. Authenticating as ${userName}...`);
    try {
        // Step 1: Request a token
        const authResponse = await serverApi.requestToken(userName);
        const { token } = authResponse;
        if (!token) {
            throw new Error('No token received from server.');
        }
        console.log('Token received.');

        // Step 2: Verify the token to get a session ID
        const verifyResponse = await serverApi.verifyToken(userName, token);
        const { session_id } = verifyResponse;
        if (!session_id) {
            throw new Error('No session_id received from server.');
        }
        console.log('Session ID received:', session_id);

        // 3. Save the new session
        session.id = session_id;
        localStorage.setItem(session.SESSION_STORAGE_KEY, JSON.stringify({ id: session.id }));
        console.log('Session saved to localStorage.');

    } catch (error) {
        console.error('Authentication failed:', error);
        // Handle auth failure, maybe show an error to the user
        addMessageToChat(`Authentication failed: ${error.message}. Please refresh the page to try again.`, 'error-message');
    }
}

function getSessionId() {
    return session.id;
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected.');
        addMessageToChat('Real-time connection established.', 'system-message');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // The server broadcasts a JSON object with a 'message' field.
            // This 'message' field contains the pre-formatted string.
            if (data.message) {
                // We will create a function in script.js to handle displaying the raw message
                displayBroadcastMessage(data.message);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
            // If it's not JSON, just display the raw text.
            displayBroadcastMessage(event.data);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        addMessageToChat('WebSocket connection error. Real-time updates may not work.', 'error-message');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected.');
        addMessageToChat('Real-time connection lost. Please refresh the page to reconnect.', 'error-message');
    };
}