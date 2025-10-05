        const usernameInput = document.getElementById('username');
        const requestBtn = document.getElementById('requestBtn');
        const linkSection = document.getElementById('linkSection');
        const tokenDisplay = document.getElementById('tokenDisplay');
        const copyBtn = document.getElementById('copyBtn');

        let generatedLink = '';

        requestBtn.addEventListener('click', async () => {
            const name = usernameInput.value.trim();
            
            if (!name) {
                alert('Please enter a name');
                return;
            }

            requestBtn.disabled = true;
            requestBtn.textContent = 'Requesting...';

            try {
                const response = await fetch('/api/auth/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(errorText || 'Failed to request token');
                }

                const data = await response.json();
                const token = data.token;

                generatedLink = `https://vsms.gameship.online/auth2/?token=${token}`;
                
                tokenDisplay.textContent = generatedLink;
                tokenDisplay.classList.remove('empty');
                linkSection.classList.add('active');
                copyBtn.disabled = false;
                usernameInput.disabled = true; // Lock the input field

            } catch (error) {
                console.error('Error requesting token:', error);
                alert(`An error occurred: ${error.message}`);
            } finally {
                requestBtn.disabled = false;
                requestBtn.textContent = 'Request Token';
            }
        });

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(generatedLink).then(() => {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 2000);
            });
        });
