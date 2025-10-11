let wsConnection = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000; // 1 second
let preventReconnect = false;
let clientId = null; // To store the stable client ID from the server

const serverApi = {
    getClientId() {
        return clientId;
    },

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
    },

    async whois(session_id, nick) {
        const response = await fetch(`/api/whois?sID=${session_id}&nick=${encodeURIComponent(nick)}`);
        if (!response.ok) {
            throw new Error(`Whois request failed: ${response.statusText}`);
        }
        return response.json();
    },

    async getWhois(nick) {
        const sessionId = getSessionId();
        if (!sessionId) {
            throw new Error("No active session.");
        }
        const response = await fetch(`/api/whois?sID=${sessionId}&nick=${encodeURIComponent(nick)}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Whois request failed: ${response.statusText}`);
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
    preventReconnect = true; // Prevent WebSocket from trying to reconnect
    if (wsConnection) {
        wsConnection.close();
    }
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

function connectWebSocket(getUsername, onMessageCallback, onOpenCallback, onRegistrationComplete) {
    const sessionId = getSessionId();
    if (!sessionId || preventReconnect) {
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws?sID=${sessionId}`;

    wsConnection = new WebSocket(wsUrl);

    let connectionState = 'awaiting_challenge'; // awaiting_challenge, awaiting_verification, awaiting_registration, registered

    wsConnection.onopen = () => {
        console.log('WebSocket connection opened. Awaiting handshake challenge...');
        // Nick is now sent after handshake, not on open.
    };

    wsConnection.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            switch (connectionState) {
                case 'awaiting_challenge':
                    if (data.type === 'HANDSHAKE_CHALLENGE') {
                        console.log('Handshake challenge received.');
                        const token = data.payload;
                        const responseToken = token.substring(Math.floor(token.length / 3), Math.floor(token.length / 3) + 13);

                        const response = { type: 'HANDSHAKE_RESPONSE', payload: responseToken };
                        wsConnection.send(JSON.stringify(response));
                        console.log('Handshake response sent. Awaiting verification...');
                        connectionState = 'awaiting_verification';
                    } else {
                        console.error('Expected HANDSHAKE_CHALLENGE, but got:', data.type);
                        wsConnection.close();
                    }
                    break;

                case 'awaiting_verification':
                    if (data.type === 'HANDSHAKE_VERIFIED') {
                        console.log('Handshake verified. Sending NICK...');
                        const nickMessage = { type: 'NICK', payload: getUsername() };
                        wsConnection.send(JSON.stringify(nickMessage));
                        connectionState = 'awaiting_registration';
                    } else {
                        console.error('Expected HANDSHAKE_VERIFIED, but got:', data.type);
                        wsConnection.close();
                    }
                    break;

                case 'awaiting_registration':
                    if (data.type === 'REGISTERED') {
                        clientId = data.payload.clientId;
                        const finalNickname = data.payload.nickname;

                        console.log(`Registered with ID: ${clientId} and Nickname: ${finalNickname}`);
                        addMessageToChat('Real-time connection established.', 'system-message');
                        reconnectAttempts = 0;
                        connectionState = 'registered';

                        if (typeof onRegistrationComplete === 'function') {
                            onRegistrationComplete(finalNickname);
                        }
                        if (onOpenCallback) {
                            onOpenCallback();
                        }
                    } else {
                        console.error('Expected REGISTERED message, but got:', data.type);
                        wsConnection.close();
                    }
                    break;

                case 'registered':
                    // After registration, pass all messages to the main callback
                    onMessageCallback(data);
                    break;
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
            console.log('Received non-JSON message from WebSocket:', event.data);
            wsConnection.close();
        }
    };

    wsConnection.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    wsConnection.onclose = (event) => {
        if (preventReconnect) {
            console.log('WebSocket closed intentionally.');
            return;
        }

        console.log(`WebSocket disconnected: Code=${event.code}, Reason=${event.reason}`);
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts) + (Math.random() * 1000);
            reconnectAttempts++;
            addMessageToChat(`Connection lost. Attempting to reconnect in ${Math.round(delay / 1000)}s... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'error-message');
            setTimeout(() => connectWebSocket(getUsername, onMessageCallback, onOpenCallback, onRegistrationComplete), delay);
        } else {
            addMessageToChat('Could not reconnect to the server. Please refresh the page.', 'error-message');
        }
    };
}