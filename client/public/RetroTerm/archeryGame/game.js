// Main game logic
const Game = {
    init: function() {
        Physics.init();
        Shop.init();
        this.setupEventListeners();
        this.startGameLoop();
    },
    
    setupEventListeners: function() {
        // Angle slider
        const angleSlider = document.getElementById('angle');
        const angleVal = document.getElementById('angle-val');
        angleSlider.addEventListener('input', (e) => {
            angleVal.textContent = `${e.target.value}°`;
        });
        
        // Power slider
        const powerSlider = document.getElementById('power');
        const powerVal = document.getElementById('power-val');
        powerSlider.addEventListener('input', (e) => {
            powerVal.textContent = e.target.value;
        });
        
        // Fire button
        document.getElementById('fire').addEventListener('click', () => this.fireButtonClick());
        
        // Next round button
        document.getElementById('next-round').addEventListener('click', () => this.nextRound());
        
        // Window resize
        window.addEventListener('resize', () => {
            Physics.resize();
            Physics.generateTerrain();
            Physics.placePlayers();
        });
    },
    
    start: function(mode) {
        State.mode = mode;
        
        // Set AI player
        if (mode === 'ai') {
            State.players.red.isAI = true;
        } else {
            State.players.red.isAI = false;
        }
        
        // Hide mode selection modal
        document.getElementById('mode-modal').style.display = 'none';
        
        // Start new round
        this.newRound();
    },
    
    newRound: function() {
        Physics.generateTerrain();
        Physics.generateWind();
        Physics.placePlayers();
        State.status = 'ready';
        State.arrows = [];
        State.aiThinkTimer = 0;
        this.updateUI();
        
        // If AI is first player and it's their turn, let them shop
        if (State.players[State.current].isAI) {
            AI.shopDecision(State.players[State.current]);
        }
    },
    
    fireButtonClick: function() {
        if (State.status !== 'ready' || State.players[State.current].isAI) {
            return;
        }
        
        const angle = parseFloat(document.getElementById('angle').value);
        const power = parseFloat(document.getElementById('power').value);
        const arrowType = State.players[State.current].currentArrow;
        
        NetworkInterface.sendShot(State.current, angle, power, arrowType);
        Physics.executeShot(State.current, angle, power, arrowType);
    },
    
    switchPlayer: function() {
        State.arrows = [];
        State.current = State.current === 'blue' ? 'red' : 'blue';
        State.status = 'ready';
        State.aiThinkTimer = 0;
        this.updateUI();
    },
    
    handleHit: function(hitPlayerKey) {
        State.status = 'hit';
        const winnerKey = State.current;
        const winner = State.players[winnerKey];
        
        const goldWon = State.level * 100;
        winner.gold += goldWon;
        
        document.getElementById('round-title').textContent = 
            `${winnerKey.charAt(0).toUpperCase() + winnerKey.slice(1)} Wins!`;
        document.getElementById('round-msg').textContent = 
            `Earned 💰 ${goldWon} gold!`;
        document.getElementById('round-modal').style.display = 'flex';
        
        State.level++;
    },
    
    nextRound: function() {
        document.getElementById('round-modal').style.display = 'none';
        
        // AI makes shop decision
        if (State.players[State.current].isAI) {
            AI.shopDecision(State.players[State.current]);
        }
        
        this.newRound();
    },
    
    updateUI: function() {
        // Update gold displays
        document.getElementById('blue-gold').textContent = `💰 ${State.players.blue.gold}`;
        document.getElementById('red-gold').textContent = `💰 ${State.players.red.gold}`;
        
        // Update level
        document.getElementById('level-text').textContent = `Level ${State.level}`;
        
        // Highlight active player
        document.getElementById('blue-info').classList.toggle('active', State.current === 'blue');
        document.getElementById('red-info').classList.toggle('active', State.current === 'red');
        
        // Update control states
        const isAITurn = State.players[State.current].isAI;
        const fireButton = document.getElementById('fire');
        const angleSlider = document.getElementById('angle');
        const powerSlider = document.getElementById('power');
        
        fireButton.disabled = State.status !== 'ready' || isAITurn;
        angleSlider.disabled = State.status !== 'ready' || isAITurn;
        powerSlider.disabled = State.status !== 'ready' || isAITurn;
    },
    
    draw: function() {
        const ctx = Physics.ctx;
        const w = Physics.width;
        const h = Physics.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, w, h);
        
        // Draw terrain
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--hill').trim();
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < Physics.terrain.length; i++) {
            ctx.lineTo(i, Physics.terrain[i]);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        
        // Draw players
        this.drawPlayer('blue');
        this.drawPlayer('red');
        
        // Draw arrows
        State.arrows.forEach(arrow => {
            if (arrow.active) {
                ctx.save();
                ctx.translate(arrow.x, arrow.y);
                ctx.rotate(Math.atan2(arrow.vy, arrow.vx));
                ctx.font = '20px sans-serif';
                ctx.fillText(CONFIG.ARROWS[arrow.type].emoji, 0, 0);
                ctx.restore();
            }
        });
        
        // Draw aim indicator
        if (State.status === 'ready' && !State.players[State.current].isAI) {
            this.drawAimIndicator();
        }
    },
    
    drawPlayer: function(playerKey) {
        const player = State.players[playerKey];
        const ctx = Physics.ctx;
        
        ctx.font = `${CONFIG.PLAYER_SIZE * 1.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw target
        ctx.fillText('🎯', player.x, player.y - CONFIG.PLAYER_SIZE * 1.5);
        
        // Draw archer
        const archerX = playerKey === 'blue' ? 
            player.x - CONFIG.PLAYER_SIZE : 
            player.x + CONFIG.PLAYER_SIZE;
        ctx.fillText('🧍', archerX, player.y);
    },
    
    drawAimIndicator: function() {
        const player = State.players[State.current];
        const angle = parseFloat(document.getElementById('angle').value);
        const power = parseFloat(document.getElementById('power').value) / 2;
        const ctx = Physics.ctx;
        
        const rads = (State.current === 'blue' ? 180 - angle : angle) * Math.PI / 180;
        const startX = player.x + (State.current === 'blue' ? CONFIG.PLAYER_SIZE : -CONFIG.PLAYER_SIZE);
        
        ctx.beginPath();
        ctx.moveTo(startX, player.y);
        ctx.lineTo(
            startX + Math.cos(rads) * power,
            player.y - Math.sin(rads) * power
        );
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
    },
    
    startGameLoop: function() {
        const loop = () => {
            // Update physics
            if (State.status === 'firing') {
                Physics.updateArrows();
            }
            
            // Update AI
            AI.update();
            
            // Draw
            this.draw();
            
            requestAnimationFrame(loop);
        };
        loop();
    }
};