// AI opponent logic
const AI = {
    thinkDelay: 60, // frames before AI shoots
    
    update: function() {
        if (State.status === 'ready' && State.players[State.current].isAI) {
            State.aiThinkTimer++;
            if (State.aiThinkTimer >= this.thinkDelay) {
                this.takeShot();
                State.aiThinkTimer = 0;
            }
        }
    },
    
    takeShot: function() {
        const aiPlayer = State.players[State.current];
        const opponentKey = State.current === 'blue' ? 'red' : 'blue';
        const opponent = State.players[opponentKey];
        
        // Calculate distance and direction
        const dx = opponent.x - aiPlayer.x;
        const dy = (opponent.y - CONFIG.PLAYER_SIZE * 1.5) - aiPlayer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Calculate base angle
        let angle = Math.atan2(-dy, Math.abs(dx)) * 180 / Math.PI;
        
        // Add some randomness based on difficulty (level)
        const accuracy = Math.min(0.95, 0.5 + State.level * 0.05);
        const randomness = (1 - accuracy) * 20;
        angle += (Math.random() - 0.5) * randomness;
        
        // Adjust for wind
        if (State.wind.velocity > 0) {
            const windAdjust = State.wind.velocity * State.wind.direction * 5;
            angle -= windAdjust;
        }
        
        // Convert angle based on side
        if (State.current === 'red') {
            angle = 180 - angle;
        }
        
        // Clamp angle
        angle = Math.max(0, Math.min(180, angle));
        
        // Calculate power based on distance
        let power = 40 + distance / 10;
        power += (Math.random() - 0.5) * randomness;
        power = Math.max(10, Math.min(100, power));
        
        // Choose arrow type strategically
        let arrowType = this.chooseArrowType(aiPlayer, distance);
        aiPlayer.currentArrow = arrowType;
        
        // Execute shot
        NetworkInterface.sendShot(State.current, angle, power, arrowType);
        Physics.executeShot(State.current, angle, power, arrowType);
    },
    
    chooseArrowType: function(player, distance) {
        const availableArrows = [];
        
        // Build list of available special arrows
        for (let type in player.arrows) {
            if (type !== 'normal' && player.arrows[type] > 0) {
                availableArrows.push(type);
            }
        }
        
        // No special arrows available
        if (availableArrows.length === 0) {
            return 'normal';
        }
        
        // Strategic selection based on situation
        
        // Use explosive if available (30% chance)
        if (player.arrows.explosive > 0 && Math.random() < 0.3) {
            return 'explosive';
        }
        
        // Use guided for long distances (40% chance)
        if (player.arrows.guided > 0 && distance > 400 && Math.random() < 0.4) {
            return 'guided';
        }
        
        // Use speed arrows (20% chance)
        if (player.arrows.speed > 0 && Math.random() < 0.2) {
            return 'speed';
        }
        
        // Use wind cutter in strong wind (50% chance)
        if (player.arrows.windcutter > 0 && State.wind.velocity > 0.12 && Math.random() < 0.5) {
            return 'windcutter';
        }
        
        // Use triple shot occasionally (15% chance)
        if (player.arrows.triple > 0 && Math.random() < 0.15) {
            return 'triple';
        }
        
        // Use bouncing on hills (25% chance)
        if (player.arrows.bouncing > 0 && Math.random() < 0.25) {
            return 'bouncing';
        }
        
        // Use parachute for precision (20% chance)
        if (player.arrows.parachute > 0 && Math.random() < 0.2) {
            return 'parachute';
        }
        
        // Use piercing through obstacles (20% chance)
        if (player.arrows.piercing > 0 && Math.random() < 0.2) {
            return 'piercing';
        }
        
        // Default to normal
        return 'normal';
    },
    
    // AI shop decisions
    shopDecision: function(player) {
        // Simple AI: buy items in priority order if affordable
        const priorities = [
            'explosive',
            'guided',
            'windcutter',
            'speed',
            'triple',
            'bouncing',
            'parachute',
            'piercing'
        ];
        
        for (let type of priorities) {
            const item = CONFIG.SHOP_ITEMS.find(i => i.type === type);
            if (item && player.gold >= item.price) {
                // Buy it
                Shop.buyArrow(State.current, type, item.price);
                break; // Only buy one item per round
            }
        }
    }
};