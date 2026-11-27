document.body.addEventListener('dblclick', function(event) {
    event.preventDefault();
});

const APP_STORAGE_KEY = 'retroTermAppSettings';
window.APP_STORAGE_KEY = APP_STORAGE_KEY;

// Remembered /enc level, stored apart from the settings blob so a
// later auto-encrypting /im can read it. 0 (or a missing key) means
// plain IMs; /enc 0 turns auto-encryption off.
const ENC_LEVEL_KEY = 'vsmsEncLevel';

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
    baseUserName: 'guest',
    theme: 'light',
    startTime: Date.now(),
    joinTime: Date.now(),
    profile: '',
    messageHistory: [],
    onlineUsers: [],
    use24Hour: true,
    encLevel: 0, // remembered /enc level (0 = plain IMs)
    // Pieces of the BBS-style connection status box, collected as they
    // arrive (REGISTERED, registration complete, WELCOME) and printed as
    // one block once all three are in.
    statusBox: { established: false, knownAs: null, online: null, printed: false }
};

function saveSettings() {
    const settings = {
        userName: state.userName,
        baseUserName: state.baseUserName,
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
        state.baseUserName = settings.baseUserName || state.userName;
        state.theme = settings.theme || 'light';
        state.profile = settings.profile || '';
        state.joinTime = settings.joinTime || Date.now();
        state.use24Hour = settings.use24Hour !== undefined ? settings.use24Hour : true;
        body.dataset.theme = state.theme;
    }
    const savedEnc = parseInt(localStorage.getItem(ENC_LEVEL_KEY) || '0', 10);
    state.encLevel = Number.isNaN(savedEnc) ? 0 : savedEnc;
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

function addMessageToChat(htmlContent, className = '', addToHistory = false, mood = '') {
    const p = document.createElement('p');
    if (className) {
        p.className = className;
    }
    if (mood) {
        p.classList.add(`mood-${mood}`);
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
    return p;
}

// BBS-style connection status box: the three status lines ("Real-time
// connection established.", "You are now known as ...", "Online: ...")
// as a single <pre>-style block so the box-drawing joints stay connected.
// The lines arrive at different times, so each arrival records its piece
// and tryPrintStatusBox() prints the box once all three are in.
function buildStatusBox() {
    const box = state.statusBox;
    const onlineText = box.online.length > 0 ? box.online.join(', ') : 'Just you!';
    const lines = [
        'Real-time connection established.',
        `You are now known as ${box.knownAs}.`,
        `Online: ${onlineText}`,
    ];
    const contentWidth = Math.max(...lines.map(l => l.length));
    const innerWidth = contentWidth + 2;
    const title = '═[ RetroTerm ]';
    const top = '╔' + title + '═'.repeat(Math.max(0, innerWidth - title.length)) + '╗';
    const sep = '╠' + '═'.repeat(innerWidth) + '╣';
    const bottom = '╚' + '═'.repeat(innerWidth) + '╝';
    const rows = lines.map(l => '║ ' + l.padEnd(contentWidth) + ' ║');
    return [top, rows[0], sep, rows[1], rows[2], bottom].join('\n');
}

function tryPrintStatusBox() {
    const box = state.statusBox;
    if (box.printed || !box.established || !box.knownAs || box.online === null) return;
    box.printed = true;
    addMessageToChat(buildStatusBox(), 'system-message status-box');
}


// Room status bar: the people currently in the room, each name a link.
// Clicking a name opens a dropdown of things you can do with that person.
// Picking an item only COMPOSES the command text into the input box, as
// if you had typed it — nothing is sent until you push Send.
//   Private/instant message -> !Name,
//   Mail/message            -> @Name,
//   Image                   -> >Name, image
// Audio-only and video calls have no command yet (no call code exists —
// the peer ladder is images now, voice/video later), so they are not in
// the dropdown.
// The bar stays live: it re-renders on every WELCOME / JOIN / PART /
// NICK_UPDATE, so a join appears without a refresh and a name never
// lingers after its person has left.
let roomStatusOpenNick = null;

function otherRoomUsers() {
    return state.onlineUsers.filter(u => u.toLowerCase() !== state.userName.toLowerCase());
}

function composeRoomCommand(text) {
    chatInput.value = text;
    chatInput.focus();
    const len = chatInput.value.length;
    try { chatInput.setSelectionRange(len, len); } catch (e) { /* older browsers */ }
}

function roomDropdownItems(nick) {
    return [
        { label: `Private/instant message to ${nick}`, text: `!${nick}, ` },
        { label: `Mail/message to ${nick}`, text: `@${nick}, ` },
        { sep: '- Peer-to-peer -' },
        { label: `Image to ${nick}`, text: `>${nick}, image` },
    ];
}

function renderRoomStatusBar() {
    const bar = document.getElementById('room-statusbar');
    if (!bar) return;
    const others = otherRoomUsers();
    // If the person whose dropdown is open has left, close it.
    if (roomStatusOpenNick !== null && !others.some(u => u.toLowerCase() === roomStatusOpenNick.toLowerCase())) {
        roomStatusOpenNick = null;
    }
    if (others.length === 0) {
        roomStatusOpenNick = null;
        bar.innerHTML = '<span class="room-alone">Just you</span>';
        return;
    }
    bar.innerHTML = others.map(nick => {
        const safe = escapeHtml(nick);
        const open = roomStatusOpenNick !== null && roomStatusOpenNick.toLowerCase() === nick.toLowerCase();
        let dropdown = '';
        if (open) {
            const items = roomDropdownItems(nick).map(item => {
                if (item.sep) return `<div class="room-dropdown-sep">${escapeHtml(item.sep)}</div>`;
                return `<button type="button" class="room-dropdown-item" data-command="${escapeHtml(item.text)}">${escapeHtml(item.label)}</button>`;
            }).join('');
            dropdown = `<div class="room-dropdown">${items}</div>`;
        }
        return `<span class="room-person-wrap"><a class="room-person" data-nick="${safe}">${safe}</a>${dropdown}</span>`;
    }).join('');
}

function onRoomStatusBarClick(event) {
    const item = event.target.closest('.room-dropdown-item');
    if (item) {
        composeRoomCommand(item.dataset.command);
        roomStatusOpenNick = null;
        renderRoomStatusBar();
        event.stopPropagation();
        return;
    }
    const person = event.target.closest('.room-person');
    if (person) {
        const nick = person.dataset.nick;
        roomStatusOpenNick = (roomStatusOpenNick !== null && roomStatusOpenNick.toLowerCase() === nick.toLowerCase()) ? null : nick;
        renderRoomStatusBar();
        event.stopPropagation();
        return;
    }
}

// Wire the bar once (this script runs at the end of <body>, so the bar
// element already exists). Clicks elsewhere or Escape close the dropdown.
const roomStatusBarEl = document.getElementById('room-statusbar');
if (roomStatusBarEl) {
    roomStatusBarEl.addEventListener('click', onRoomStatusBarClick);
}
document.addEventListener('click', () => {
    if (roomStatusOpenNick !== null) {
        roomStatusOpenNick = null;
        renderRoomStatusBar();
    }
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && roomStatusOpenNick !== null) {
        roomStatusOpenNick = null;
        renderRoomStatusBar();
    }
});

function isRetroTheme() {
    return ['dark', 'hercules-orange', 'hercules-green', 'retroled', 'crt', 'crt-light'].includes(state.theme);
}

function isEmojiOnly(text) {
    try {
        // Check if text is a single emoji (or multiple emojis with no other characters)
        const emojiRegex = /^[\p{Emoji}\s]+$/u;
        const hasNonWhitespace = /\S/.test(text);
        const emojiCount = (text.match(/\p{Emoji}/gu) || []).length;
        return emojiRegex.test(text) && hasNonWhitespace && emojiCount >= 1 && emojiCount <= 3;
    } catch (e) {
        // Fallback for browsers that don't support Unicode property escapes (\p{Emoji})
        console.warn('Unicode property escapes not supported, skipping big-emoji check.');
        return false;
    }
}

// /enc level words are reserved and can never be a nickname, so they
// are never confused with a level in a command. "all" is reserved
// separately, by the server. The server enforces the same rule; this
// is the immediate client-side feedback.
function isReservedNickname(name) {
    if ([...name].length === 1) return true;
    switch (name.toLowerCase()) {
        case 'def': case 'default': case 'med': case 'medium':
        case 'lo': case 'low': case 'hi': case 'high':
            return true;
        default:
            return false;
    }
}

function handleLocalCommand(input) {
    const parts = input.slice(1).trim().split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
        case 'name':
        case 'nick':
            let newName = args;
            if (!newName) {
                const randomName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
                const nameIndex = Math.floor(Math.random() * 10);
                newName = `${randomName}_${nameIndex}`;
            }

            if (newName.includes(',') || newName.includes('!')) {
                addMessageToChat('Nicknames cannot contain "," or "!".', 'error-message');
            } else if (isReservedNickname(newName)) {
                addMessageToChat('That nickname is reserved. Pick another one.', 'error-message');
            } else {
                state.baseUserName = newName;
                const nickMessage = `NICK|${state.userName}|${newName}`;
                serverApi.sendWsMessage(nickMessage);
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
            if (state.userName.startsWith('guest')) {
                addMessageToChat('You must change your /name from "guest" to set a profile.', 'error-message');
                return;
            }
            if (args) {
                const profileMessage = `PROFILE|${state.userName}|${args}`;
                serverApi.sendWsMessage(profileMessage);
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
                serverApi.getWhois(targetName)
                    .then(data => {
                        let whoisMessage = `${escapeHtml(targetName)} first arrived ${data.first_arrived}<br>`;
                        whoisMessage += `From ${escapeHtml(data.location)}<br>`;
                        whoisMessage += `${escapeHtml(targetName)} has sent ${data.message_count} messages<br>`;
                        if (data.profile) {
                            whoisMessage += `Says, ${escapeHtml(targetName)},<br>${escapeHtml(data.profile)}`;
                        }
                        addMessageToChat(whoisMessage, 'system-message');
                    })
                    .catch(error => {
                        addMessageToChat(`Could not retrieve info for ${escapeHtml(targetName)}. ${error.message}`, 'error-message');
                    });
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
        case 'summon':
            if (args.toLowerCase().startsWith('exie')) {
                handleSummonExie(args.slice(4).trim());
            } else {
                addMessageToChat('Usage: /summon exie [key=key_here]', 'system-message');
            }
            break;
        default:
            addMessageToChat(`Unknown local command: /${command}.`, 'system-message');
            break;
    }
}

async function handleSummonExie(args) {
    let key = '';
    const match = args.match(/key=(.+)/i);
    if (match) {
        key = match[1].trim();
    } else if (args) {
        key = args.trim();
    }

    const savedSettings = JSON.parse(localStorage.getItem(APP_STORAGE_KEY) || '{}');
    if (!key && savedSettings.exieKey) {
        key = savedSettings.exieKey;
    }

    if (!key) {
        addMessageToChat('Exie service key required. Usage: /summon exie key=key_here', 'error-message');
        return;
    }

    // Save key for next time
    savedSettings.exieKey = key;
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(savedSettings));

    const sessionId = getSessionId();
    if (!sessionId) {
        addMessageToChat('Cannot summon Exie. No active session.', 'error-message');
        return;
    }

    addMessageToChat('🤖 Summoning Exie...', 'system-message');

    try {
        const EXIE_ACTIVATE_URL = 'https://prototype.gameship.online/exiebot/activate';
        const response = await fetch(EXIE_ACTIVATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                services_key: key,
                convo_key: sessionId,
                is_vsms: true // Flag to tell Exie to use VSMS protocol
            }),
        });

        if (response.ok) {
            addMessageToChat('✅ Exie has been summoned to this session!', 'system-message');
        } else {
            let errorMsg = 'Unknown error';
            try {
                // Try to get text if json fails
                const text = await response.text();
                try {
                    const data = JSON.parse(text);
                    errorMsg = data.message || data.error || response.statusText;
                } catch (e) {
                    errorMsg = text || response.statusText;
                }
            } catch (e) {
                errorMsg = response.statusText;
            }
            addMessageToChat(`❌ Summoning failed: ${errorMsg}`, 'error-message');
        }
    } catch (error) {
        addMessageToChat(`❌ Network error summoning Exie: ${error.message}`, 'error-message');
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
    if (state.userName.startsWith('guest')) {
        addMessageToChat('You must change your /name from "guest" to send an IM.', 'error-message');
        return;
    }
    const messageId = `im-${Date.now()}-${Math.random()}`;

    // Auto-encrypt at the level most recently used with /enc
    // (state.encLevel, remembered like the nickname). No stored
    // level, or a stored 0, means plain, exactly as before.
    // An encrypted IM goes out with the ENC: marker and the
    // receiver shows it green; the sender still sees their own
    // text.
    let imMessage;
    if (state.encLevel) {
        const cipher = encEncrypt(message, state.encLevel);
        imMessage = `IM|${state.userName}|${recipient}|ENC:${state.encLevel}:${cipher}|${messageId}`;
    } else {
        imMessage = `IM|${state.userName}|${recipient}|${message}|${messageId}`;
    }
    serverApi.sendWsMessage(imMessage); // ← Send as plain string, not JSON

    const messageHtml = `<span id="${messageId}"><b>IM-&gt;${escapeHtml(recipient)}</b> ${escapeHtml(message)}</span>`;
    addMessageToChat(messageHtml, 'private-message', true);
}

