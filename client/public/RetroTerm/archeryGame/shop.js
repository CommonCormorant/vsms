// Shop system
const Shop = {
    init: function() {
        this.setupShopItems();
        this.setupEventListeners();
    },
    
    setupShopItems: function() {
        const container = document.getElementById('shop-items');
        container.innerHTML = '';
        
        CONFIG.SHOP_ITEMS.forEach(item => {
            const div = document.createElement('div');
            div.className = 'shop-item';
            div.innerHTML = `
                <div class="shop-header">
                    <span class="emoji">${CONFIG.ARROWS[item.type].emoji}</span>
                    <span class="shop-title">${CONFIG.ARROWS[item.type].name}</span>
                </div>
                <div class="shop-desc">${item.desc}</div>
                <div class="shop-footer">
                    <span class="price">💰 ${item.price}</span>
                    <span class="owned" data-type="${item.type}">Owned: 0</span>
                    <button class="buy-btn" data-type="${item.type}" data-price="${item.price}">Buy</button>
                </div>
            `;
            container.appendChild(div);
        });
    },
    
    setupEventListeners: function() {
        document.getElementById('shop').addEventListener('click', () => this.open());
        document.getElementById('close-shop').addEventListener('click', () => this.close());
        
        document.querySelectorAll('.buy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.currentTarget.dataset.type;
                const price = parseInt(e.currentTarget.dataset.price);
                this.buyArrow(State.current, type, price);
            });
        });
    },
    
    open: function() {
        const player = State.players[State.current];
        
        // Update gold display
        document.getElementById('shop-gold').textContent = `💰 ${player.gold}`;
        
        // Update owned counts
        document.querySelectorAll('.owned').forEach(el => {
            const type = el.dataset.type;
            el.textContent = `Owned: ${player.arrows[type]}`;
        });
        
        // Update button states
        document.querySelectorAll('.buy-btn').forEach(btn => {
            const price = parseInt(btn.dataset.price);
            btn.disabled = player.gold < price;
        });
        
        // Update arrow selector
        this.updateArrowSelector();
        
        // Show modal
        document.getElementById('shop-modal').style.display = 'flex';
    },
    
    close: function() {
        document.getElementById('shop-modal').style.display = 'none';
    },
    
    buyArrow: function(playerKey, arrowType, price) {
        const player = State.players[playerKey];
        
        if (player.gold >= price) {
            player.gold -= price;
            player.arrows[arrowType]++;
            
            // Send to network if multiplayer
            NetworkInterface.sendPurchase(playerKey, arrowType, player.gold);
            
            // Update UI
            document.getElementById('shop-gold').textContent = `💰 ${player.gold}`;
            document.querySelector(`.owned[data-type="${arrowType}"]`).textContent = `Owned: ${player.arrows[arrowType]}`;
            
            // Update button states
            document.querySelectorAll('.buy-btn').forEach(btn => {
                const p = parseInt(btn.dataset.price);
                btn.disabled = player.gold < p;
            });
            
            this.updateArrowSelector();
            Game.updateUI();
        }
    },
    
    updateArrowSelector: function() {
        const player = State.players[State.current];
        const container = document.getElementById('arrow-opts');
        container.innerHTML = '';
        
        Object.keys(CONFIG.ARROWS).forEach(type => {
            const count = player.arrows[type];
            
            // Don't show arrows with 0 count (except normal)
            if (count === 0 && type !== 'normal') return;
            
            const option = document.createElement('div');
            option.className = 'arrow-option';
            if (player.currentArrow === type) option.classList.add('selected');
            if (count === 0 && type !== 'normal') option.classList.add('disabled');
            
            option.innerHTML = `
                ${CONFIG.ARROWS[type].emoji} ${CONFIG.ARROWS[type].name}
                ${type !== 'normal' ? `<br><small>(${count})</small>` : ''}
            `;
            
            option.addEventListener('click', () => {
                if (count > 0 || type === 'normal') {
                    player.currentArrow = type;
                    NetworkInterface.sendArrowSelection(State.current, type);
                    this.updateArrowSelector();
                }
            });
            
            container.appendChild(option);
        });
    }
};