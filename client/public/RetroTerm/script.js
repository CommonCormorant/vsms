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
const reactionButton = document.getElementById('reaction-button');
const reactionWidget = document.getElementById('reaction-widget');
const artButton = document.getElementById('art-button');
const artWidget = document.getElementById('art-widget');
const pArtButton = document.getElementById('p-art-button');
const pArtWidget = document.getElementById('p-art-widget');
const pArtTextarea = document.getElementById('p-art-textarea');
const pArtClearButton = document.getElementById('p-art-clear');
const pArtSendButton = document.getElementById('p-art-send');

let isArtWidgetLoaded = false;

let state = {
    userName: 'guest',
    theme: 'light',
    startTime: Date.now(),
    joinTime: Date.now(),
    profile: '',
    messageHistory: [],
    onlineUsers: [],
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

function getFormattedTimestamp(dateSource) {
    const now = dateSource ? new Date(dateSource) : new Date();
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

function handleLocalCommand(input) {
    const parts = input.slice(1).trim().split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
        case 'name':
        case 'nick':
            if (args) {
                if (args.includes(',') || args.includes('!')) {
                    addMessageToChat('Nicknames cannot contain "," or "!".', 'error-message');
                } else {
                    state.userName = args;
                    saveSettings();
                    addMessageToChat(`You are now known as ${escapeHtml(state.userName)}.`, 'system-message');
                    checkForMail();
                }
            } else {
                const randomName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
                const nameIndex = Math.floor(Math.random() * 10);
                state.userName = `${randomName}_${nameIndex}`;
                saveSettings();
                addMessageToChat(`You have been assigned a random name: ${escapeHtml(state.userName)}`, 'system-message');
                checkForMail();
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
            const { date, time } = getFormattedTimestamp();
            addMessageToChat(`Current time: ${date} ${time}`, 'system-message');
            break;
        case '12':
        case '24':
            state.use24Hour = !state.use24Hour;
            saveSettings();
            addMessageToChat(`Time format switched to ${state.use24Hour ? '24-hour' : '12-hour'} mode.`, 'system-message');
            break;
        case 'whoami':
            addMessageToChat(`You are ${escapeHtml(state.userName)}.`, 'system-message');
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
                    const timeAgo = getTimeSinceJoin(state.joinTime);
                    addMessageToChat(`${escapeHtml(state.userName)} joined ${timeAgo} ago.`, 'system-message');
                    if (state.profile) {
                        addMessageToChat(`Says ${escapeHtml(state.userName)}, "${escapeHtml(state.profile)}"`, 'system-message');
                    }
                } else {
                    addMessageToChat(`User "${escapeHtml(targetName)}" not found. Whois is local and can only see yourself.`, 'system-message');
                }
            } else {
                addMessageToChat('Usage: /whois [nickname]', 'system-message');
            }
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
            let count;
            if (args.toLowerCase() === 'all') {
                count = state.messageHistory.length;
            } else {
                count = parseInt(args, 10) || 12;
            }
            const historyToShow = state.messageHistory.slice(-count);
            if (historyToShow.length === 0) {
                addMessageToChat('No recent messages to review.', 'system-message');
            } else {
                addMessageToChat(`--- Last ${historyToShow.length} Messages ---`, 'system-message');
                historyToShow.forEach(msg => {
                    const p = document.createElement('p');
                    if (msg.className) p.className = msg.className;
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
        case 'invite':
        case 'i':
            const sessionId = getSessionId();
            if (sessionId) {
                const inviteLink = `${window.location.origin}/rt/?sID=${sessionId}`;
                addMessageToChat(`Share this link to invite others: <a href="${inviteLink}" target="_blank">${inviteLink}</a>`, 'system-message');
            } else {
                addMessageToChat('Cannot generate invite link. No active session.', 'error-message');
            }
            break;
        case 'alone':
            handleAloneCommand();
            break;
        default:
            addMessageToChat(`Unknown local command: /${command}.`, 'system-message');
            break;
    }
}

function handleAloneCommand() {
    const otherUsers = state.onlineUsers.filter(u => u.toLowerCase() !== state.userName.toLowerCase());
    if (otherUsers.length === 0) {
        addMessageToChat("You are alone.", 'system-message');
    } else {
        const userList = otherUsers.map(u => escapeHtml(u)).join(', ');
        addMessageToChat(`Not alone. Currently online: ${userList}`, 'system-message');
    }
}

function handleImCommand(recipient, message) {
    const imMessage = `IM|${recipient}|${state.userName}|${message}`;
    serverApi.sendWsMessage(imMessage);
    addMessageToChat(`> [IM to ${escapeHtml(recipient)}]: ${escapeHtml(message)}`, 'private-message');
}

async function checkForMail() {
    if (!state.userName || state.userName === 'guest') return;
    try {
        const messages = await serverApi.checkMail(getSessionId(), state.userName);
        if (messages && messages.length > 0) {
            addMessageToChat(`--- You have ${messages.length} new message(s) ---`, 'system-message');
            messages.forEach(displayBroadcastMessage);
            addMessageToChat(`--- End of Messages ---`, 'system-message');
        } else {
            addMessageToChat('No new mail.', 'system-message');
        }
    } catch (error) {
        addMessageToChat(`Error checking mail: ${error.message}`, 'error-message');
    }
}

async function handleMailOutCommand() {
    addMessageToChat('Checking your sent mail...', 'system-message');
    try {
        const stats = await serverApi.checkMailOut(getSessionId(), state.userName);
        if (stats.total === 0) {
            addMessageToChat("You've sent no messages.", 'system-message');
        } else {
            const plural = stats.total > 1 ? 's' : '';
            let status_string;
            if (stats.unread === 0) {
                status_string = 'all have been read.';
            } else if (stats.read === 0) {
                status_string = 'all are unread.';
            } else {
                status_string = `${stats.read} read and ${stats.unread} remain unread.`;
            }
            addMessageToChat(`You've sent ${stats.total} message${plural}, ${status_string}`, 'system-message');
        }
    } catch (error) {
        addMessageToChat(`Error checking sent mail: ${error.message}`, 'error-message');
    }
}

function handleEncryptedMessageCommand(type, recipient, message) {
    const flags = {
        enc: 'x',
        encr: 'rx',
        enc2: 'xx',
        encr2: 'xr'
    };

    const flag = flags[type];
    if (!flag) {
        addMessageToChat(`Unknown encryption type: ${type}`, 'error-message');
        return;
    }

    const encryptedMessage = encryption[type](message);
    const mailMessage = `MAIL|${state.userName}|${recipient}|${encryptedMessage}|${flag}`;
    serverApi.sendWsMessage(mailMessage);
    addMessageToChat(`Your encrypted message to ${escapeHtml(recipient)} has been sent.`, 'system-message');
}

function handleMessageCommand(recipient, message) {
    // Corrected Format: MAIL|SENDER|RECIPIENT|MESSAGE|U
    const mailMessage = `MAIL|${state.userName}|${recipient}|${message}|U`;
    serverApi.sendWsMessage(mailMessage);
    addMessageToChat(`Your message to ${escapeHtml(recipient)} has been sent.`, 'system-message');
}

function convertToHex(text) {
    if (!text) return '';
    let hexChunks = [];
    for (let i = 0; i < text.length; i++) {
        const hex = text.charCodeAt(i).toString(16).padStart(2, '0');
        hexChunks.push(hex);
    }
    return hexChunks.join('');
}

const encryption = {
    enc: (text) => convertToHex(text),
    encr: (text) => convertToHex(text.split('').reverse().join('')),
    enc2: (text) => convertToHex(convertToHex(text)),
    encr2: (text) => convertToHex(text).split('').reverse().join('')
};

function showHelp() {
    addMessageToChat(`Available commands:
        <br>/name [new_name] - Change your nickname (leave empty for random).
        <br>/profile [bio] - Set your profile bio (leave empty to view).
        <br>/whoami - Display your current user info.
        <br>/whois [nickname] - Look up a user's info.
        <br>/alone - Check who is currently in the session.
        <br>/me [action] - Roleplay emote (/emote, /em, or : also work).
        <br>/im [recipient], [message] - Send an instant message to an online user (! also works).
        <br>/message [recipient], [message] - Send mail to a user (@ also works).
        <br>/message [recipient], [message] - Send mail to a user (/msg, /mail, @ also works).
        <br>/mail ? - Check for new mail (@? also works).
        <br>/invite - Get a shareable link to this chat session (/i, + also work).
        <br>/history [minutes] - Fetch server history (default: 15, max: 90). (/h also works).
        <br>/review [count] - Show local history (default: 12). (/ also works).
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

function handleMessage(message) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
        return;
    }
    const prefixedMessage = `MSG|${state.userName}|${message}`;
    serverApi.sendWsMessage(prefixedMessage);
}

function handleEmote(action) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
        return;
    }
    const emoteMessage = `EMOTE|${state.userName}|${action}`;
    serverApi.sendWsMessage(emoteMessage);
}

function handleArt(artContent) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
        return;
    }
    const artMessage = `ART|${state.userName}|${artContent}`;
    serverApi.sendWsMessage(artMessage);
    artWidget.classList.add('hidden');
}
window.sendArt = handleArt;

function handleParagraphArt(content) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
        return;
    }
    const processedContent = content.replace(/\n/g, '¶');
    const partMessage = `PART|${state.userName}|${processedContent}`;
    serverApi.sendWsMessage(partMessage);
    pArtWidget.classList.add('hidden');
    pArtTextarea.value = '';
}

function handleBroadcastCommand(command, args) {
    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
        return;
    }

    let prefixedMessage = '';

    switch (command) {
        case 'roll':
            const sides = args ? parseInt(args) : 6;
            if (isNaN(sides) || sides < 2) return;
            const result = Math.floor(Math.random() * sides) + 1;
            prefixedMessage = `ROLL|${state.userName}|d${sides} ${result}`;
            break;
        case 'flip':
            const coin = Math.random() < 0.5 ? 'Heads' : 'Tails';
            prefixedMessage = `FLIP|${state.userName}|${coin}`;
            break;
        default:
            return;
    }

    serverApi.sendWsMessage(prefixedMessage);
}

const LOCAL_COMMANDS = [
    'name', 'nick', 'nightmode', 'darkmode', 'hercules', 'retroled', 'crt',
    'time', '12', '24', 'whoami', 'profile', 'whois', '8ball', 'fortune',
    'uptime', 'version', 'about', 'help', 'review', 'clear', 'home', 'invite', 'i',
    'alone'
];

async function handleHistoryCommand(args) {
    let minutes = parseInt(args, 10);
    if (isNaN(minutes)) {
        minutes = 15; // Default to 15 minutes
    }
    minutes = Math.max(1, Math.min(minutes, 90));

    addMessageToChat(`Fetching history for the last ${minutes} minute(s)...`, 'system-message');
    try {
        const history = await serverApi.getHistory(getSessionId(), minutes);
        const filteredHistory = history.filter(item => !item.message.startsWith('MAIL|'));
        if (filteredHistory && filteredHistory.length > 0) {
            addMessageToChat('--- Start of History ---', 'system-message');
            filteredHistory.forEach(displayBroadcastMessage);
            addMessageToChat('--- End of History ---', 'system-message');
        } else {
            addMessageToChat('No history found for this session.', 'system-message');
        }
    } catch (error) {
        addMessageToChat(`Error fetching history: ${error.message}`, 'error-message');
    }
}

async function handleArchiveCommand() {
    addMessageToChat(`Fetching full message archive...`, 'system-message');
    try {
        const history = await serverApi.getArchive(getSessionId());
        const filteredHistory = history.filter(item => !item.message.startsWith('MAIL|'));
        if (filteredHistory && filteredHistory.length > 0) {
            addMessageToChat('--- Start of Archive ---', 'system-message');
            filteredHistory.forEach(displayBroadcastMessage);
            addMessageToChat('--- End of Archive ---', 'system-message');
        } else {
            addMessageToChat('No archive found for this session.', 'system-message');
        }
    } catch (error) {
        addMessageToChat(`Error fetching archive: ${error.message}`, 'error-message');
    }
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = chatInput.value.trim();
    if (!input) return;
    chatInput.value = '';

    if (input === '🧚🏼‍♀️') {
        await handleArchiveCommand();
        return;
    }

    if (input.startsWith(':') && input.length > 1) {
        handleEmote(input.slice(1).trim());
        return;
    }
    if (input.startsWith('%')) {
        const echoText = input.slice(1).trim();
        if (echoText) {
            const prefixedMessage = `ECHO||${echoText}`;
            serverApi.sendWsMessage(prefixedMessage);
        }
        return;
    }

    if (input.startsWith('.') && input.length > 1) {
        handleLocalCommand(`/name ${input.slice(1).trim()}`);
        return;
    }
    if (input.startsWith('&') && input.length > 1) {
        const suffix = input.slice(1).trim();
        if (suffix) {
            const newName = state.userName + suffix;
            if (newName.includes(',') || newName.includes('!')) {
                addMessageToChat('Nicknames cannot contain "," or "!".', 'error-message');
            } else {
                state.userName = newName;
                saveSettings();
                addMessageToChat(`You are now known as ${escapeHtml(state.userName)}.`, 'system-message');
                checkForMail();
            }
        }
        return;
    }

    if (input.startsWith('!')) {
        const content = input.slice(1).trim();
        const match = content.match(/^(.+?),(.+)$/s); // Use comma as delimiter

        if (match) {
            const recipient = match[1].trim();
            const message = match[2].trim();
            handleImCommand(recipient, message);
        } else {
            addMessageToChat('Usage: ! recipient, message', 'system-message');
        }
        return;
    }

    if (input.startsWith('@')) {
        const content = input.slice(1).trim();
        if (content === '?' || content === '') {
            checkForMail();
        } else {
            const match = content.match(/^(.+?),(.+)$/s); // Use comma as delimiter
            if (match) {
                const recipient = match[1].trim();
                const message = match[2].trim();
                handleMessageCommand(recipient, message);
            } else {
                addMessageToChat('Usage: @recipient, message  OR  @ or @? to check mail', 'system-message');
            }
        }
        return;
    }

    const shortcuts = {
        '?': '/help',
        '~': '/clear',
        '/': '/review',
        '.': '/name',
        '+': '/invite'
    };

    const commandInput = shortcuts[input] || input;

    if (commandInput.startsWith('/')) {
        const parts = commandInput.slice(1).split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        if (LOCAL_COMMANDS.includes(command)) {
            handleLocalCommand(commandInput);
        } else if (command === 'history' || command === 'h') {
            await handleHistoryCommand(args);
        } else if (['me', 'em', 'emote'].includes(command)) {
            handleEmote(args);
        } else if (command === 'im') {
            const match = args.match(/^(.+?),(.+)$/s); // Use comma as delimiter
            if (match) {
                const recipient = match[1].trim();
                const message = match[2].trim();
                handleImCommand(recipient, message);
            } else {
                addMessageToChat('Usage: /im recipient, message', 'system-message');
            }
        } else if (['message', 'msg'].includes(command)) {
            if (args.trim() === '?') {
                addMessageToChat('Bad syntax. To check for mail, use /mail or @.', 'system-message');
            } else {
                const match = args.match(/^(.+?),(.+)$/s);
                if (match) {
                    const recipient = match[1].trim();
                    const message = match[2].trim();
                    handleMessageCommand(recipient, message);
                } else {
                    addMessageToChat(`Usage: /${command} recipient, message`, 'system-message');
                }
            }
        } else if (command === 'mail' || command === 'mail?') {
            if (command === 'mail?') {
                args = '?';
            }
            const a = args.trim();
            if (a === '' || a === '?') {
                checkForMail();
            } else if (a === 'out') {
                handleMailOutCommand();
            } else {
                const match = args.match(/^(.+?),(.+)$/s);
                if (match) {
                    const recipient = match[1].trim();
                    const message = match[2].trim();
                    handleMessageCommand(recipient, message);
                } else {
                    addMessageToChat('Usage: /mail [?|out|recipient, message]', 'system-message');
                }
            }
        } else if (['enc', 'encrypt', 'encr', 'encryptr', 'enc2', 'encrypt2', 'encr2', 'encryptr2'].includes(command)) {
            const match = args.match(/^(.+?),(.+)$/s);
            if (match) {
                const recipient = match[1].trim();
                const message = match[2].trim();
                let type = command.replace('encrypt', 'enc');
                handleEncryptedMessageCommand(type, recipient, message);
            } else {
                addMessageToChat(`Usage: /${command} recipient, message`, 'system-message');
            }
        } else if (['roll', 'flip'].includes(command)) {
            handleBroadcastCommand(command, args);
        } else if (command === 'echo') {
            const prefixedMessage = `ECHO||${args}`;
            serverApi.sendWsMessage(prefixedMessage);
        } else if (command === 'kill') {
            if (args === '') {
                addMessageToChat('Disconnecting...', 'system-message');
                clearSessionData();
                setTimeout(() => {
                    window.location.href = 'https://www.gameship.online/info/vsms/RetroTerm/';
                }, 1000);
            } else if (args === '9') {
                const sessionId = getSessionId();
                if (!sessionId) {
                    addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
                } else {
                    const killMessage = `KILL9|${state.userName}|`;
                    serverApi.sendWsMessage(killMessage);
                }
            }
        } else {
            addMessageToChat(`Unknown command: ${commandInput}. Type /help for assistance.`, 'system-message');
        }
    } else {
        handleMessage(commandInput);
    }
});

const REACTIONS = [
    { emoji: '❤️', description: 'love / affection' },
    { emoji: '😊', description: 'happiness / approval' },
    { emoji: '😂', description: 'amusement / shared laughter' },
    { emoji: '😉', description: 'winking / friendly gesture' },
    { emoji: '😢', description: 'crying / sadness' },
    { emoji: '😞', description: 'sadness / sympathy' },
    { emoji: '😳', description: 'surprise / shock / embarrassment' },
    { emoji: '😠', description: 'anger / disapproval' },
    { emoji: '😒', description: 'disgust / disdain' },
    { emoji: '😨', description: 'fear / anxiety' },
    { emoji: '🤪', description: 'zany / silliness' },
    { emoji: '👍🏻', description: 'approval / agreement' },
    { emoji: '👎', description: 'disapproval / disagreement' }
];

function populateReactionWidget() {
    reactionWidget.innerHTML = '';
    REACTIONS.forEach(({ emoji, description }) => {
        const button = document.createElement('button');
        button.textContent = emoji;
        button.title = description;
        button.setAttribute('aria-label', description);
        reactionWidget.appendChild(button);
    });
}

reactionButton.addEventListener('click', (event) => {
    event.stopPropagation();
    reactionWidget.classList.toggle('hidden');
});

reactionWidget.addEventListener('click', async (event) => {
    if (event.target.tagName === 'BUTTON') {
        const emoji = event.target.textContent;
        await handleMessage(emoji);
        reactionWidget.classList.add('hidden');
    }
});

function loadArtWidget() {
    if (isArtWidgetLoaded) return;

    const iframe = document.createElement('iframe');
    iframe.src = 'EmojiPaint.html';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    artWidget.appendChild(iframe);
    isArtWidgetLoaded = true;
}

artButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!isArtWidgetLoaded) {
        loadArtWidget();
    }
    artWidget.classList.toggle('hidden');
    reactionWidget.classList.add('hidden');
    pArtWidget.classList.add('hidden');
});

pArtButton.addEventListener('click', (event) => {
    event.stopPropagation();
    pArtWidget.classList.toggle('hidden');
    artWidget.classList.add('hidden');
    reactionWidget.classList.add('hidden');
});

pArtClearButton.addEventListener('click', () => {
    pArtTextarea.value = '';
});

pArtSendButton.addEventListener('click', async () => {
    const content = pArtTextarea.value.trim();
    if (content) {
        await handleParagraphArt(content);
    }
});

document.addEventListener('click', (event) => {
    if (!reactionWidget.classList.contains('hidden') && !reactionWidget.contains(event.target) && event.target !== reactionButton) {
        reactionWidget.classList.add('hidden');
    }
    if (!artWidget.classList.contains('hidden') && !artWidget.contains(event.target) && event.target !== artButton) {
        artWidget.classList.add('hidden');
    }
    if (!pArtWidget.classList.contains('hidden') && !pArtWidget.contains(event.target) && event.target !== pArtButton) {
        pArtWidget.classList.add('hidden');
    }
});

function startKillCountdown() {
    let countdown = 30;
    addMessageToChat(`***Countdown to client close: ${countdown} Seconds***`, 'system-message');

    const interval = setInterval(() => {
        countdown -= 5;
        if (countdown > 0) {
            addMessageToChat(`***Countdown to client close: ${countdown} Seconds***`, 'system-message');
        } else {
            clearInterval(interval);
            addMessageToChat('***SESSION DELETED*** :: Resetting clients.', 'system-message');
            clearSessionData();
            setTimeout(() => {
                window.location.href = 'https://vsms.gameship.online/';
            }, 2000);
        }
    }, 5000);
}

function displayBroadcastMessage(data) {
    const { message } = data;
    const parts = message.split('|');
    const type = parts[0];

    if (type === 'KILL9_DB_ERROR') {
        addMessageToChat('***CRITICAL SERVER ERROR: Failed to delete session.***', 'error-message');
        return;
    }

    if (type === 'KILL9_INITIATE_REDIRECT') {
        startKillCountdown();
        return;
    }

    // Handle user joining or leaving. A PART message with 2 parts is a leave event.
    if (type === 'WELCOME') {
        const userList = parts[1] ? parts[1].split(',') : [];
        state.onlineUsers = userList.map(u => escapeHtml(u));
        addMessageToChat(`Online: ${state.onlineUsers.length > 0 ? state.onlineUsers.join(', ') : 'Just you!'}`, 'system-message');
        return;
    }

    if (type === 'JOIN' || (type === 'PART' && parts.length === 2)) {
        const user = escapeHtml(parts[1]);
        if (type === 'JOIN') {
            if (!state.onlineUsers.find(u => u.toLowerCase() === user.toLowerCase())) {
                state.onlineUsers.push(user);
            }
            addMessageToChat(`* ${user} has joined.`, 'system-message');
        } else { // PART
            state.onlineUsers = state.onlineUsers.filter(u => u.toLowerCase() !== user.toLowerCase());
            addMessageToChat(`* ${user} has left.`, 'system-message');
        }
        return;
    }

    if (type === 'DELIVERY_FAILED') {
        const recipient = escapeHtml(parts[1]);
        addMessageToChat(`! Your instant message to ${recipient} could not be delivered. They are not online.`, 'error-message');
        return;
    }

    const { date, time } = getFormattedTimestamp(data.timestamp);
    const nickname = parts[1];
    const content = parts.slice(2).join('|');
    let html = '';

    switch (type) {
        case 'IM': // Incoming Instant Message
            const sender = nickname;
            const imContent = content;
            html = `
                <span class="timestamp">[${date}]</span>
                <span style="color: var(--accent-color-2);">[IM from ${escapeHtml(sender)}]:</span>
                <span class="message-content">${parseMarkdown(imContent)}</span>
                <span class="timestamp">[${time}]</span>
            `;
            addMessageToChat(html, 'private-message', true);
            return; // IMs are handled completely, so we return early.
        case 'MAIL':
            const mailSender = parts[1];
            const mailRecipient = parts[2];
            const mailContent = parts.slice(3, -1).join('|'); // Exclude status flag
            if (mailRecipient.toLowerCase() === state.userName.toLowerCase()) {
                 html = `
                    <span class="timestamp">[${date}]</span>
                    <span style="color: var(--accent-color);">[Mail from ${escapeHtml(mailSender)}]:</span>
                    <span class="message-content">${parseMarkdown(mailContent)}</span>
                    <span class="timestamp">[${time}]</span>
                `;
                addMessageToChat(html, 'private-message', true);
            }
            return;
        case 'MSG':
            const parsedMessage = parseMarkdown(content);
            const emojiClass = isEmojiOnly(content) ? ' big-emoji' : '';
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="user-name">${escapeHtml(nickname)}:</span>
                <span class="message-content${emojiClass}">${parsedMessage}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        case 'EMOTE':
            const parsedAction = parseMarkdown(content);
            html = `
                <span class="timestamp">[${date}]</span>
                <span style="color: var(--system-color); font-style: italic;">* ${escapeHtml(nickname)} ${parsedAction}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        case 'ROLL':
            const [dice, result] = content.split(' ');
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="user-name">${escapeHtml(nickname)}:</span>
                <span class="message-content">🎲 Rolled a ${dice}: ${result}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        case 'FLIP':
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="user-name">${escapeHtml(nickname)}:</span>
                <span class="message-content">🪙 Coin flip: ${content}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        case 'ECHO':
            const parsedEcho = parseMarkdown(content);
            const echoEmojiClass = isEmojiOnly(content) ? ' big-emoji' : '';
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="message-content${echoEmojiClass}">${parsedEcho}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        case 'ART':
            const artContent = content.replace(/¶/g, '<br>');
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="user-name">${escapeHtml(nickname)}:</span>
                <div class="message-content">
                    <div class="art-content">${artContent}</div>
                </div>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        case 'PART':
            // Render markdown first, then replace pilcrows with line breaks
            let partContent = parseMarkdown(content);
            partContent = partContent.replace(/¶/g, '<br>');
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="user-name">${escapeHtml(nickname)}:</span>
                <span class="message-content">${partContent}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
        default:
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="message-content">${escapeHtml(message)}</span>
                <span class="timestamp">[${time}]</span>
            `;
            break;
    }

    addMessageToChat(html, 'user-message', true);
}

async function initializeApp() {
    loadSettings();
    populateReactionWidget();
    addMessageToChat('Welcome to RetroTerm.', 'system-message');
    addMessageToChat('Connecting to server...', 'system-message');

    try {
        const isNewJoiner = await initializeSession(state.userName);
        addMessageToChat(`Connected! You are known as ${escapeHtml(state.userName)}.`, 'system-message');
        connectWebSocket(state.userName, displayBroadcastMessage);

        if (isNewJoiner) {
            await handleHistoryCommand();
            await handleEmote("has joined.");
        }

        // The WELCOME message from the WebSocket will provide the initial user list.
        addMessageToChat('Type /help for a list of commands.', 'system-message');
    } catch (error) {
        addMessageToChat(`Connection failed: ${error.message}`, 'error-message');
    }

    chatInput.focus();
}

window.addEventListener('load', initializeApp);