// ---- Peer-to-peer image sending (/send) ----
// Text never goes peer. Only images (later: voice, video).
// The server only relays PEER signaling; the file itself travels over a
// WebRTC data channel directly between the two browsers.

const PEER_CHUNK_SIZE = 16384; // 16 KB per data-channel message
const PEER_ACCEPT_TIMEOUT_MS = 80000; // 80 seconds to accept

const peerState = {
    outgoing: {}, // keyed by recipient nickname (lowercase)
    incoming: {}, // keyed by sender nickname (lowercase)
    fileInput: null,
    pendingRecipient: null
};

// Base64url (no padding). Payloads are encoded so they never contain '|',
// which would break the pipe-delimited PEER message on the wire.
function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return decodeURIComponent(escape(atob(b64)));
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function closePeerConnection(entry) {
    try { if (entry.dc) entry.dc.close(); } catch (e) {}
    try { if (entry.pc) entry.pc.close(); } catch (e) {}
}

function cleanupPeerOutgoing(key) {
    const out = peerState.outgoing[key];
    if (!out) return;
    closePeerConnection(out);
    delete peerState.outgoing[key];
}

function cleanupPeerIncoming(key) {
    const entry = peerState.incoming[key];
    if (!entry) return;
    closePeerConnection(entry);
    delete peerState.incoming[key];
}

