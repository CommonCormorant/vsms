document.body.addEventListener('dblclick', function(event) {
    event.preventDefault();
});

const APP_STORAGE_KEY = 'retroTermAppSettings';
window.APP_STORAGE_KEY = APP_STORAGE_KEY;

const RANDOM_NAMES = [
    'Betty', 'Frank', 'Alice', 'Bob', 'Charlie', 'Diana',
    'Edward', 'Fiona', 'George', 'Helen', 'Ivan', 'Julia',
    'Kevin', 'Laura', 'Mike', 'Nancy', 'Oscar', 'Penny',
    'Quinn', 'Rachel', 'Steve', 'Tina', 'Victor', 'Wendy'
];

const chatOutput = document.getElementById('chat-output');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const body = document.body;

let state = {
    userName: 'guest',
    ipAddress: '',
    theme: 'light',
    startTime: Date.now()
};

function saveSettings() {
    const settings = {
        userName: state.userName,
        theme: state.theme
    };
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem(APP_STORAGE_KEY);
    if (saved) {
        const settings = JSON.parse(saved);
        state.userName = settings.userName || 'guest';
        state.theme = settings.theme || 'light';
        body.dataset.theme = state.theme;
    }
}

function generateFakeIP() {
    return [0, 0, 0, 0].map(() => Math.floor(Math.random() * 256)).join('.');
}

function getCurrentTimestamp() {
    const now = new Date();
    const date = now.toLocaleDateString();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return { date, time };
}

