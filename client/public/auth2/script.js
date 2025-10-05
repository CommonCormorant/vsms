document.addEventListener('DOMContentLoaded', () => {
    const tokenInput = document.getElementById('token');
    const usernameInput = document.getElementById('username');
    const authBtn = document.getElementById('authBtn');

    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');

    if (tokenFromUrl) {
        tokenInput.value = tokenFromUrl;
        tokenInput.disabled = true;
    }

    authBtn.addEventListener('click', async () => {
        const name = usernameInput.value.trim();
        const token = tokenInput.value.trim();

        if (!name) {
            alert('Please enter the name used in part 1.');
            return;
        }

        if (!token) {
            alert('Authentication token is missing.');
            return;
        }

        authBtn.disabled = true;
        authBtn.textContent = 'Authenticating...';

        try {
            const response = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, token })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Authentication failed');
            }

            const data = await response.json();
            const sessionId = data.session_id;

            if (sessionId) {
                window.location.href = `https://www.gameship.online/info/vsms/RetroTerm/?sID=${sessionId}`;
            } else {
                throw new Error('Session ID not received.');
            }

        } catch (error) {
            console.error('Authentication error:', error);
            alert(`Authentication failed: ${error.message}`);
            authBtn.disabled = false;
            authBtn.textContent = 'Authenticate';
        }
    });
});