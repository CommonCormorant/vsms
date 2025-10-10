let wsConnection = null;

const serverApi = {
    sendWsMessage(message) {
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            wsConnection.send(message);
        } else {
            console.error('WebSocket is not connected.');
            addMessageToChat('Cannot send message: not connected to real-time server.', 'error-message');
        }
    },

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
    },

    async wasSessionDeleted(session_id) {
        const response = await fetch(`/api/session/was_deleted?sID=${session_id}`);
        if (!response.ok) {
            throw new Error(`Deleted session check failed: ${response.statusText}`);
        }
        return response.json();
    },

    async checkMail(session_id, nick) {
        const response = await fetch(`/api/mail/check?sID=${session_id}&nick=${encodeURIComponent(nick)}`);
        if (!response.ok) {
            throw new Error(`Mail check failed: ${response.statusText}`);
        }
        return response.json();
    },

    async checkMailOut(session_id, nick) {
        const response = await fetch(`/api/mail/out?sID=${session_id}&nick=${encodeURIComponent(nick)}`);
        if (!response.ok) {
            throw new Error(`Mail out check failed: ${response.statusText}`);
        }
        return response.json();
    }
};

const session = {
    id: null,
    SESSION_STORAGE_KEY: 'retroTermSession'
};

function deleteCookie(name) {
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
}

function clearSessionData() {
    console.log('Clearing all session data (cookie and localStorage).');
    localStorage.removeItem(session.SESSION_STORAGE_KEY);
    deleteCookie('sID');
    session.id = null;
}

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
            const { was_real } = await serverApi.wasSessionDeleted(sID);
            clearSessionData();
            if (was_real) {
                throw new Error('This session has been deleted.');
            } else {
                throw new Error('Invalid session.');
            }
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
        // To ensure we don't get stuck in a loop, if any part of the validation fails,
        // we re-throw the error to be caught by the top-level initializeApp function.
        throw error;
    }
}

function getSessionId() {
    return session.id;
}

function connectWebSocket(userName, onMessageCallback) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Cannot connect to real-time server without a session.', 'error-message');
        return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws?sID=${sessionId}`;

    const ws = new WebSocket(wsUrl);
    wsConnection = ws; // Store the connection object

    ws.onopen = () => {
        console.log('WebSocket connected.');
        addMessageToChat('Real-time connection established.', 'system-message');
        // Announce our nickname to the server
        ws.send(`NICK|${userName}`);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onMessageCallback(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
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