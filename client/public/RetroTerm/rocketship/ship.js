document.body.addEventListener('dblclick', function(event) {
    event.preventDefault();
});

const canvas = document.getElementById('space-canvas');
const ctx = canvas.getContext('2d');
let width, height;
let stars = [];
let planets = [];
let asteroids = [];
let asteroidImages = [];
let loadedAsteroidImages = [];

const rocket = {
    x: 0,
    y: 0,
    size: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    targetX: 0,
    targetY: 0,
    time: 0,
    init() {
        this.x = width / 2;
        this.y = height / 2;
        this.size = Math.min(width, height) / 20;
        this.newTarget();
    },
    newTarget() {
        this.targetX = Math.random() * width;
        this.targetY = Math.random() * height;
    },
    update() {
        this.time += 0.02;

        let dx = this.targetX - this.x;
        let dy = this.targetY - this.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 100 || Math.random() < 0.01) {
            this.newTarget();
        }

        this.vx += dx * 0.00008;
        this.vy += dy * 0.00008;
        
        this.vx *= 0.99;
        this.vy *= 0.99;

        this.x += this.vx;
        this.y += this.vy;

        if (this.x < -this.size) this.x = width + this.size;
        if (this.x > width + this.size) this.x = -this.size;
        if (this.y < -this.size) this.y = height + this.size;
        if (this.y > height + this.size) this.y = -this.size;

        this.angle = Math.atan2(this.vy, this.vx);
    },
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        const baseFlameLength = this.size * 1.5;
        const speedMagnitude = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        const dynamicFlameLength = baseFlameLength + speedMagnitude * 5;

        // Exhaust flame with movement lines (behind the rocket)
        for (let i = 0; i < 10; i++) {
            ctx.beginPath();
            ctx.moveTo(-this.size * 0.6, (Math.random() - 0.5) * this.size * 0.4);
            ctx.lineTo(-this.size * 0.6 - dynamicFlameLength * (0.5 + Math.random() * 0.5), (Math.random() - 0.5) * this.size * 0.2);
            ctx.strokeStyle = `rgba(255, ${150 + Math.random() * 105}, 0, ${0.3 + Math.random() * 0.4})`;
            ctx.lineWidth = Math.random() * 2 + 0.5;
            ctx.stroke();
        }

        // Bottom fins
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.moveTo(-this.size * 0.5, this.size * 0.3);
        ctx.lineTo(-this.size, this.size * 0.8);
        ctx.lineTo(-this.size * 0.8, this.size * 0.3);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-this.size * 0.5, -this.size * 0.3);
        ctx.lineTo(-this.size, -this.size * 0.8);
        ctx.lineTo(-this.size * 0.8, -this.size * 0.3);
        ctx.closePath();
        ctx.fill();

        // Main body (light gray)
        ctx.fillStyle = '#cccccc';
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size, this.size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        // Body detail (darker gray)
        ctx.fillStyle = '#aaaaaa';
        ctx.beginPath();
        ctx.ellipse(-this.size * 0.2, 0, this.size * 0.7, this.size * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();

        // Nose cone (red) - pointing forward
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.moveTo(this.size * 1.4, 0);
        ctx.lineTo(this.size * 0.7, this.size * 0.35);
        ctx.lineTo(this.size * 0.7, -this.size * 0.35);
        ctx.closePath();
        ctx.fill();

        // Window/porthole
        ctx.fillStyle = 'rgba(100, 150, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(this.size * 0.1, 0, this.size * 0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
};

function createStar() {
    return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.2 + 0.05,
        opacity: Math.random() * 0.5 + 0.5
    };
}

function createPlanet() {
    const size = Math.random() * 80 + 40;
    return {
        x: width + size,
        y: Math.random() * height,
        size: size,
        speed: Math.random() * 0.4 + 0.1,
        color: `hsl(${Math.random() * 360}, 60%, 50%)`,
        hasRings: Math.random() > 0.7,
        ringAngle: (Math.random() - 0.5) * 0.6
    };
}

function createAsteroid() {
    const imgIndex = Math.floor(Math.random() * loadedAsteroidImages.length);
    const img = loadedAsteroidImages[imgIndex];
    const baseSize = asteroidImages[imgIndex].size;
    
    const scale = (Math.random() * 0.4 + 0.3) * (Math.min(width, height) / 1000);
    const size = baseSize * scale;
    const y = Math.random() * height;
    
    const speed = Math.random() * 4 + 2;
    const zIndex = Math.random() < 0.5 ? 0 : 1; // 0 = behind rocket, 1 = in front
    
    return {
        img,
        x: width + size,
        y,
        size,
        speed,
        zIndex,
        angle: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.02,
        trail: []
    };
}