function scrollToBottom() {
    chatOutput.scrollTop = chatOutput.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function parseMarkdown(text) {
    let html = escapeHtml(text);
    
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // Horizontal rule (three underscores)
    html = html.replace(/^___$/gm, '<br/><hr/><br/>');
    
    // Blockquotes (including nested)
    const lines = html.split('\n');
    let inBlockquote = false;
    let blockquoteLevel = 0;
    let processedLines = [];
    
    for (let line of lines) {
        const quoteMatch = line.match(/^(>+)\s?(.*)$/);
        if (quoteMatch) {
            const level = quoteMatch[1].length;
            const content = quoteMatch[2];
            
            if (!inBlockquote || level !== blockquoteLevel) {
                if (inBlockquote && level < blockquoteLevel) {
                    for (let i = 0; i < blockquoteLevel - level; i++) {
                        processedLines.push('</blockquote>');
                    }
                }
                if (level > blockquoteLevel) {
                    for (let i = blockquoteLevel; i < level; i++) {
                        processedLines.push('<blockquote>');
                    }
                }
                blockquoteLevel = level;
                inBlockquote = true;
            }
            processedLines.push(content + '<br/>');
        } else {
            if (inBlockquote) {
                for (let i = 0; i < blockquoteLevel; i++) {
                    processedLines.push('</blockquote>');
                }
                inBlockquote = false;
                blockquoteLevel = 0;
            }
            processedLines.push(line);
        }
    }
    
    if (inBlockquote) {
        for (let i = 0; i < blockquoteLevel; i++) {
            processedLines.push('</blockquote>');
        }
    }
    
    html = processedLines.join('\n');
    
    // Lists
    html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^  \- (.+)$/gm, '<ul><li>$1</li></ul>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/<\/ul>\n?<ul>/g, '');
    
    // Inline formatting
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
               .replace(/\*(.*?)\*/g, '<i>$1</i>')
               .replace(/_(.*?)_/g, '<u>$1</u>')
               .replace(/`(.*?)`/g, '<code>$1</code>');
    
    return html;
}

function addMessageToChat(htmlContent, className = '') {
    const p = document.createElement('p');
    if (className) {
        p.className = className;
    }
    p.innerHTML = htmlContent;
    chatOutput.appendChild(p);
    scrollToBottom();
}

function isRetroTheme() {
    return ['dark', 'hercules-orange', 'hercules-green', 'retroled', 'crt'].includes(state.theme);
}

function handleCommand(input) {
    const parts = input.slice(1).trim().split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
        case 'name':
        case 'nick':
            if (args) {
                state.userName = args;
                saveSettings();
                addMessageToChat(`User [${state.ipAddress}], aka ${escapeHtml(state.userName)}.`, 'system-message');
            } else {
                const randomName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
                const nameIndex = Math.floor(Math.random() * 10);
                state.userName = `${randomName}_${nameIndex}`;
                saveSettings();
                addMessageToChat(`[${state.ipAddress}] wants to be anonymous. Hello, ${escapeHtml(state.userName)}`, 'system-message');
            }
            break;
        case 'nightmode':
        case 'darkmode':
            state.theme = state.theme === 'dark' ? 'light' : 'dark';
            body.dataset.theme = state.theme;
            saveSettings();
            addMessageToChat(`Night mode ${state.theme === 'dark' ? 'enabled' : 'disabled'}.`, 'system-message');
            break;
        case 'hercules':
            if (!isRetroTheme()) {
                showHelp();
            } else if (args === 'orange') {
                state.theme = 'hercules-orange';
                body.dataset.theme = state.theme;
                saveSettings();
                addMessageToChat('Hercules monitor mode: Orange', 'system-message');
            } else if (args === 'green') {
                state.theme = 'hercules-green';
                body.dataset.theme = state.theme;
                saveSettings();
                addMessageToChat('Hercules monitor mode: Green', 'system-message');
            } else {
                addMessageToChat('Usage: /hercules orange | /hercules green', 'system-message');
            }
            break;
        case 'retroled':
            if (!isRetroTheme()) {
                showHelp();
            } else {
                state.theme = 'retroled';
                body.dataset.theme = state.theme;
                saveSettings();
                addMessageToChat('Retro LED mode: Red on black', 'system-message');
            }
            break;
        case 'crt':
            if (isRetroTheme()) {
                state.theme = 'crt';
                body.dataset.theme = state.theme;
                saveSettings();
                addMessageToChat('CRT TV mode: Blue-ish white on black', 'system-message');
            } else {
                state.theme = 'crt-light';
                body.dataset.theme = state.theme;
                saveSettings();
                addMessageToChat('CRT TV mode: Black on blue-ish white', 'system-message');
            }
            break;
        case 'time':
            const { date, time } = getCurrentTimestamp();
            addMessageToChat(`Current time: ${date} ${time}`, 'system-message');
            break;
        case 'whoami':
            addMessageToChat(`You are ${escapeHtml(state.userName)} [${state.ipAddress}]`, 'system-message');
            break;
        case 'echo':
            if (args) {
                addMessageToChat(escapeHtml(args), 'system-message');
            } else {
                addMessageToChat('Usage: /echo [message]', 'system-message');
            }
            break;
        case 'roll':
            const sides = args ? parseInt(args) : 6;
            if (isNaN(sides) || sides < 2) {
                addMessageToChat('Usage: /roll [sides] (default: 6)', 'system-message');
            } else {
                const result = Math.floor(Math.random() * sides) + 1;
                addMessageToChat(`🎲 Rolled a d${sides}: ${result}`, 'system-message');
            }
            break;
        case 'flip':
            const coin = Math.random() < 0.5 ? 'Heads' : 'Tails';
            addMessageToChat(`🪙 Coin flip: ${coin}`, 'system-message');
            break;
        case '8ball':
            const responses = [
                'It is certain.', 'Without a doubt.', 'Yes definitely.',
                'You may rely on it.', 'As I see it, yes.', 'Most likely.',
                'Outlook good.', 'Yes.', 'Signs point to yes.',
                'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
                'Cannot predict now.', 'Concentrate and ask again.',
                "Don't count on it.", 'My reply is no.', 'My sources say no.',
                'Outlook not so good.', 'Very doubtful.'
            ];
            const answer = responses[Math.floor(Math.random() * responses.length)];
            addMessageToChat(`🔮 Magic 8-Ball says: ${answer}`, 'system-message');
            break;
        case 'fortune':
            const fortunes = [
                'A pleasant surprise is waiting for you.',
                'Adventure awaits you in the near future.',
                'Your hard work will soon pay off.',
                'Good things come to those who wait.',
                'A friend will bring you unexpected joy.',
                'Trust your instincts today.',
                'The answer you seek lies within.',
                'New opportunities will knock on your door.'
            ];
            const fortune = fortunes[Math.floor(Math.random() * fortunes.length)];
            addMessageToChat(`🥠 Fortune: ${fortune}`, 'system-message');
            break;
        case 'uptime':
            const uptime = Date.now() - state.startTime;
            const seconds = Math.floor(uptime / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            addMessageToChat(`Uptime: ${hours}h ${minutes % 60}m ${seconds % 60}s`, 'system-message');
            break;
        case 'version':
            addMessageToChat('RetroTerm v2.0 - Enhanced Edition', 'system-message');
            break;
        case 'about':
            addMessageToChat('RetroTerm: A nostalgic terminal chat interface with modern flair.', 'system-message');
            break;
        case 'help':
            showHelp();
            break;
        case 'clear':
            chatOutput.innerHTML = '';
            addMessageToChat('Chat cleared.', 'system-message');
            break;
        default:
            addMessageToChat(`Unknown command: /${command}. Type /help for available commands.`, 'system-message');
            break;
    }
}

function showHelp() {
    addMessageToChat(`Available commands:
        <br>/name [new_name] - Change your nickname (leave empty for random).
        <br>/nightmode - Toggle dark/light theme.
        <br>/time - Display current date and time.
        <br>/whoami - Display your current user info.
        <br>/echo [message] - Echo a message.
        <br>/roll [sides] - Roll a dice (default: 6 sides).
        <br>/flip - Flip a coin.
        <br>/8ball - Ask the Magic 8-Ball a question.
        <br>/fortune - Get a fortune cookie message.
        <br>/uptime - Show session uptime.
        <br>/version - Show RetroTerm version.
        <br>/about - About RetroTerm.
        <br>/clear - Clear the chat screen.
        <br>/help - Show this help message.`, 'system-message');
}

function handleMessage(message) {
    const { date, time } = getCurrentTimestamp();
    const parsedMessage = parseMarkdown(message);
    const html = `
        <span class="timestamp">[${date}]</span>
        <span class="user-name">${escapeHtml(state.userName)}:</span>
        <span class="message-content">${parsedMessage}</span>
        <span class="timestamp">[${time}]</span>
    `;
    addMessageToChat(html, 'user-message');
}

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (message) {
        if (message.startsWith('/')) {
            handleCommand(message);
        } else {
            handleMessage(message);
        }
        chatInput.value = '';
    }
});

function initializeApp() {
    loadSettings();
    state.ipAddress = generateFakeIP();
    addMessageToChat('Welcome to RetroTerm.', 'system-message');
    addMessageToChat(`Your IP is ${state.ipAddress}. Your name is ${escapeHtml(state.userName)}.`, 'system-message');
    addMessageToChat('Type /help for a list of commands.', 'system-message');
    chatInput.focus();
}

window.addEventListener('load', initializeApp);