function updatePeerStatus(out, text) {
    if (out.statusId) {
        const span = document.getElementById(out.statusId);
        if (span) span.textContent = text;
    }
}

function handleSendCommand(recipient, thing) {
    if (state.userName.startsWith('guest')) {
        addMessageToChat('You must change your /name from "guest" to send an image.', 'error-message');
        return;
    }
    const type = (thing || '').trim().toLowerCase();
    if (type !== 'i' && type !== 'img' && type !== 'image') {
        addMessageToChat('Usage: /send recipient, image  (recipient or "all" for the room; only images for now — use i, img or image)', 'system-message');
        return;
    }
    if (!recipient) {
        addMessageToChat('Usage: /send recipient, image  (or "all" for the whole room)', 'system-message');
        return;
    }
    if (recipient.toLowerCase() === 'all') {
        const others = state.onlineUsers.filter(u => u.toLowerCase() !== state.userName.toLowerCase());
        if (others.length === 0) {
            addMessageToChat('You are alone — nobody else is in the room.', 'system-message');
            return;
        }
    }
    openPeerFilePicker(recipient);
}

function openPeerFilePicker(recipient) {
    if (!peerState.fileInput) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        peerState.fileInput = input;
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            const target = peerState.pendingRecipient;
            input.value = '';
            peerState.pendingRecipient = null;
            if (file && target) {
                if (target.toLowerCase() === 'all') {
                    startRoomFileRequest(file);
                } else {
                    startPeerFileRequest(target, file);
                }
            }
        });
    }
    peerState.pendingRecipient = recipient;
    peerState.fileInput.click();
}

function getImageDimensions(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve({ width: 0, height: 0 });
        };
        img.src = url;
    });
}

// Room send: one image to every other person in the session, peer to each.
// Each recipient gets their own accept/decline prompt and their own
// transfer, exactly like a one-to-one /send — one decline or failure
// never stops the others.
async function startRoomFileRequest(file) {
    const others = state.onlineUsers.filter(u => u.toLowerCase() !== state.userName.toLowerCase());
    if (others.length === 0) {
        addMessageToChat('You are alone — nobody else is in the room.', 'system-message');
        return;
    }
    addMessageToChat(`Sending image to the room (${others.length} ${others.length === 1 ? 'person' : 'people'}): ${escapeHtml(file.name)}`, 'system-message');
    for (const nick of others) {
        await startPeerFileRequest(nick, file);
    }
}

async function startPeerFileRequest(recipient, file) {
    const key = recipient.toLowerCase();
    if (peerState.outgoing[key]) {
        addMessageToChat(`Already sending an image to ${escapeHtml(recipient)}. Wait for it to finish or cancel it first.`, 'error-message');
        return;
    }
    const out = {
        file: file,
        meta: null,
        recipient: recipient,
        status: 'waiting',
        statusId: `peer-send-${Date.now()}`,
        statusP: null,
        pc: null,
        dc: null,
        pendingIce: []
    };
    peerState.outgoing[key] = out;
    const dims = await getImageDimensions(file);
    out.meta = {
        name: file.name,
        size: file.size,
        type: file.type || 'image/*',
        width: dims.width,
        height: dims.height
    };
    const payload = b64urlEncode(JSON.stringify(out.meta));
    serverApi.sendWsMessage(`PEER|${state.userName}|${recipient}|file|${payload}`);
    const statusP = addMessageToChat(`<span id="${out.statusId}">Waiting for ${escapeHtml(recipient)} to accept your image (${escapeHtml(file.name)}, ${formatFileSize(file.size)})…</span>`, 'system-message');
    out.statusP = statusP;
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
        cancelBtn.disabled = true;
        serverApi.sendWsMessage(`PEER|${state.userName}|${recipient}|bye|`);
        updatePeerStatus(out, `Cancelled sending to ${recipient}.`);
        cleanupPeerOutgoing(key);
    });
    statusP.appendChild(document.createTextNode(' '));
    statusP.appendChild(cancelBtn);
}

function handlePeerFileRequest(sender, payload) {
    let meta;
    try {
        meta = JSON.parse(b64urlDecode(payload));
    } catch (e) {
        console.error('Bad PEER file payload:', e);
        return;
    }
    const key = sender.toLowerCase();
    if (peerState.incoming[key]) return; // already a pending request from this sender
    const dims = (meta.width && meta.height) ? ` (${meta.width}×${meta.height})` : '';
    const info = `${escapeHtml(meta.name)} — ${formatFileSize(meta.size)}${dims}`;
    const p = document.createElement('p');
    p.className = 'system-message';
    p.innerHTML = `<b>${escapeHtml(sender)}</b> wants to send an image: ${info}<br><span class="peer-timer"></span> `;
    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'I Accept';
    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'I Reject';
    p.appendChild(acceptBtn);
    p.appendChild(document.createTextNode(' '));
    p.appendChild(rejectBtn);
    chatOutput.appendChild(p);
    scrollToBottom();

    const entry = {
        meta: meta,
        sender: sender,
        status: 'waiting',
        promptEl: p,
        acceptBtn: acceptBtn,
        rejectBtn: rejectBtn,
        timer: null,
        pc: null,
        dc: null,
        chunks: [],
        receivedSize: 0,
        finished: false,
        pendingIce: []
    };
    peerState.incoming[key] = entry;

    let secondsLeft = Math.round(PEER_ACCEPT_TIMEOUT_MS / 1000);
    const timerSpan = p.querySelector('.peer-timer');
    const updateTimer = () => { if (timerSpan) timerSpan.textContent = `(${secondsLeft}s to decide)`; };
    updateTimer();
    entry.timer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
            expirePeerRequest(sender);
        } else {
            updateTimer();
        }
    }, 1000);

    acceptBtn.addEventListener('click', () => { acceptPeerFile(sender); });
    rejectBtn.addEventListener('click', () => { declinePeerFile(sender); });
}

