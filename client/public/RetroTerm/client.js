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
    },

    async checkSession(session_id) {
        const response = await fetch(`/api/session/check?sID=${session_id}`);
        if (!response.ok) {
            throw new Error(`Session check failed: ${response.statusText}`);
        }
        return response.json();
    }
};

const session = {
    id: null,
    SESSION_STORAGE_KEY: 'retroTermSession'
};

async function initializeSession(userName) {
    let isNewJoiner = false;
    const urlParams = new URLSearchParams(window.location.search);
    let sID = urlParams.get('sID');

    if (sID) {
        isNewJoiner = true;
    } else {
        const savedSession = localStorage.getItem(session.SESSION_STORAGE_KEY);
        if (savedSession) {
            sID = JSON.parse(savedSession).id;
        }
    }

    if (!sID) {
        console.log('No session ID found. Redirecting to auth.');
        window.location.href = 'https://vsms.gameship.online/auth/';
        throw new Error('Redirecting to auth...');
    }

    try {
        const { valid } = await serverApi.checkSession(sID);
        if (!valid) {
            localStorage.removeItem(session.SESSION_STORAGE_KEY);
            deleteCookie('sID');
            throw new Error('Invalid session');
        }

        session.id = sID;
        localStorage.setItem(session.SESSION_STORAGE_KEY, JSON.stringify({ id: session.id }));

        if (isNewJoiner) {
            console.log('Session loaded from URL (sID) and verified:', session.id);
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            console.log('Session loaded from localStorage and verified:', session.id);
        }

        return isNewJoiner;

    } catch (error) {
        throw error;
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