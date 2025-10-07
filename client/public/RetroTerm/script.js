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

let isArtWidgetLoaded = false;

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

function getFormattedTimestamp(dateSource) {
    const now = dateSource ? new Date(dateSource) : new Date();
    const month = getCircledNumber(now.getMonth() + 1);
    const day = getCircledNumber(now.getDate());
    const year = now.getFullYear();

    const century = Math.floor(year / 100);
    const yearPart = year % 100;
    const yearCircled = `${getCircledNumber(century)}${getCircledNumber(yearPart)}`;

    const date = `${month}/${day}/${yearCircled}`;

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

function parseMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^___$/gm, '<br/><hr/><br/>');
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
    html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^  \- (.+)$/gm, '<ul><li>$1</li></ul>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/<\/ul>\n?<ul>/g, '');
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
               .replace(/\*(.*?)\*/g, '<i>$1</i>')
               .replace(/_(.*?)_/g, '<u>$1</u>')
               .replace(/`(.*?)`/g, '<code>$1</code>');
    return html;
}

function addMessageToChat(htmlContent, className = '', addToHistory = false) {
    const p = document.createElement('p');
    if (className) p.className = className;
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

function isEmojiOnly(text) {
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
        case 'kill':
            if (args === '') {
                addMessageToChat('Disconnecting...', 'system-message');
                clearSessionData();
                setTimeout(() => {
                    window.location.href = 'https://www.gameship.online/info/vsms/RetroTerm/';
                }, 1000);
            }
            break;
        default:
            addMessageToChat(`Unknown local command: /${command}.`, 'system-message');
            break;
    }
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = chatInput.value.trim();
    if (!input) return;
    chatInput.value = '';

    if (input.startsWith('/')) {
        const parts = input.slice(1).split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        if (command === 'kill' && args === '9') {
            const sessionId = getSessionId();
            if (!sessionId) {
                addMessageToChat('Error: Not connected. Please refresh.', 'error-message');
            } else {
                const killMessage = `KILL9|${state.userName}|`;
                await serverApi.sendMessage(sessionId, killMessage);
                addMessageToChat('Kill request sent to server...', 'system-message');
            }
        } else {
            handleLocalCommand(input);
        }
    } else {
        await handleMessage(input);
    }
});

function startKillCountdown() {
    let countdown = 30;
    addMessageToChat(`% *Countdown to client close*: ***${countdown} Seconds***`, 'system-message');

    const interval = setInterval(() => {
        countdown -= 5;
        if (countdown > 0) {
            addMessageToChat(`% *Countdown to client close*: ***${countdown} Seconds***`, 'system-message');
        } else {
            clearInterval(interval);
            addMessageToChat('% Please create a valid session to continue chatting.', 'system-message');
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

    if (type === 'KILL9_INITIATE_REDIRECT') {
        startKillCountdown();
        return;
    }

    let html;
    const { date, time } = getFormattedTimestamp(data.timestamp);
    const nickname = parts[1];
    const content = parts.slice(2).join('|');

    switch (type) {
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
        case 'ECHO':
            const parsedEcho = parseMarkdown(content);
            html = `
                <span class="timestamp">[${date}]</span>
                <span class="message-content">${parsedEcho}</span>
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
    addMessageToChat('Welcome to RetroTerm.', 'system-message');
    addMessageToChat('Connecting to server...', 'system-message');

    try {
        const isNewJoiner = await initializeSession(state.userName);
        addMessageToChat(`Connected! You are known as ${escapeHtml(state.userName)}.`, 'system-message');
        connectWebSocket(displayBroadcastMessage);
        if (isNewJoiner) {
            await handleHistoryCommand();
        }
    } catch (error) {
        addMessageToChat(`Connection failed: ${error.message}`, 'error-message');
    }
    chatInput.focus();
}

window.addEventListener('load', initializeApp);