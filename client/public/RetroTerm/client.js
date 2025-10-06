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
    },

    async getHistory(session_id, minutes = 15) {
        const response = await fetch(`/api/history?sID=${session_id}&minutes=${minutes}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`History request failed: ${response.statusText}`);
        }
        return response.json();
    },

    async getArchive(session_id) {
        const response = await fetch(`/api/archive?sID=${session_id}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`Archive request failed: ${response.statusText}`);
        }
        return response.json();
    }
};

const session = {
    id: null,
    SESSION_STORAGE_KEY: 'retroTermSession'
};

async function initializeSession(userName) {
    // This function will return `true` if the user is joining via a shared link,
    // so the app knows to fetch the history automatically.
    let isNewJoiner = false;

    // 1. Check for session ID in the URL first
    const urlParams = new URLSearchParams(window.location.search);
    const sID = urlParams.get('sID');
    if (sID) {
        session.id = sID;
        localStorage.setItem(session.SESSION_STORAGE_KEY, JSON.stringify({ id: session.id }));
        console.log('Session loaded from URL (sID):', session.id);
        // Clean the URL
        window.history.replaceState({}, document.title, window.location.pathname);
        isNewJoiner = true; // This user joined via a link
        return isNewJoiner;
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

function connectWebSocket(onMessageCallback) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Cannot connect to real-time server without a session.', 'error-message');
        return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws?sID=${sessionId}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected.');
        addMessageToChat('Real-time connection established.', 'system-message');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // The server broadcasts a JSON object. We pass the whole object to the callback.
            onMessageCallback(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
            // If the data is not valid JSON, we cannot process it as a structured message.
            console.log('Received non-JSON message from WebSocket:', event.data);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        addMessageToChat('WebSocket connection error. Real-time updates may not work.', 'error-message');
    };

    ws.onclose = (event) => {
        console.log(`WebSocket disconnected: Code=${event.code}, Reason=${event.reason}`);
        let errorMessage = 'Real-time connection lost.';
        if (event.code) {
            errorMessage += ` (Code: ${event.code}`;
            if (event.reason) {
                errorMessage += `, Reason: ${event.reason}`;
            }
            errorMessage += ')';
        }
        errorMessage += ' Please refresh the page to reconnect.';
        addMessageToChat(errorMessage, 'error-message');
    };
}