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
    theme: 'light',
    startTime: Date.now(),
    joinTime: Date.now(),
    profile: '',
    messageHistory: [],
    use24Hour: true
};

function saveSettings() {
    const settings = {
        userName: state.userName,
        theme: state.theme,
        profile: state.profile,
        joinTime: state.joinTime,
        use24Hour: state.use24Hour
    };
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem(APP_STORAGE_KEY);
    if (saved) {
        const settings = JSON.parse(saved);
        state.userName = settings.userName || 'guest';
        state.theme = settings.theme || 'light';
        state.profile = settings.profile || '';
        state.joinTime = settings.joinTime || Date.now();
        state.use24Hour = settings.use24Hour !== undefined ? settings.use24Hour : true;
        body.dataset.theme = state.theme;
    }
}

function getCircledNumber(num) {
    if (num >= 1 && num <= 20) {
        return String.fromCharCode(0x245F + num); // ① to ⑳
    } else if (num >= 21 && num <= 35) {
        return String.fromCharCode(0x3250 + (num - 20)); // ㉑ to ㉟
    } else if (num >= 36 && num <= 50) {
        return String.fromCharCode(0x32B0 + (num - 35)); // ㊱ to ㊿
    }
    return num.toString(); // Fallback for numbers outside range
}

function getCurrentTimestamp() {
    const now = new Date();
    const month = getCircledNumber(now.getMonth() + 1);
    const day = getCircledNumber(now.getDate());
    const year = now.getFullYear();
    
    // Convert year to two circled numbers (e.g., 2025 → ⑳㉕)
    const century = Math.floor(year / 100); // 20
    const yearPart = year % 100; // 25
    const yearCircled = `${getCircledNumber(century)}${getCircledNumber(yearPart)}`;
    
    const date = `${month}/${day}/${yearCircled}`;
    
    // Time format based on user preference
    let time;
    if (state.use24Hour) {
        time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } else {
        time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }
    
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

function getIPLocation(ip) {
    // Generate a fun fake location based on IP
    const cities = ['Tokyo', 'Paris', 'New York', 'London', 'Sydney', 'Berlin', 
                    'Toronto', 'Mumbai', 'São Paulo', 'Singapore', 'Amsterdam', 
                    'Dubai', 'Hong Kong', 'Moscow', 'Cairo'];
    const sum = ip.split('.').reduce((a, b) => parseInt(a) + parseInt(b), 0);
    return cities[sum % cities.length];
}

function getTimeSinceJoin(joinTime) {
    const diff = Date.now() - joinTime;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
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

function addMessageToChat(htmlContent, className = '', addToHistory = false) {
    const p = document.createElement('p');
    if (className) {
        p.className = className;
    }
    p.innerHTML = htmlContent;
    chatOutput.appendChild(p);
    scrollToBottom();
    
    if (addToHistory) {
        state.messageHistory.push({ content: htmlContent, className: className });
        if (state.messageHistory.length > 12) {
            state.messageHistory.shift();
        }
    }
}

function isRetroTheme() {
    return ['dark', 'hercules-orange', 'hercules-green', 'retroled', 'crt', 'crt-light'].includes(state.theme);
}

function isEmojiOnly(text) {
    // Check if text is a single emoji (or multiple emojis with no other characters)
    const emojiRegex = /^[\p{Emoji}\s]+$/u;
    const hasNonWhitespace = /\S/.test(text);
    const emojiCount = (text.match(/\p{Emoji}/gu) || []).length;
    return emojiRegex.test(text) && hasNonWhitespace && emojiCount >= 1 && emojiCount <= 3;
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
                addMessageToChat(`You are now known as ${escapeHtml(state.userName)}.`, 'system-message');
            } else {
                const randomName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
                const nameIndex = Math.floor(Math.random() * 10);
                state.userName = `${randomName}_${nameIndex}`;
                saveSettings();
                addMessageToChat(`You have been assigned a random name: ${escapeHtml(state.userName)}`, 'system-message');
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
        case '12':
        case '24':
            state.use24Hour = !state.use24Hour;
            saveSettings();
            addMessageToChat(`Time format switched to ${state.use24Hour ? '24-hour' : '12-hour'} mode.`, 'system-message');
            break;
        case 'whoami':
            addMessageToChat(`You are ${escapeHtml(state.userName)} [${state.ipAddress}]`, 'system-message');
            break;
        case 'me':
        case 'emote':
        case 'em':
            if (args) {
                handleEmote(args);
            } else {
                addMessageToChat('Usage: /me [action]', 'system-message');
            }
            break;
        case 'profile':
            if (args) {
                state.profile = args;
                saveSettings();
                addMessageToChat(`Profile updated for ${escapeHtml(state.userName)}.`, 'system-message');
            } else if (state.profile) {
                addMessageToChat(`Your profile: ${escapeHtml(state.profile)}`, 'system-message');
            } else {
                addMessageToChat('No profile set. Usage: /profile [your bio]', 'system-message');
            }
            break;
        case 'whois':
            if (args) {
                const targetName = args.trim();
                if (targetName.toLowerCase() === state.userName.toLowerCase()) {
                    const location = getIPLocation(state.ipAddress);
                    const timeAgo = getTimeSinceJoin(state.joinTime);
                    addMessageToChat(`${escapeHtml(state.userName)} joined ${timeAgo} ago from ${location}.`, 'system-message');
                    if (state.profile) {
                        addMessageToChat(`Says ${escapeHtml(state.userName)}, "${escapeHtml(state.profile)}"`, 'system-message');
                    }
                } else {
                    addMessageToChat(`User "${escapeHtml(targetName)}" not found. (In a real chat, this would show other users!)`, 'system-message');
                }
            } else {
                addMessageToChat('Usage: /whois [nickname]', 'system-message');
            }
            break;
        case 'echo':
            if (args) {
                const { date, time } = getCurrentTimestamp();
                const parsedMessage = parseMarkdown(args);
                const emojiClass = isEmojiOnly(args) ? ' big-emoji' : '';
                const html = `
                    <span class="timestamp">[${date}]</span>
                    <span class="message-content${emojiClass}">${parsedMessage}</span>
                    <span class="timestamp">[${time}]</span>
                `;
                addMessageToChat(html, 'user-message', true);
            } else {
                addMessageToChat('Usage: /echo [message]', 'system-message');
            }
            break;
        case 'roll':
            const sides = args ? parseInt(args) : 6;
            if (isNaN(sides) || sides < 2) {
                addMessageToChat('Usage: /roll [sides] (default: 6)', 'system-message');
            } else {
                handleBroadcastCommand('roll', args);
            }
            break;
        case 'flip':
            handleBroadcastCommand('flip', args);
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
        case 'review':
            if (state.messageHistory.length === 0) {
                addMessageToChat('No recent messages to review.', 'system-message');
            } else {
                addMessageToChat('--- Recent History ---', 'system-message');
                state.messageHistory.forEach(msg => {
                    const p = document.createElement('p');
                    if (msg.className) {
                        p.className = msg.className;
                    }
                    p.innerHTML = msg.content;
                    chatOutput.appendChild(p);
                });
                scrollToBottom();
                addMessageToChat('--- End of History ---', 'system-message');
            }
            break;
        case 'clear':
        case 'home':
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
        <br>/profile [bio] - Set your profile bio (leave empty to view).
        <br>/whoami - Display your current user info.
        <br>/whois [nickname] - Look up a user's info.
        <br>/me [action] - Roleplay emote (/emote, /em, or : also work).
        <br>/review - Show last 12 messages (/ also works).
        <br>/nightmode - Toggle dark/light theme.
        <br>/time - Display current date and time.
        <br>/12 or /24 - Toggle 12/24 hour time format.
        <br>/echo [message] - Echo a message (% also works).
        <br>/roll [sides] - Roll a dice (default: 6 sides).
        <br>/flip - Flip a coin.
        <br>/8ball - Ask the Magic 8-Ball a question.
        <br>/fortune - Get a fortune cookie message.
        <br>/uptime - Show session uptime.
        <br>/version - Show RetroTerm version.
        <br>/about - About RetroTerm.
        <br>/clear or /home - Clear the chat screen (~ also works).
        <br>/help - Show this help message (? also works).`, 'system-message');
}

async function handleMessage(message) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
        return;
    }

    const { date, time } = getCurrentTimestamp();
    const parsedMessage = parseMarkdown(message);
    const emojiClass = isEmojiOnly(message) ? ' big-emoji' : '';

    const html = `
        <span class="timestamp">[${date}]</span>
        <span class="user-name">${escapeHtml(state.userName)}:</span>
        <span class="message-content${emojiClass}">${parsedMessage}</span>
        <span class="timestamp">[${time}]</span>
    `;

    try {
        await serverApi.sendMessage(sessionId, html);
    } catch (error) {
        console.error('Failed to send message:', error);
        addMessageToChat(`Error sending message: ${error.message}`, 'error-message');
    }
}

async function handleEmote(action) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
        return;
    }

    const { date, time } = getCurrentTimestamp();
    const parsedAction = parseMarkdown(action);
    const html = `
        <span class="timestamp">[${date}]</span>
        <span style="color: var(--system-color); font-style: italic;">* ${escapeHtml(state.userName)} ${parsedAction}</span>
        <span class="timestamp">[${time}]</span>
    `;

    try {
        await serverApi.sendMessage(sessionId, html);
    } catch (error) {
        console.error('Failed to send emote:', error);
        addMessageToChat(`Error sending emote: ${error.message}`, 'error-message');
    }
}

async function handleBroadcastCommand(command, args) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
        return false;
    }

    let html = '';
    const { date, time } = getCurrentTimestamp();

    switch (command) {
        case 'roll':
            const sides = args ? parseInt(args) : 6;
            if (isNaN(sides) || sides < 2) return false;
            const result = Math.floor(Math.random() * sides) + 1;
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="user-name">${escapeHtml(state.userName)}:</span>
                <span class="message-content">🎲 Rolled a d${sides}: ${result}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        case 'flip':
            const coin = Math.random() < 0.5 ? 'Heads' : 'Tails';
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="user-name">${escapeHtml(state.userName)}:</span>
                <span class="message-content">🪙 Coin flip: ${coin}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        default:
            return false;
    }

    try {
        await serverApi.sendMessage(sessionId, html);
        return true;
    } catch (error) {
        console.error(`Failed to send ${command}:`, error);
        addMessageToChat(`Error sending command: ${error.message}`, 'error-message');
        return false;
    }
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (message) {
        // Handle local commands first
        if (message.startsWith('/') && (
            message.startsWith('/help') || message.startsWith('/clear') || message.startsWith('/home') ||
            message.startsWith('/review') || message.startsWith('/nightmode') || message.startsWith('/darkmode') ||
            message.startsWith('/time') || message.startsWith('/12') || message.startsWith('/24') ||
            message.startsWith('/whoami') || message.startsWith('/whois') || message.startsWith('/profile') ||
            message.startsWith('/uptime') || message.startsWith('/version') || message.startsWith('/about') ||
            message.startsWith('/hercules') || message.startsWith('/retroled') || message.startsWith('/crt') ||
            message.startsWith('/8ball') || message.startsWith('/fortune')
        )) {
            handleCommand(message);
        } else if (message.startsWith('/')) {
            // Server-side commands
            await handleCommand(message);
        } else if (message === '?') {
            handleCommand('/help');
        } else if (message === '~' || message === '/home') {
            handleCommand('/clear');
        } else if (message === '/') {
            handleCommand('/review');
        } else if (message.startsWith(':') && message.length > 1) {
            await handleEmote(message.slice(1).trim());
        } else if (message.startsWith('%') && message.length > 1) {
            // Echo is special, it's a broadcast but formatted differently
            const sessionId = getSessionId();
            if (!sessionId) {
                addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
            } else {
                const echoText = message.slice(1).trim();
                if (echoText) {
                    const { date, time } = getCurrentTimestamp();
                    const parsedMessage = parseMarkdown(echoText);
                    const emojiClass = isEmojiOnly(echoText) ? ' big-emoji' : '';
                    const html = `
                        <span class="timestamp">[${date}]</span>
                        <span class="message-content${emojiClass}">${parsedMessage}</span>
                        <span class="timestamp">[${time}]</span>
                    `;
                    await serverApi.sendMessage(sessionId, html);
                }
            }
        } else if (message.startsWith('.') && message.length > 1) {
            handleCommand(`/name ${message.slice(1).trim()}`);
        } else if (message === '.') {
            handleCommand('/name');
        } else if (message.startsWith('@') && message.length > 1) {
            const suffix = message.slice(1).trim();
            if (suffix) {
                state.userName = state.userName + suffix;
                saveSettings();
                addMessageToChat(`You are now known as ${escapeHtml(state.userName)}.`, 'system-message');
            }
        } else if (message === '@') {
            handleCommand('/whoami');
        } else {
            await handleMessage(message);
        }
        chatInput.value = '';
    }
});

function displayBroadcastMessage(htmlContent) {
    // This function is called by the WebSocket handler in client.js
    // It receives the pre-formatted HTML message from the server
    addMessageToChat(htmlContent, 'user-message', true);
}

async function initializeApp() {
    loadSettings();
    addMessageToChat('Welcome to RetroTerm.', 'system-message');
    addMessageToChat('Connecting to server...', 'system-message');

    try {
        await initializeSession(state.userName);
        addMessageToChat(`Connected! You are known as ${escapeHtml(state.userName)}.`, 'system-message');
        connectWebSocket(); // Establish WebSocket connection
        addMessageToChat('Type /help for a list of commands.', 'system-message');
    } catch (error) {
        addMessageToChat(`Connection failed: ${error.message}. Please refresh to try again.`, 'error-message');
    }

    chatInput.focus();
}

window.addEventListener('load', initializeApp);