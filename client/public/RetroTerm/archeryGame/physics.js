// Physics and terrain generation
const Physics = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    terrain: [],
    
    init: function() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize();
    },
    
    resize: function() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.width = rect.width;
        this.height = rect.height;
    },
    
    generateTerrain: function() {
        this.terrain = [];
        const types = ['hill', 'valley', 'mountain', 'wave', 'asymmetric'];
        const type = types[Math.floor(Math.random() * types.length)];
        
        // Player positions
        const bluePos = Math.floor(this.width * 0.15);
        const redPos = Math.floor(this.width * 0.85);
        const clearanceZone = this.width * 0.12; // 12% clearance around players
        const minPlayerHeight = this.height * 0.75; // Ensure players are high enough
        const maxPlayerHeight = this.height * 0.88; // Not too high
        
        // Random base heights for left and right (asymmetric)
        const leftBase = minPlayerHeight + Math.random() * (maxPlayerHeight - minPlayerHeight);
        const rightBase = minPlayerHeight + Math.random() * (maxPlayerHeight - minPlayerHeight);
        
        if (type === 'hill') {
            const hillHeight = this.height * (0.25 + Math.random() * 0.25);
            const hillWidth = this.width * (0.3 + Math.random() * 0.2);
            const hillCenter = this.width * (0.4 + Math.random() * 0.2); // Offset from center
            const hillStart = hillCenter - hillWidth / 2;
            
            for (let i = 0; i <= this.width; i++) {
                // Keep player zones flat
                if (Math.abs(i - bluePos) < clearanceZone) {
                    this.terrain.push(leftBase);
                } else if (Math.abs(i - redPos) < clearanceZone) {
                    this.terrain.push(rightBase);
                } else if (i >= hillStart && i <= hillStart + hillWidth) {
                    const angle = ((i - hillStart) / hillWidth) * Math.PI;
                    const baseInterp = leftBase + (rightBase - leftBase) * (i / this.width);
                    this.terrain.push(baseInterp - Math.sin(angle) * hillHeight);
                } else {
                    // Interpolate between left and right base
                    const baseInterp = leftBase + (rightBase - leftBase) * (i / this.width);
                    this.terrain.push(baseInterp);
                }
            }
        } else if (type === 'valley') {
            const valleyDepth = this.height * 0.15;
            const valleyWidth = this.width * 0.25;
            const valleyCenter = this.width * (0.4 + Math.random() * 0.2);
            const valleyStart = valleyCenter - valleyWidth / 2;
            
            for (let i = 0; i <= this.width; i++) {
                if (Math.abs(i - bluePos) < clearanceZone) {
                    this.terrain.push(leftBase);
                } else if (Math.abs(i - redPos) < clearanceZone) {
                    this.terrain.push(rightBase);
                } else if (i >= valleyStart && i <= valleyStart + valleyWidth) {
                    const angle = ((i - valleyStart) / valleyWidth) * Math.PI;
                    const baseInterp = leftBase + (rightBase - leftBase) * (i / this.width);
                    this.terrain.push(Math.min(this.height * 0.95, baseInterp + Math.sin(angle) * valleyDepth));
                } else {
                    const baseInterp = leftBase + (rightBase - leftBase) * (i / this.width);
                    this.terrain.push(baseInterp);
                }
            }
        } else if (type === 'mountain') {
            const peakHeight = this.height * 0.4;
            const peakPos = this.width * (0.4 + Math.random() * 0.2);
            
            for (let i = 0; i <= this.width; i++) {
                if (Math.abs(i - bluePos) < clearanceZone) {
                    this.terrain.push(leftBase);
                } else if (Math.abs(i - redPos) < clearanceZone) {
                    this.terrain.push(rightBase);
                } else {
                    const dist = Math.abs(i - peakPos) / (this.width * 0.3);
                    const baseInterp = leftBase + (rightBase - leftBase) * (i / this.width);
                    const peak = Math.max(0, 1 - dist * dist);
                    this.terrain.push(baseInterp - peak * peakHeight);
                }
            }
        } else if (type === 'asymmetric') {
            // Asymmetric slopes with multiple features
            for (let i = 0; i <= this.width; i++) {
                if (Math.abs(i - bluePos) < clearanceZone) {
                    this.terrain.push(leftBase);
                } else if (Math.abs(i - redPos) < clearanceZone) {
                    this.terrain.push(rightBase);
                } else {
                    const baseInterp = leftBase + (rightBase - leftBase) * (i / this.width);
                    const noise1 = Math.sin(i / this.width * Math.PI * 3 + 1.5) * this.height * 0.08;
                    const noise2 = Math.sin(i / this.width * Math.PI * 5 + 2.3) * this.height * 0.04;
                    this.terrain.push(baseInterp + noise1 + noise2);
                }
            }
        } else { // wave
            for (let i = 0; i <= this.width; i++) {
                if (Math.abs(i - bluePos) < clearanceZone) {
                    this.terrain.push(leftBase);
                } else if (Math.abs(i - redPos) < clearanceZone) {
                    this.terrain.push(rightBase);
                } else {
                    const baseInterp = leftBase + (rightBase - leftBase) * (i / this.width);
                    const wave1 = Math.sin(i / this.width * Math.PI * 2.5) * this.height * 0.08;
                    const wave2 = Math.sin(i / this.width * Math.PI * 4.5 + 1) * this.height * 0.04;
                    this.terrain.push(baseInterp + wave1 + wave2);
                }
            }
        }
    },
    
    generateWind: function() {
        // 30% chance of no wind
        if (Math.random() < 0.3) {
            State.wind = { velocity: 0, direction: 0 };
        } else {
            State.wind = {
                velocity: 0.05 + Math.random() * 0.15, // 0.05 to 0.2
                direction: Math.random() < 0.5 ? -1 : 1 // -1 left, 1 right
            };
        }
        this.updateWindDisplay();
    },
    
    updateWindDisplay: function() {
        const wind = State.wind;
        const windText = document.getElementById('wind-text');
        const windIcon = document.getElementById('wind-icon');
        
        if (wind.velocity === 0) {
            windText.textContent = 'No Wind';
            windIcon.textContent = '🍃';
        } else {
            const strength = wind.velocity < 0.1 ? 'Light' : wind.velocity < 0.15 ? 'Medium' : 'Strong';
            const dir = wind.direction === -1 ? '←' : '→';
            windText.textContent = `${strength} ${dir}`;
            windIcon.textContent = '💨';
        }
    },
    
    placePlayers: function() {
        const bluePos = Math.floor(this.width * 0.15);
        const redPos = Math.floor(this.width * 0.85);
        
        // Place players on the terrain with extra clearance above
        State.players.blue.x = bluePos;
        State.players.blue.y = this.terrain[bluePos] - CONFIG.PLAYER_SIZE * 2; // More clearance
        
        State.players.red.x = redPos;
        State.players.red.y = this.terrain[redPos] - CONFIG.PLAYER_SIZE * 2; // More clearance
    },
    
    executeShot: function(playerKey, angle, power, arrowType) {
        const player = State.players[playerKey];
        
        if (arrowType !== 'normal' && player.arrows[arrowType] <= 0) {
            return;
        }
        
        State.status = 'firing';
        
        if (arrowType !== 'normal') {
            player.arrows[arrowType]--;
        }
        
        const isBlue = playerKey === 'blue';
        const rads = (isBlue ? 180 - angle : angle) * Math.PI / 180;
        const startX = player.x + (isBlue ? CONFIG.PLAYER_SIZE : -CONFIG.PLAYER_SIZE);
        const velocity = power / 5;
        const vx = Math.cos(rads) * velocity;
        const vy = -Math.sin(rads) * velocity;
        
        if (arrowType === 'triple') {
            for (let i = -1; i <= 1; i++) {
                const angleOffset = i * 5 * Math.PI / 180;
                const newRads = rads + angleOffset;
                State.arrows.push({
                    x: startX,
                    y: player.y,
                    vx: Math.cos(newRads) * velocity,
                    vy: -Math.sin(newRads) * velocity,
                    type: 'normal',
                    bounces: 0,
                    age: 0,
                    active: true
                });
            }
        } else {
            State.arrows.push({
                x: startX,
                y: player.y,
                vx: vx,
                vy: vy,
                type: arrowType,
                bounces: 0,
                age: 0,
                active: true
            });
        }
        
        Game.updateUI();
    },
    
    updateArrows: function() {
        State.arrows.forEach(arrow => {
            if (!arrow.active) return;
            
            // Apply gravity
            let gravity = CONFIG.GRAVITY;
            if (arrow.type === 'parachute' && arrow.vy > 0) gravity *= 0.2;
            if (arrow.type === 'speed') gravity *= 0.7;
            arrow.vy += gravity;
            
            // Apply wind (unless wind cutter)
            if (arrow.type !== 'windcutter' && State.wind.velocity > 0) {
                arrow.vx += State.wind.velocity * State.wind.direction * 0.02;
            }
            
            // Guided arrow correction
            if (arrow.type === 'guided' && arrow.age < 80) {
                const opponentKey = State.current === 'blue' ? 'red' : 'blue';
                const target = State.players[opponentKey];
                const dx = target.x - arrow.x;
                const dy = (target.y - CONFIG.PLAYER_SIZE * 1.5) - arrow.y;
                arrow.vx += dx * 0.0003;
                arrow.vy += dy * 0.0003;
            }
            
            // Speed multiplier
            const speedMult = arrow.type === 'speed' ? 1.5 : 1;
            arrow.x += arrow.vx * speedMult;
            arrow.y += arrow.vy * speedMult;
            arrow.age++;
            
            // Check hit on opponent
            const opponentKey = State.current === 'blue' ? 'red' : 'blue';
            const opponent = State.players[opponentKey];
            const dx = arrow.x - opponent.x;
            const dy = arrow.y - (opponent.y - CONFIG.PLAYER_SIZE * 1.5);
            const hitRadius = arrow.type === 'explosive' ? CONFIG.PLAYER_SIZE * 2.5 : CONFIG.PLAYER_SIZE;
            
            if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
                Game.handleHit(opponentKey);
                arrow.active = false;
            }
            // Check out of bounds
            else if (arrow.x < 0 || arrow.x > this.width || arrow.y > this.height) {
                arrow.active = false;
            }
            // Check terrain collision
            else if (Math.floor(arrow.x) >= 0 && Math.floor(arrow.x) < this.width && arrow.y >= this.terrain[Math.floor(arrow.x)]) {
                if (arrow.type === 'piercing') {
                    // Continue through terrain
                } else if (arrow.type === 'bouncing' && arrow.bounces < 1) {
                    arrow.bounces++;
                    arrow.y = this.terrain[Math.floor(arrow.x)];
                    arrow.vy *= -0.6;
                } else {
                    if (arrow.type === 'explosive') {
                        this.drawExplosion(arrow.x, arrow.y);
                    }
                    arrow.active = false;
                }
            }
        });
        
        // Check if all arrows are inactive
        if (State.arrows.length > 0 && State.arrows.every(a => !a.active)) {
            Game.switchPlayer();
        }
    },
    
    drawExplosion: function(x, y) {
        this.ctx.fillStyle = 'orange';
        this.ctx.beginPath();
        this.ctx.arc(x, y, CONFIG.PLAYER_SIZE * 2, 0, Math.PI * 2);
        this.ctx.fill();
    }
};