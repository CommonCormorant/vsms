// Initialize game when page loads
window.addEventListener('load', () => {
    Game.init();
});

// Expose global objects for debugging and external integration
window.Game = Game;
window.Physics = Physics;
window.AI = AI;
window.Shop = Shop;
window.State = State;
window.CONFIG = CONFIG;

// Example of how to integrate websocket for multiplayer:
/*
// In your external code:
NetworkInterface.init('wss://your-vsms-server.com');

// Override the init method:
NetworkInterface.init = function(url) {
    this.ws = new WebSocket(url);
    
    this.ws.onopen = () => {
        console.log('Connected to VSMS server');
    };
    
    this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch(data.type) {
            case 'shot':
                this.receiveShot(data.player, data.angle, data.power, data.arrowType);
                break;
            case 'purchase':
                this.receivePurchase(data.player, data.itemType, data.gold);
                break;
            case 'arrow_select':
                this.receiveArrowSelection(data.player, data.arrowType);
                break;
        }
    };
    
    this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
};

// Override send methods to actually send data:
NetworkInterface.sendShot = function(playerKey, angle, power, arrowType) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
            type: 'shot',
            player: playerKey,
            angle: angle,
            power: power,
            arrowType: arrowType
        }));
    }
};

NetworkInterface.sendPurchase = function(playerKey, itemType, newGold) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
            type: 'purchase',
            player: playerKey,
            itemType: itemType,
            gold: newGold
        }));
    }
};

NetworkInterface.sendArrowSelection = function(playerKey, arrowType) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
            type: 'arrow_select',
            player: playerKey,
            arrowType: arrowType
        }));
    }
};
*/