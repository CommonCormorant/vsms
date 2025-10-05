document.addEventListener('DOMContentLoaded', () => {
    const tokenDisplay = document.getElementById('token');
    const usernameInput = document.getElementById('username');
    const authBtn = document.getElementById('authBtn');

    // 1. Parse token from URL and display it
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
        tokenDisplay.textContent = token;
    } else {
        tokenDisplay.textContent = 'No token provided.';
        tokenDisplay.classList.add('empty');
    }

    // 2. Handle authentication button click
    authBtn.addEventListener('click', async () => {
        const name = usernameInput.value.trim();

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

        // TODO: Replace with actual API call to verify token + name
        // For now, we'll simulate a successful authentication and redirect.
        // const response = await fetch('/api/authenticate', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ token, name })
        // });
        // const data = await response.json();
        // if (data.success) {
        //     window.location.href = data.redirectUrl; // e.g., redirect to RetroTerm with a session ID
        // } else {
        //     alert('Authentication failed. Please check the name and token.');
        //     authBtn.disabled = false;
        //     authBtn.textContent = 'Authenticate';
        // }

        // Simulate a short delay for the "API call"
        setTimeout(() => {
            console.log(`Simulating authentication for name: "${name}" with token: "${token}"`);
            // Redirect to the RetroTerm page
            window.location.href = 'https://www.gameship.online/info/RetroTerm';
        }, 500);
    });
});