function settlePeerPrompt(key, note) {
    const entry = peerState.incoming[key];
    if (!entry) return;
    if (entry.timer) {
        clearInterval(entry.timer);
        entry.timer = null;
    }
    entry.acceptBtn.disabled = true;
    entry.rejectBtn.disabled = true;
    const timerSpan = entry.promptEl.querySelector('.peer-timer');
    if (timerSpan) timerSpan.textContent = note || '';
}

function acceptPeerFile(sender) {
    const key = sender.toLowerCase();
    const entry = peerState.incoming[key];
    if (!entry) return;
    settlePeerPrompt(key, '(accepted — waiting for the image…)');
    serverApi.sendWsMessage(`PEER|${state.userName}|${sender}|accept|`);
    entry.status = 'accepted';
}

function declinePeerFile(sender) {
    const key = sender.toLowerCase();
    const entry = peerState.incoming[key];
    if (!entry) return;
    settlePeerPrompt(key, '(declined)');
    serverApi.sendWsMessage(`PEER|${state.userName}|${sender}|decline|`);
    cleanupPeerIncoming(key);
}

function expirePeerRequest(sender) {
    const key = sender.toLowerCase();
    const entry = peerState.incoming[key];
    if (!entry) return;
    settlePeerPrompt(key, '(no answer — expired)');
    serverApi.sendWsMessage(`PEER|${state.userName}|${sender}|decline|`);
    cleanupPeerIncoming(key);
}

async function handlePeerAccept(recipient) {
    const key = recipient.toLowerCase();
    const out = peerState.outgoing[key];
    if (!out || !out.file || !out.meta || out.status !== 'waiting') return;
    out.status = 'offered';
    // No STUN server in the config for the first test. If direct P2P fails
    // behind NAT, change this one line to:
    //   const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    out.pc = pc;
    const dc = pc.createDataChannel('file');
    out.dc = dc;
    dc.binaryType = 'arraybuffer';
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const payload = b64urlEncode(JSON.stringify(event.candidate.toJSON()));
            serverApi.sendWsMessage(`PEER|${state.userName}|${recipient}|ice|${payload}`);
        }
    };
    // Diagnostic: show the ICE connection state while connecting. Only
    // while this transfer is still offered and the channel is not open
    // yet, so this never clobbers the send progress or the "sent" line.
    pc.oniceconnectionstatechange = () => {
        if (peerState.outgoing[key] === out && out.status === 'offered' && dc.readyState !== 'open') {
            updatePeerStatus(out, `Connecting to ${recipient}… (ICE: ${pc.iceConnectionState})`);
        }
    };
    dc.onopen = () => { sendPeerFileChunks(out, key); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    serverApi.sendWsMessage(`PEER|${state.userName}|${recipient}|offer|${b64urlEncode(offer.sdp)}`);
    updatePeerStatus(out, `Sending image to ${recipient}…`);
}

async function handlePeerOffer(sender, payload) {
    const key = sender.toLowerCase();
    const entry = peerState.incoming[key];
    if (!entry || entry.status !== 'accepted') return;
    entry.status = 'offered';
    let sdp;
    try {
        sdp = b64urlDecode(payload);
    } catch (e) {
        console.error('Bad PEER offer payload:', e);
        return;
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    entry.pc = pc;
    // Diagnostic: show the ICE connection state while connecting. Only
    // while this entry is still live and offered and the channel is not
    // open yet, so this never clobbers the receive progress.
    pc.oniceconnectionstatechange = () => {
        if (peerState.incoming[key] === entry && entry.status === 'offered' && (!entry.dc || entry.dc.readyState !== 'open')) {
            const timerSpan = entry.promptEl.querySelector('.peer-timer');
            if (timerSpan) timerSpan.textContent = `(connecting… ICE: ${pc.iceConnectionState})`;
        }
    };
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const icePayload = b64urlEncode(JSON.stringify(event.candidate.toJSON()));
            serverApi.sendWsMessage(`PEER|${state.userName}|${sender}|ice|${icePayload}`);
        }
    };
    pc.ondatachannel = (event) => {
        const dc = event.channel;
        entry.dc = dc;
        dc.binaryType = 'arraybuffer';
        dc.onmessage = (msgEvent) => { onPeerFileData(entry, msgEvent.data); };
        dc.onclose = () => {
            const e = peerState.incoming[key];
            if (e && !e.finished) {
                settlePeerPrompt(key, '(connection closed)');
                cleanupPeerIncoming(key);
            }
        };
    };
    try {
        await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await flushPeerIce(entry);
        serverApi.sendWsMessage(`PEER|${state.userName}|${sender}|answer|${b64urlEncode(answer.sdp)}`);
    } catch (e) {
        console.error('PEER offer failed:', e);
        settlePeerPrompt(key, '(connection failed)');
        cleanupPeerIncoming(key);
    }
}

async function handlePeerAnswer(recipient, payload) {
    const key = recipient.toLowerCase();
    const out = peerState.outgoing[key];
    if (!out || !out.pc) return;
    let sdp;
    try {
        sdp = b64urlDecode(payload);
    } catch (e) {
        console.error('Bad PEER answer payload:', e);
        return;
    }
    try {
        await out.pc.setRemoteDescription({ type: 'answer', sdp: sdp });
        await flushPeerIce(out);
    } catch (e) {
        console.error('PEER answer failed:', e);
    }
}

async function handlePeerIce(sender, payload) {
    const key = sender.toLowerCase();
    const entry = peerState.incoming[key] || peerState.outgoing[key];
    if (!entry) return;
    let candidate;
    try {
        candidate = JSON.parse(b64urlDecode(payload));
    } catch (e) {
        console.error('Bad PEER ice payload:', e);
        return;
    }
    await addPeerIceCandidate(entry, candidate);
}

async function addPeerIceCandidate(entry, candidate) {
    if (!entry.pc || !entry.pc.remoteDescription) {
        // Remote description not set yet (or no connection yet): hold the
        // candidate until it is, then flushPeerIce adds it.
        entry.pendingIce.push(candidate);
        return;
    }
    try {
        await entry.pc.addIceCandidate(candidate);
    } catch (e) {
        console.error('addIceCandidate failed:', e);
    }
}

async function flushPeerIce(entry) {
    const queued = entry.pendingIce || [];
    entry.pendingIce = [];
    for (const candidate of queued) {
        try {
            await entry.pc.addIceCandidate(candidate);
        } catch (e) {
            console.error('addIceCandidate failed:', e);
        }
    }
}

function handlePeerDecline(sender) {
    const key = sender.toLowerCase();
    const out = peerState.outgoing[key];
    if (!out) return;
    updatePeerStatus(out, `${sender} declined your image.`);
    cleanupPeerOutgoing(key);
}

function handlePeerBye(sender) {
    const key = sender.toLowerCase();
    if (peerState.incoming[key]) {
        settlePeerPrompt(key, '(ended)');
        cleanupPeerIncoming(key);
    }
    if (peerState.outgoing[key]) {
        const out = peerState.outgoing[key];
        updatePeerStatus(out, `Peer connection to ${sender} ended.`);
        cleanupPeerOutgoing(key);
    }
}