function setup() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;

    stars = [];
    for (let i = 0; i < 200; i++) {
        stars.push(createStar());
    }
    
    planets = [];
    asteroids = [];
    
    // Load asteroid images
    asteroidImages = [
        { src: 'largerAsteroid.png', size: 1024 },
        { src: 'mediumAsteroid.png', size: 768 },
        { src: 'smallerAsteroid.png', size: 256 }
    ];
    
    loadedAsteroidImages = [];
    asteroidImages.forEach(imgData => {
        const img = new Image();
        img.src = imgData.src;
        loadedAsteroidImages.push(img);
    });
    
    rocket.init();
}

function updateAndDrawPlanets() {
    if (Math.random() < 0.0003 && planets.length < 2) {
        planets.push(createPlanet());
    }

    for (let i = planets.length - 1; i >= 0; i--) {
        const p = planets[i];
        p.x -= p.speed;

        if (p.x < -p.size * 2) {
            planets.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        
        // Draw back part of rings first (behind planet)
        if (p.hasRings) {
            ctx.save();
            ctx.rotate(p.ringAngle);
            ctx.strokeStyle = `rgba(255, 255, 255, 0.2)`;
            ctx.lineWidth = p.size * 0.08;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 1.6, p.size * 0.4, 0, Math.PI, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        
        // Draw planet body (opaque, covers stars)
        const gradient = ctx.createRadialGradient(-p.size * 0.3, -p.size * 0.3, p.size * 0.1, 0, 0, p.size);
        gradient.addColorStop(0, 'rgba(255,255,255,0.4)');
        gradient.addColorStop(0.5, p.color);
        gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
        ctx.fillStyle = gradient;
        
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Draw front part of rings (in front of planet)
        if (p.hasRings) {
            ctx.save();
            ctx.rotate(p.ringAngle);
            ctx.strokeStyle = `rgba(255, 255, 255, 0.5)`;
            ctx.lineWidth = p.size * 0.1;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 1.6, p.size * 0.4, 0, 0, Math.PI);
            ctx.stroke();
            ctx.restore();
        }
        
        ctx.restore();
    }
}

function updateAsteroids() {
    if (Math.random() < 0.008 && asteroids.length < 5) {
        asteroids.push(createAsteroid());
    }
    
    for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i];
        
        // Store trail position
        a.trail.push({ x: a.x, y: a.y, angle: a.angle });
        if (a.trail.length > 5) {
            a.trail.shift();
        }
        
        a.x -= a.speed;
        a.angle += a.rotationSpeed;
        
        if (a.x < -a.size * 2) {
            asteroids.splice(i, 1);
        }
    }
}

function drawAsteroid(a) {
    // Draw motion blur trail
    for (let i = 0; i < a.trail.length; i++) {
        const t = a.trail[i];
        const alpha = (i + 1) / a.trail.length * 0.3;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(t.x, t.y);
        ctx.rotate(t.angle);
        ctx.drawImage(a.img, -a.size / 2, -a.size / 2, a.size, a.size);
        ctx.restore();
    }
    
    // Draw main asteroid
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    ctx.drawImage(a.img, -a.size / 2, -a.size / 2, a.size, a.size);
    ctx.restore();
}

function draw() {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#020828');
    gradient.addColorStop(1, '#000010');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    ctx.shadowBlur = 0;

    updateAndDrawPlanets();

    stars.forEach(s => {
        s.x -= s.speed;
        if (s.x < 0) {
            s.x = width;
            s.y = Math.random() * height;
        }
        const twinkle = Math.random() > 0.995 ? Math.random() : s.opacity;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 250, 205, ${twinkle})`;
        ctx.fill();
    });
    
    rocket.update();
    
    // Update asteroids
    updateAsteroids();
    
    // Draw asteroids behind the rocket
    asteroids.filter(a => a.zIndex === 0).forEach(a => {
        drawAsteroid(a);
    });
    
    // Draw the rocket
    rocket.draw();
    
    // Draw asteroids in front of the rocket
    asteroids.filter(a => a.zIndex === 1).forEach(a => {
        drawAsteroid(a);
    });

    requestAnimationFrame(draw);
}

window.addEventListener('resize', setup);
setup();
draw();

const fullscreenBtn = document.getElementById('fullscreen-btn');

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

function updateFullscreenUI() {
    if (document.fullscreenElement) {
        document.body.classList.add('fullscreen-active');
        fullscreenBtn.innerHTML = '🖼️';
    } else {
        document.body.classList.remove('fullscreen-active');
        fullscreenBtn.innerHTML = 'Full Screen';
    }
}

fullscreenBtn.addEventListener('click', toggleFullScreen);
document.addEventListener('fullscreenchange', updateFullscreenUI);