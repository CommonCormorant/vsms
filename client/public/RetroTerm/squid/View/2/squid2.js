        document.body.addEventListener('dblclick', function(event) {
            event.preventDefault();
        });

        const canvas = document.getElementById('sea-canvas');
        const ctx = canvas.getContext('2d');
        let width, height;
        let particles = [];
        let debris = [];
        let floorPoints = [];

        const squid = {
            x: 0,
            y: 0,
            size: 0,
            angle: 0,
            vx: 0,
            vy: 0,
            targetX: 0,
            targetY: 0,
            time: 0,
            tentacleTime: 0,
            init() {
                this.x = width / 2;
                this.y = height / 2;
                this.size = Math.min(width, height) / 15;
                this.newTarget();
            },
            newTarget() {
                this.targetX = Math.random() * width * 0.8 + width * 0.1;
                this.targetY = Math.random() * height * 0.6 + height * 0.2;
            },
            update() {
                this.time += 0.02;
                this.tentacleTime += 0.1;

                let dx = this.targetX - this.x;
                let dy = this.targetY - this.y;
                let dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 50) {
                    this.newTarget();
                }

                this.vx += dx * 0.0001;
                this.vy += dy * 0.0001;
                
                this.vx *= 0.98;
                this.vy *= 0.98;

                this.x += this.vx + Math.sin(this.time) * 0.5;
                this.y += this.vy + Math.cos(this.time * 0.8) * 0.5;
                
                const floorHeight = height * 0.9;
                if (this.y > floorHeight - this.size * 2) {
                    this.y = floorHeight - this.size * 2;
                    this.vy *= -0.5;
                    // When near floor, move relative to frame
                    this.x += Math.sin(this.time * 0.5) * 1.5;
                }

                this.x = Math.max(this.size, Math.min(width - this.size, this.x));
                this.y = Math.max(this.size, this.y);

                this.angle = Math.atan2(this.vy, this.vx);
            },
            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.angle);

                ctx.shadowColor = 'rgba(224, 176, 255, 0.5)';
                ctx.shadowBlur = 30;

                // Tentacles
                ctx.fillStyle = '#d0a0ef';
                ctx.strokeStyle = '#b080cf';
                ctx.lineWidth = this.size * 0.1;
                for (let i = 0; i < 6; i++) {
                    ctx.beginPath();
                    const angleOffset = (i - 2.5) * 0.3;
                    const length = this.size * (1.2 + Math.sin(i * 2) * 0.2);
                    const wave = Math.sin(this.tentacleTime + i) * this.size * 0.2;
                    ctx.moveTo(-this.size * 0.5, 0);
                    ctx.quadraticCurveTo(
                        -this.size * 0.8, angleOffset * this.size + wave,
                        -this.size * 0.5 - length, angleOffset * this.size * 1.5
                    );
                    ctx.stroke();
                }

                // Body
                ctx.fillStyle = '#e0b0ff';
                ctx.beginPath();
                ctx.ellipse(0, 0, this.size, this.size * 0.6, 0, 0, Math.PI * 2);
                ctx.fill();

                // Eyes
                ctx.fillStyle = '#200030';
                ctx.beginPath();
                ctx.arc(this.size * 0.4, -this.size * 0.2, this.size * 0.08, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(this.size * 0.4, this.size * 0.2, this.size * 0.08, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();
            }
        };

        function createParticle() {
            return {
                x: Math.random() * width,
                y: Math.random() * height,
                size: Math.random() * 2 + 1,
                speed: Math.random() * 0.5 + 0.1,
                opacity: Math.random() * 0.5 + 0.2
            };
        }
        
        function createDebris() {
            return {
                x: Math.random() * width,
                y: height * 0.9 + Math.random() * height * 0.1,
                size: Math.random() * 30 + 10,
                type: Math.random() > 0.5 ? 'coral' : 'rock',
                segments: Math.floor(Math.random() * 4) + 3,
                angle: Math.random() * Math.PI * 2
            };
        }
        
        function generateFloor() {
            floorPoints = [];
            const floorHeight = height * 0.9;
            const roughness = 0.01;
            let y = floorHeight;
            for (let x = 0; x <= width; x += 20) {
                y += (Math.random() - 0.5) * 10;
                y = Math.max(floorHeight - 20, Math.min(height, y));
                floorPoints.push({x, y});
            }
        }

        function setup() {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;

            particles = [];
            for (let i = 0; i < 100; i++) {
                particles.push(createParticle());
            }
            
            debris = [];
            for (let i = 0; i < Math.floor(width / 200); i++) {
                debris.push(createDebris());
            }
            
            generateFloor();
            squid.init();
        }

        function draw() {
            // Background
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#020828');
            gradient.addColorStop(1, '#000010');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
            
            ctx.shadowBlur = 0;

            // Particles (Plankton)
            particles.forEach(p => {
                p.y -= p.speed;
                if (p.y < 0) {
                    p.y = height;
                    p.x = Math.random() * width;
                }
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(167, 216, 222, ${p.opacity})`;
                ctx.fill();
            });
            
            // Sea Floor and Debris
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,1)';
            ctx.shadowBlur = 40;
            ctx.shadowOffsetY = 10;
            
            // Debris
            debris.forEach(d => {
                ctx.beginPath();
                ctx.save();
                ctx.translate(d.x, d.y);
                ctx.rotate(d.angle);
                if (d.type === 'coral') {
                    ctx.strokeStyle = '#ffccaa';
                    ctx.lineWidth = d.size / 10;
                    ctx.moveTo(0,0);
                    for(let i = 1; i < d.segments; i++) {
                        const ang = (i / d.segments) * Math.PI - Math.PI/2;
                        ctx.lineTo(Math.cos(ang) * d.size * 0.5, -Math.sin(ang) * d.size);
                        ctx.moveTo(0,0);
                    }
                    ctx.stroke();
                } else {
                    ctx.fillStyle = '#1a1a2a';
                    ctx.moveTo(0, -d.size/2);
                    for(let i = 1; i < d.segments; i++) {
                        const ang = (i / d.segments) * Math.PI * 2;
                        const rad = d.size/2 * (0.8 + Math.random() * 0.4);
                        ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
                    }
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.restore();
            });

            // Floor
            ctx.beginPath();
            ctx.moveTo(0, height);
            ctx.lineTo(0, floorPoints[0].y);
            for(let i = 1; i < floorPoints.length; i++) {
                ctx.lineTo(floorPoints[i].x, floorPoints[i].y);
            }
            ctx.lineTo(width, floorPoints[floorPoints.length-1].y);
            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fillStyle = '#0a0a1a';
            ctx.fill();
            ctx.restore();

            // Squid
            squid.update();
            squid.draw();

            requestAnimationFrame(draw);
        }

        window.addEventListener('resize', setup);
        setup();
        draw();
        
        // Fullscreen Logic
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