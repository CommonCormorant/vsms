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

            // TODO: Replace with actual API call
            // const response = await fetch('/api/request-token', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ name })
            // });
            // const data = await response.json();
            // const token = data.token;

            // Simulated token generation for now
            setTimeout(() => {
                const token = generateMockToken();
                generatedLink = `https://vsms.gameship.online/?token=${token}`;
                
                tokenDisplay.textContent = generatedLink;
                tokenDisplay.classList.remove('empty');
                linkSection.classList.add('active');
                copyBtn.disabled = false;
                
                requestBtn.disabled = false;
                requestBtn.textContent = 'Request Token';
            }, 500);
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

        function generateMockToken() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let token = '';
            for (let i = 0; i < 64; i++) {
                token += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return token;
        }