function sendPeerFileChunks(out, key) {
    const file = out.file;
    let offset = 0;
    const dc = out.dc;
    const sendNext = () => {
        if (dc.readyState !== 'open') return;
        if (dc.bufferedAmount > 256 * 1024) {
            setTimeout(sendNext, 50);
            return;
        }
        if (offset >= file.size) {
            dc.send('DONE');
            completePeerSend(out, key);
            return;
        }
        const slice = file.slice(offset, offset + PEER_CHUNK_SIZE);
        slice.arrayBuffer().then((buf) => {
            if (dc.readyState !== 'open') return;
            dc.send(buf);
            offset += buf.byteLength;
            updatePeerStatus(out, `Sending image to ${out.recipient}… ${Math.round(offset / file.size * 100)}% (${formatFileSize(offset)} of ${formatFileSize(file.size)})`);
            sendNext();
        }).catch((e) => {
            console.error('Peer file slice failed:', e);
            updatePeerStatus(out, `Failed sending image to ${out.recipient}.`);
            cleanupPeerOutgoing(key);
        });
    };
    sendNext();
}

function completePeerSend(out, key) {
    out.status = 'sent';
    const url = URL.createObjectURL(out.file);
    if (out.statusP) {
        renderPeerImage(out.statusP, state.userName, out.meta, url);
    } else {
        updatePeerStatus(out, `Image sent to ${out.recipient}.`);
    }
    // Give the receiver a beat to process DONE, then close.
    setTimeout(() => {
        closePeerConnection(out);
        if (peerState.outgoing[key] === out) delete peerState.outgoing[key];
    }, 1000);
}

function onPeerFileData(entry, data) {
    if (typeof data === 'string') {
        if (data === 'DONE') {
            finishPeerFile(entry);
        }
        return;
    }
    entry.chunks.push(data);
    entry.receivedSize += (typeof data.byteLength === 'number' ? data.byteLength : (data.size || 0));
    // scp-style progress on the receiver's prompt status line. Text only —
    // do not touch the buttons or the entry state.
    const total = entry.meta && entry.meta.size ? entry.meta.size : 0;
    if (total > 0) {
        const pct = Math.round(entry.receivedSize / total * 100);
        const timerSpan = entry.promptEl.querySelector('.peer-timer');
        if (timerSpan) timerSpan.textContent = `Receiving image from ${entry.sender}… ${pct}% (${formatFileSize(entry.receivedSize)} of ${formatFileSize(total)})`;
    }
}

function finishPeerFile(entry) {
    entry.finished = true;
    const blob = new Blob(entry.chunks, { type: entry.meta.type || 'image/*' });
    const url = URL.createObjectURL(blob);
    renderPeerImage(entry.promptEl, entry.sender, entry.meta, url);
    const key = entry.sender.toLowerCase();
    closePeerConnection(entry);
    delete peerState.incoming[key];
}

function renderPeerImage(p, senderName, meta, url) {
    p.innerHTML = '';
    p.className = 'user-message';
    const caption = document.createElement('div');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = senderName + ':';
    caption.appendChild(nameSpan);
    caption.appendChild(document.createTextNode(' '));
    const fileSpan = document.createElement('span');
    fileSpan.className = 'message-content';
    fileSpan.textContent = meta.name;
    caption.appendChild(fileSpan);
    caption.appendChild(document.createTextNode(' '));
    const saveLink = document.createElement('a');
    saveLink.href = url;
    saveLink.download = meta.name;
    saveLink.textContent = 'Save image';
    saveLink.target = '_blank';
    caption.appendChild(saveLink);
    const img = document.createElement('img');
    img.src = url;
    img.alt = meta.name;
    img.style.maxWidth = '100%';
    p.appendChild(caption);
    p.appendChild(img);
    scrollToBottom();
}

