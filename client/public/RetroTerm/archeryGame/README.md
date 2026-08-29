# RetroTerm Mini-Games & Canvas Toys

This documentation covers the mini-game and visual toy subdirectories inside `client/public/RetroTerm/`.

---

## Archery Game (`client/public/RetroTerm/archeryGame`)

### 1. Purpose
`archeryGame` is an embedded HTML5 canvas mini-game built inside RetroTerm, featuring physics, shop systems, AI opponents, and multiplayer networking capabilities.

### 2. Contents
- `index.html`: Web wrapper and canvas container.
- `style.css`: Canvas and UI container styling.
- `main.js` / `game.js`: Game loop, rendering, and state management.
- `physics.js`: Projectile trajectory and arrow collision physics.
- `ai.js`: AI opponent aiming and shooting logic.
- `shop.js`: Item and equipment purchase systems.
- `config.js`: Game parameters and tuning constants.
- `network.js`: Multiplayer network synchronization hooks.

### 3. Role in VSMS
Serves as an embedded entertainment module / canvas toy integrated within the RetroTerm terminal interface.

---

## Rocketship Game (`client/public/RetroTerm/rocketship`)

### 1. Purpose
`rocketship` is a retro space arcade game module embedded in RetroTerm.

### 2. Contents
- `index.html`: Canvas host page.
- `ship.css`: Visual styling for space canvas.
- `ship.js` / `ship0.js`: Ship controls, movement, asteroid spawning, and collision detection.
- Asset images: `largerAsteroid.png`, `mediumAsteroid.png`, `smallerAsteroid.png`.

### 3. Role in VSMS
Embedded interactive canvas toy accessible through RetroTerm.

---

## Squid View Component (`client/public/RetroTerm/squid`)

### 1. Purpose
`squid` contains visual view components and experimental sub-views (`View/` and `View/2/`).

### 2. Contents
- `View/index.html`, `View/squid.js`, `View/squid.css`: Base squid widget view.
- `View/2/index.html`, `View/2/squid2.js`, `View/2/squid2.css`: Alternate version 2 squid widget view.

### 3. Role in VSMS
Experimental UI widget or animated visual artifact inside RetroTerm.
