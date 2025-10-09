// Network Interface for multiplayer (websocket hookup)
// Override these functions to integrate with your VSMS server

const NetworkInterface = {
    // Called when local player takes a shot
    sendShot: function(playerKey, angle, power, arrowType) {
        // Override this for multiplayer: send to server
        // Example: websocket.send(JSON.stringify({ type: 'shot', player: playerKey, angle, power, arrowType }));
        console.log('NetworkInterface.sendShot:', { playerKey, angle, power, arrowType });
    },
    
    // Called when local player buys an item
    sendPurchase: function(playerKey, itemType, newGold) {
        // Override this for multiplayer: send to server
        // Example: websocket.send(JSON.stringify({ type: 'purchase', player: playerKey, itemType, gold: newGold }));
        console.log('NetworkInterface.sendPurchase:', { playerKey, itemType, newGold });
    },
    
    // Called when local player changes arrow selection
    sendArrowSelection: function(playerKey, arrowType) {
        // Override this for multiplayer: send to server
        // Example: websocket.send(JSON.stringify({ type: 'arrow_select', player: playerKey, arrowType }));
        console.log('NetworkInterface.sendArrowSelection:', { playerKey, arrowType });
    },
    
    // Call this when receiving a shot from opponent via websocket
    receiveShot: function(playerKey, angle, power, arrowType) {
        if (State.status === 'ready') {
            Physics.executeShot(playerKey, angle, power, arrowType);
        }
    },
    
    // Call this when receiving a purchase from opponent via websocket
    receivePurchase: function(playerKey, itemType, newGold) {
        const player = State.players[playerKey];
        player.gold = newGold;
        player.arrows[itemType]++;
        Game.updateUI();
    },
    
    // Call this when receiving arrow selection from opponent via websocket
    receiveArrowSelection: function(playerKey, arrowType) {
        State.players[playerKey].currentArrow = arrowType;
    },
    
    // Initialize websocket connection (call this from your code)
    init: function(websocketUrl) {
        // Example implementation:
        /*
        this.ws = new WebSocket(websocketUrl);
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
        */
        console.log('NetworkInterface.init: Override this method to connect to your VSMS server');
    }
};

// Expose to window for external access
window.NetworkInterface = NetworkInterface;