function handlePeerMessage(parts) {
    // parts: PEER|SENDER|RECIPIENT|KIND|PAYLOAD...
    const sender = parts[1] || '';
    const kind = parts[3] || '';
    const payload = parts.slice(4).join('|');
    switch (kind) {
        case 'file':
            handlePeerFileRequest(sender, payload);
            break;
        case 'accept':
            handlePeerAccept(sender);
            break;
        case 'decline':
            handlePeerDecline(sender);
            break;
        case 'offer':
            handlePeerOffer(sender, payload);
            break;
        case 'answer':
            handlePeerAnswer(sender, payload);
            break;
        case 'ice':
            handlePeerIce(sender, payload);
            break;
        case 'bye':
            handlePeerBye(sender);
            break;
        default:
            console.log('Unknown PEER kind:', kind);
            break;
    }
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

// Parse a mail recipient, which may carry a hex type in parens:
// "cc" -> plain mail, "cc(x)" -> hex, "cc(rx)" -> reverse-then-hex,
// "cc(xx)" -> double hex, "cc(xr)" -> hex-then-reverse, "cc()" -> xr.
// The type is case insensitive and spaces inside the parens are
// ignored. Returns {name, flag, type}, or {error} for an unknown
// type. Only a trailing "(...)" counts as a type suffix; anything
// else is the nickname as-is.
function parseMailRecipient(recipient) {
    const r = String(recipient).trim();
    const open = r.lastIndexOf('(');
    if (open < 0) {
        // No parens at all: mail defaults to xx hex, so no
        // unencrypted mail ever goes out unless the sender opts
        // out with (-).
        return {name: r, flag: 'xx', type: 'enc2'};
    }
    // A paren that isn't a closed type suffix at the end (an
    // unclosed "cc(x", or nothing before the paren) is an error.
    if (!r.endsWith(')') || open === 0) {
        return {error: 'Try again? Unclosed enc type.'};
    }
    const name = r.slice(0, open).trim();
    const type = r.slice(open + 1, -1).trim().toLowerCase();
    // Only (-) sends plain mail (empty flag), and the sender is
    // warned after it goes out. Everything else that isn't a
    // known type (empty parens, a typo) defaults to xx.
    if (type === '-') {
        return {name: name, flag: '', type: null, warn: true};
    }
    const byType = {
        'x': {flag: 'x', type: 'enc'},
        'rx': {flag: 'rx', type: 'encr'},
        'xx': {flag: 'xx', type: 'enc2'},
        'xr': {flag: 'xr', type: 'encr2'}
    };
    const hit = byType[type] || {flag: 'xx', type: 'enc2'};
    return {name: name, flag: hit.flag, type: hit.type};
}

function handleMessageCommand(recipient, message) {
    if (state.userName.startsWith('guest')) {
        addMessageToChat('You must change your /name from "guest" to send mail.', 'error-message');
        return;
    }
    const parsed = parseMailRecipient(recipient);
    if (parsed.error) {
        addMessageToChat(parsed.error, 'error-message');
        return;
    }
    let outMessage = message;
    if (parsed.flag !== '') {
        outMessage = encryption[parsed.type](message);
    }
    const mailMessage = `MAIL|${state.userName}|${parsed.name}|${outMessage}|${parsed.flag}|U`;
    serverApi.sendWsMessage(mailMessage);
    if (parsed.warn) {
        addMessageToChat('You just sent an unencoded email. This is *not* recommended.', 'error-message');
    }
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

function convertFromHex(hex) {
    if (!hex) return '';
    let text = '';
    for (let i = 0; i < hex.length; i += 2) {
        const byte = parseInt(hex.substr(i, 2), 16);
        text += String.fromCharCode(byte);
    }
    return text;
}

const decryption = {
    x: (text) => convertFromHex(text),
    rx: (text) => convertFromHex(text).split('').reverse().join(''),
    xx: (text) => convertFromHex(convertFromHex(text)),
    xr: (text) => convertFromHex(text.split('').reverse().join(''))
};

// ---- /enc /encrypt: session-id XOR cipher, sent as an IM ----
// This replaces the old hex/MAIL /enc for /enc and /encrypt. The old
// hex-mail commands (encr, enc2, encr2, ...) are gone; their types
// now ride on /mail and @ as a paren suffix on the recipient, e.g.
// /mail cc(xr), hello. The MAIL decryption above is left alone, so
// mail encrypted the old way still reads.
// Cipher (must match the Go rt client exactly):
//   key string = level + ":" + session id reversed. The level goes
//   first so it matters even for a short message; the reversed
//   session id is the salt. Both sides know the session id, so the
//   key never travels in the message; only the level does, inside
//   the "ENC:<level>:<base64>" text of an otherwise normal IM,
//   which the server just pipes. Level 0 = no encryption (plain).
function encToBinaryLevel(n) {
    if (!Number.isFinite(n) || n <= 0) return 0;
    let p = 1;
    while (p * 2 <= n) p *= 2;
    if (p > 512) p = 512;
    return p;
}

// Parse the level field of an /enc command. Returns the level, or
// null if the field is neither a named level nor a number (in which
// case the field is the message). Case insensitive.
function encParseLevel(field) {
    const f = String(field).trim().toLowerCase();
    switch (f) {
        case 'lo': case 'low': return 32;
        case 'med': case 'medium': return 128;
        case 'hi': case 'high': return 256;
        case 'default': case 'd': case 'def': return 64;
        default: break;
    }
    if (/^\d+$/.test(f)) {
        return encToBinaryLevel(parseInt(f, 10));
    }
    return null;
}

function encKeyBytes(level) {
    const sid = getSessionId() || '';
    const rev = sid.split('').reverse().join('');
    // Level FIRST, then the reversed session id as the salt, so the
    // level matters even for a short message.
    return new TextEncoder().encode(String(level) + ':' + rev);
}

function encBytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encBase64UrlToBytes(s) {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function encEncrypt(plain, level) {
    const key = encKeyBytes(level);
    const data = new TextEncoder().encode(plain);
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
    return encBytesToBase64Url(out);
}

// Returns the plaintext string, or null if the payload will not decode.
function encDecrypt(cipherB64, level) {
    try {
        const raw = encBase64UrlToBytes(cipherB64);
        const key = encKeyBytes(level);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ key[i % key.length];
        return new TextDecoder().decode(out);
    } catch (e) {
        return null;
    }
}

// Green for a decrypted /enc message: dark green in day mode, normal
// green in night mode.
function encGreen() {
    return state.theme === 'dark' ? '#00ff00' : '#006400';
}

// /enc <recipient>, [level,] <message>. The tail is "message" or
// "level, message". Level 0 sends this one plain and turns
// auto-encryption off; any other level encrypts, sends as an IM with
// the ENC: marker, and remembers the level for a later auto-encrypting
// /im. The sender sees their own message as plaintext, like a normal
// sent IM.
function handleEncCommand(recipient, tail) {
    if (state.userName.startsWith('guest')) {
        addMessageToChat('You must change your /name from "guest" to send an encrypted message.', 'error-message');
        return;
    }
    let level = 64;
    let message = tail.trim();
    const comma = message.indexOf(',');
    if (comma >= 0) {
        const maybeLevel = encParseLevel(message.slice(0, comma));
        if (maybeLevel !== null) {
            level = maybeLevel;
            message = message.slice(comma + 1).trim();
        }
    }
    if (!message) {
        addMessageToChat('Usage: /enc recipient, [level,] message', 'system-message');
        return;
    }
    state.encLevel = level;
    try { localStorage.setItem(ENC_LEVEL_KEY, String(level)); } catch (e) {}
    const messageId = `im-${Date.now()}-${Math.random()}`;
    if (level === 0) {
        const imMessage = `IM|${state.userName}|${recipient}|${message}|${messageId}`;
        serverApi.sendWsMessage(imMessage);
    } else {
        const cipher = encEncrypt(message, level);
        const imMessage = `IM|${state.userName}|${recipient}|ENC:${level}:${cipher}|${messageId}`;
        serverApi.sendWsMessage(imMessage);
    }
    const messageHtml = `<span id="${messageId}"><b>IM-&gt;${escapeHtml(recipient)}</b> ${escapeHtml(message)}</span>`;
    addMessageToChat(messageHtml, 'private-message', true);
}

function showHelp() {
    addMessageToChat(`Available commands:
        <br>/name [new_name] - Change your nickname (leave empty for random).
        <br>/profile [bio] - Set your profile bio (leave empty to view).
        <br>/whoami - Display your current user info.
        <br>/whois [nickname] - Look up a user's info.
        <br>/alone - Check who is currently in the session.
        <br>/me [action] - Roleplay emote (/emote, /em, or : also work).
        <br>/im [recipient], [message] - Send an instant message to an online user (! also works). Auto-encrypts at your last /enc level; plain if none or 0.
        <br>/enc [recipient], [level,] [message] - Send an encrypted instant message (/encrypt also works). Levels: lo 32, med 128, hi 256, default 64; a number rounds down to a power of two (max 512); 0 turns auto-encryption off. The receiver sees it as an IM, in green.
        <br>/send [recipient], image - Send an image to an online user, peer to peer (/s, &gt; also work). Use "all" as the recipient to send to the whole room.
        <br>/mail [recipient], [message] - Send mail to a user (/msg, /message, @ also work). Mail defaults to xx double hex; (x) hex, (rx) reverse-then-hex, (xr) hex-then-reverse pick a type, () or any unknown type is xx. Only (-) sends plain, and it warns you. Example: /mail cc, hello
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
    const prefixedMessage = `MSG|${state.userName}|${message}`;
    serverApi.sendWsMessage(prefixedMessage);
}

function handleEmote(action) {
    const emoteMessage = `EMOTE|${state.userName}|${action}`;
    serverApi.sendWsMessage(emoteMessage);
}

function handleArt(artContent) {
    const artMessage = `ART|${state.userName}|${artContent}`;
    serverApi.sendWsMessage(artMessage);
    artWidget.classList.add('hidden');
}
window.sendArt = handleArt;

function handleParagraphArt(content) {
    const processedContent = content.replace(/\n/g, '¶');
    const partMessage = `PART|${state.userName}|${processedContent}`;
    serverApi.sendWsMessage(partMessage);
    pArtWidget.classList.add('hidden');
    pArtTextarea.value = '';
}

function handleBroadcastCommand(command, args) {
    let content = '';
    switch (command) {
        case 'roll':
            const sides = args ? parseInt(args) : 6;
            if (isNaN(sides) || sides < 2) return;
            const result = Math.floor(Math.random() * sides) + 1;
            content = `d${sides} ${result}`;
            break;
        case 'flip':
            content = Math.random() < 0.5 ? 'Heads' : 'Tails';
            break;
        default:
            return;
    }
    const prefixedMessage = `${command.toUpperCase()}|${state.userName}|${content}`;
    serverApi.sendWsMessage(prefixedMessage);
}

const LOCAL_COMMANDS = [
    'name', 'nick', 'nightmode', 'darkmode', 'hercules', 'retroled', 'crt',
    'time', '12', '24', 'whoami', 'profile', 'whois', '8ball', 'fortune',
    'uptime', 'version', 'about', 'help', 'review', 'clear', 'home', 'invite', 'i',
    'alone', 'summon'
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
        if (Array.isArray(history)) {
            const filteredHistory = history.filter(item => !item.message.startsWith('MAIL|'));
            if (filteredHistory.length > 0) {
                addMessageToChat('--- Start of History ---', 'system-message');
                filteredHistory.forEach(displayBroadcastMessage);
                addMessageToChat('--- End of History ---', 'system-message');
            } else {
                addMessageToChat(`No messages in the last ${minutes} minute(s).`, 'system-message');
            }
        } else {
            // Handle cases where the API might not return an array (e.g., null or error object)
            addMessageToChat(`No messages in the last ${minutes} minute(s).`, 'system-message');
        }
    } catch (error) {
        addMessageToChat(`Error fetching history: ${error.message}`, 'error-message');
    }
}

async function handleArchiveCommand() {
    addMessageToChat(`Fetching full message archive...`, 'system-message');
    try {
        const history = await serverApi.getArchive(getSessionId());
        if (Array.isArray(history)) {
            const filteredHistory = history.filter(item => !item.message.startsWith('MAIL|'));
            if (filteredHistory.length > 0) {
                addMessageToChat('--- Start of Archive ---', 'system-message');
                filteredHistory.forEach(displayBroadcastMessage);
                addMessageToChat('--- End of Archive ---', 'system-message');
            } else {
                addMessageToChat('The archive is empty.', 'system-message');
            }
        } else {
            addMessageToChat('The archive is empty.', 'system-message');
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
            } else if (isReservedNickname(newName)) {
                addMessageToChat('That nickname is reserved. Pick another one.', 'error-message');
            } else {
                state.baseUserName = newName;
                const nickMessage = `NICK|${state.userName}|${newName}`;
                serverApi.sendWsMessage(nickMessage);
                // Note: state.userName will be updated via NICK_UPDATE from server
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

    if (input.startsWith('>')) {
        const content = input.slice(1).trim();
        const match = content.match(/^(.+?),(.+)$/s); // Use comma as delimiter

        if (match) {
            const recipient = match[1].trim();
            const thing = match[2].trim();
            handleSendCommand(recipient, thing);
        } else {
            addMessageToChat('Usage: > recipient, image  (or "all" for the whole room)', 'system-message');
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
        } else if (command === 'send' || command === 's') {
            const match = args.match(/^(.+?),(.+)$/s); // Use comma as delimiter
            if (match) {
                const recipient = match[1].trim();
                const thing = match[2].trim();
                handleSendCommand(recipient, thing);
            } else {
                addMessageToChat('Usage: /send recipient, image  (or "all" for the whole room)', 'system-message');
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
            if (state.userName.startsWith('guest')) {
                addMessageToChat('You must change your /name from "guest" to use mail.', 'error-message');
                return;
            }
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
        } else if (command === 'enc' || command === 'encrypt') {
            // New /enc: session-id XOR cipher sent as an IM. The level
            // is optional (default 64); the tail after the recipient
            // is "level, message" or just "message".
            const match = args.match(/^(.+?),(.+)$/s);
            if (match) {
                const recipient = match[1].trim();
                const tail = match[2].trim();
                handleEncCommand(recipient, tail);
            } else {
                addMessageToChat('Usage: /enc recipient, [level,] message', 'system-message');
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
                const killMessage = `KILL9|${state.userName}`;
                serverApi.sendWsMessage(killMessage);
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
                window.location.href = `${window.location.origin}/auth/`;
            }, 2000);
        }
    }, 5000);
}

function extractMood(text) {
    let mood = '';
    const lines = text.split('\n');
    const kept = [];
    const moods = ['thoughtful', 'warm', 'playful', 'intense'];

    for (const line of lines) {
        const m = line.trim().match(/^MOOD:\s*(\w+)$/i);
        if (m) {
            const candidate = m[1].toLowerCase();
            if (moods.includes(candidate)) {
                mood = candidate;
            } else {
                kept.push(line);
            }
        } else {
            kept.push(line);
        }
    }
    return { cleanText: kept.join('\n').trim(), mood };
}

function displayBroadcastMessage(data) {
    console.log('Displaying broadcast message:', data);
    const { message } = data;
    const parts = message.split('|');
    const type = parts[0];

    if (type === 'STORE_SUCCESS') {
        const recipient = escapeHtml(parts[1]);
        addMessageToChat(`Your message to ${recipient} has been sent.`, 'system-message');
        return;
    }

    if (type === 'STORE_FAILED') {
        const errorMessage = parts.slice(1).join('|');
        addMessageToChat(`! Server Error: Could not save message. Reason: ${escapeHtml(errorMessage)}`, 'error-message');
        return;
    }

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
        state.onlineUsers = parts[1] ? parts[1].split(',') : [];
        const escapedUsers = state.onlineUsers.map(u => escapeHtml(u));
        state.statusBox.online = escapedUsers;
        tryPrintStatusBox();
        renderRoomStatusBar();
        return;
    }

    if (type === 'NICK_UPDATE') {
        const rawOldNick = parts[1];
        const rawNewNick = parts[2];
        const oldNick = escapeHtml(rawOldNick);
        const newNick = escapeHtml(rawNewNick);

        if (state.userName.toLowerCase() === rawOldNick.toLowerCase()) {
            state.userName = rawNewNick;
            saveSettings();
            addMessageToChat(`You are now known as ${newNick}.`, 'system-message');
            checkForMail();
        } else {
            addMessageToChat(`* ${oldNick} is now known as ${newNick}.`, 'system-message');
        }

        const userIndex = state.onlineUsers.findIndex(u => u.toLowerCase() === rawOldNick.toLowerCase());
        if (userIndex !== -1) {
            state.onlineUsers[userIndex] = rawNewNick;
        }
        renderRoomStatusBar();
        return;
    }

    if (type === 'PONG') {
        // App-level PONG received from server
        return;
    }

    if (type === 'JOIN' || (type === 'PART' && parts.length === 2)) {
        const rawUser = parts[1];
        const user = escapeHtml(rawUser);
        if (type === 'JOIN') {
            if (!state.onlineUsers.find(u => u.toLowerCase() === rawUser.toLowerCase())) {
                state.onlineUsers.push(rawUser);
            }
            addMessageToChat(`* ${user} has joined.`, 'system-message');
        } else { // PART
            state.onlineUsers = state.onlineUsers.filter(u => u.toLowerCase() !== rawUser.toLowerCase());
            addMessageToChat(`* ${user} has left.`, 'system-message');
        }
        renderRoomStatusBar();
        return;
    }

    if (type === 'DELIVERY_FAILED') {
        const recipient = escapeHtml(parts[1]);
        const messageId = parts[parts.length - 1]; // The ID is now the last part

        const targetSpan = document.getElementById(messageId);

        if (targetSpan && !targetSpan.querySelector('.error-message')) {
            const errorSpan = document.createElement('span');
            errorSpan.className = 'error-message';
            errorSpan.textContent = ` [Can't send: ${recipient} is not available.]`;
            targetSpan.appendChild(errorSpan);
        } else if (!targetSpan) {
            const originalMessageContent = escapeHtml(parts.slice(2, parts.length - 1).join('|'));
            addMessageToChat(`! Your IM to ${recipient} ("${originalMessageContent}") failed to send.`, 'error-message');
        }
        return;
    }

    if (type === 'PEER') {
        handlePeerMessage(parts);
        return;
    }

    if (type === 'PEER_FAILED') {
        const peerRecipient = escapeHtml(parts[1]);
        const peerKind = parts[2] || '';
        const peerKey = (parts[1] || '').toLowerCase();
        addMessageToChat(`! Peer ${peerKind} to ${peerRecipient} failed: ${peerRecipient} is not available.`, 'error-message');
        const out = peerState.outgoing[peerKey];
        if (out) {
            updatePeerStatus(out, `Could not reach ${peerRecipient}.`);
            cleanupPeerOutgoing(peerKey);
        }
        return;
    }

    const { date, time } = getFormattedTimestamp(data.timestamp);
    const nickname = parts[1];
    const content = parts.slice(2).join('|');
    let html = '';
    let messageMood = '';

    switch (type) {
        case 'IM': // Incoming Instant Message
            const sender = nickname;
            const imParts = parts.slice(2);
            // parts: IM|SENDER|RECIPIENT|CONTENT|ID
            let imContent = parts[3] || '';

            // New /enc payload: "ENC:<level>:<base64url>". Decrypt it
            // with the session id and show it like a normal IM, but
            // green. A payload that will not decrypt is shown raw
            // rather than dropped.
            let isEnc = false;
            if (imContent.startsWith('ENC:')) {
                const encRest = imContent.slice(4);
                const colon = encRest.indexOf(':');
                if (colon > 0) {
                    const encLevel = parseInt(encRest.slice(0, colon), 10);
                    if (!Number.isNaN(encLevel)) {
                        const encPlain = encDecrypt(encRest.slice(colon + 1), encLevel);
                        if (encPlain !== null) {
                            imContent = encPlain;
                            isEnc = true;
                        }
                    }
                }
            }

            const imResult = extractMood(imContent);
            imContent = imResult.cleanText;
            messageMood = imResult.mood;

            if (isEnc) {
                const green = encGreen();
                html = `
                    <span class="timestamp">[${date}]</span>
                    <span style="color: ${green};">[IM from ${escapeHtml(sender)}]:</span>
                    <span class="message-content" style="color: ${green};">${parseMarkdown(imContent)}</span>
                    <span class="timestamp">[${time}]</span>
                `;
            } else {
                html = `
                    <span class="timestamp">[${date}]</span>
                    <span style="color: var(--accent-color-2);">[IM from ${escapeHtml(sender)}]:</span>
                    <span class="message-content">${parseMarkdown(imContent)}</span>
                    <span class="timestamp">[${time}]</span>
                `;
            }
            addMessageToChat(html, 'private-message', true, messageMood);
            return; // IMs are handled completely, so we return early.
        case 'MAIL':
            const mailSender = nickname;
            const mailRecipient = parts[2];

            if (mailRecipient.toLowerCase() !== state.userName.toLowerCase()) {
                return; // Not for us
            }

            // Format: MAIL|SENDER|RECIPIENT|...CONTENT...|ENC_FLAG|READ_STATUS
            const encryptionFlag = parts[parts.length - 2];
            let mailContent = parts.slice(3, parts.length - 2).join('|');

            const mailResult = extractMood(mailContent);
            mailContent = mailResult.cleanText;
            messageMood = mailResult.mood;

            if (decryption[encryptionFlag]) {
                mailContent = decryption[encryptionFlag](mailContent);
            }

            html = `
                <span class="timestamp">[${date}]</span>
                <span style="color: var(--accent-color);">[Mail from ${escapeHtml(mailSender)}]:</span>
                <span class="message-content">${parseMarkdown(mailContent)}</span>
                <span class="timestamp">[${time}]</span>
            `;
            addMessageToChat(html, 'private-message', true, messageMood);
            return;
        case 'MSG':
            let msgContent = parts.slice(2).join('|');
            const msgResult = extractMood(msgContent);
            msgContent = msgResult.cleanText;
            messageMood = msgResult.mood;

            const parsedMessage = parseMarkdown(msgContent);
            const emojiClass = isEmojiOnly(msgContent) ? ' big-emoji' : '';
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

    addMessageToChat(html, 'user-message', true, messageMood);
}

async function initializeApp() {
    loadSettings();
    renderRoomStatusBar();
    populateReactionWidget();
    addMessageToChat('Welcome to RetroTerm.', 'system-message');
    addMessageToChat('Connecting to server...', 'system-message');

    try {
        const isNewJoiner = await initializeSession(state.userName);
        // addMessageToChat(`Connected! You are known as ${escapeHtml(state.userName)}.`, 'system-message');

        const onOpenCallback = async () => {
            await handleHistoryCommand();
            if (isNewJoiner) {
                handleEmote("has joined.");
            }
        };

        const onRegistrationComplete = (finalNickname) => {
            state.userName = finalNickname;
            saveSettings();
            state.statusBox.knownAs = escapeHtml(finalNickname);
            tryPrintStatusBox();
        };

        connectWebSocket(() => state.userName, displayBroadcastMessage, onOpenCallback, onRegistrationComplete);

        // The WELCOME message from the WebSocket will provide the initial user list.
        addMessageToChat('Type /help for a list of commands.', 'system-message');
    } catch (error) {
        addMessageToChat(`Connection failed: ${error.message}`, 'error-message');
    }

    chatInput.focus();
}

window.addEventListener('load', initializeApp);








