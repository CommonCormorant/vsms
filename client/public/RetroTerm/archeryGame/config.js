// Game configuration and constants
const CONFIG = {
    GRAVITY: 0.1,
    PLAYER_SIZE: 20,
    
    ARROWS: {
        normal: { emoji: '➡️', name: 'Normal' },
        parachute: { emoji: '🪂', name: 'Parachute' },
        explosive: { emoji: '💣', name: 'Explosive' },
        bouncing: { emoji: '🔄', name: 'Bouncing' },
        guided: { emoji: '🎯', name: 'Guided' },
        speed: { emoji: '⚡', name: 'Speed' },
        windcutter: { emoji: '🌪️', name: 'Wind Cutter' },
        triple: { emoji: '🔱', name: 'Triple' },
        piercing: { emoji: '🗡️', name: 'Piercing' }
    },
    
    SHOP_ITEMS: [
        { type: 'parachute', price: 150, desc: 'Slows descent for precision' },
        { type: 'explosive', price: 300, desc: 'Massive blast radius' },
        { type: 'bouncing', price: 200, desc: 'Bounces off terrain' },
        { type: 'guided', price: 250, desc: 'Auto-corrects toward target' },
        { type: 'speed', price: 180, desc: '50% faster travel' },
        { type: 'windcutter', price: 220, desc: 'Immune to wind' },
        { type: 'triple', price: 350, desc: 'Fires 3 arrows' },
        { type: 'piercing', price: 280, desc: 'Goes through terrain' }
    ]
};

// Game state
const State = {
    mode: null, // 'ai' or 'local'
    status: 'ready', // 'ready', 'firing', 'hit'
    level: 1,
    current: 'blue',
    wind: { velocity: 0, direction: 1 },
    players: {
        blue: {
            x: 0,
            y: 0,
            gold: 17,
            isAI: false,
            arrows: {
                normal: Infinity,
                parachute: 0,
                explosive: 0,
                bouncing: 0,
                guided: 0,
                speed: 0,
                windcutter: 0,
                triple: 0,
                piercing: 0
            },
            currentArrow: 'normal'
        },
        red: {
            x: 0,
            y: 0,
            gold: 17,
            isAI: false,
            arrows: {
                normal: Infinity,
                parachute: 0,
                explosive: 0,
                bouncing: 0,
                guided: 0,
                speed: 0,
                windcutter: 0,
                triple: 0,
                piercing: 0
            },
            currentArrow: 'normal'
        }
    },
    arrows: [],
    aiThinkTimer: 0
};