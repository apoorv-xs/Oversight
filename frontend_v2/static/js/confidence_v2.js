import { state } from './state_v2.js';

export class ConfidenceCurve {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.isAnimating = false;
        this.animationFrameId = null;
        
        this.resize();
        this.resizeObserver = new ResizeObserver(() => {
            // Prevent immediate render bugs on resize by debouncing or just updating dimensions
            this.resize();
        });
        this.resizeObserver.observe(this.canvas.parentElement);

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stop();
            } else {
                this.start();
            }
        });

        this.start();
    }

    resize() {
        if (!this.canvas) return;
        
        // Get the actual physical space the canvas takes up in the DOM, not the parent
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        
        // If height is 0 (display: none), don't break
        if (w === 0 || h === 0) return;

        // High DPI canvas rendering
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.ctx.scale(dpr, dpr);
        
        this.cssWidth = w;
        this.cssHeight = h;
    }

    start() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.render();
    }

    stop() {
        this.isAnimating = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    addPacket(loss, threshold, isAnomaly) {
        if (!this.canvas || !state.isCapturing) return;
        
        // threshold is dynamic from the model, but usually ~0.02 to 0.04.
        // We map the X axis such that the threshold line sits at exactly 60% of the canvas width.
        const w = this.cssWidth;
        const h = this.cssHeight;
        
        let safeThreshold = threshold || 0.03; // fallback if not loaded
        let targetX = (loss / safeThreshold) * (w * 0.6);
        
        // Clamp to edges so dots don't fly off screen
        targetX = Math.max(5, Math.min(targetX, w - 5));

        const jitterY = (Math.random() - 0.5) * 8; // Random scattering on the curve Y-axis

        this.particles.push({
            x: targetX,
            y: 0,             // Start falling from the top of the canvas!
            jitterY: jitterY,
            isAnomaly: isAnomaly,
            isAmbient: false,
            alpha: 1.0,       // Solid and highly visible
            vy: 2.2 + Math.random() * 1.8, // Energetic falling speed
            hasLanded: false,
            driftPhase: Math.random() * Math.PI * 2
        });
    }

    render() {
        if (!this.isAnimating || !this.ctx) return;
        
        const w = this.cssWidth;
        const h = this.cssHeight;

        this.ctx.clearRect(0, 0, w, h);

        const t = Date.now() * 0.001;
        // Breathing parameters overlaying multiple frequencies for organic drift
        const waveMu = w * 0.25 + Math.sin(t * 0.8) * (w * 0.015) + Math.cos(t * 0.3) * (w * 0.008);
        const waveAmp = h * 0.82 + Math.sin(t * 1.2) * (h * 0.02) + Math.cos(t * 0.5) * (h * 0.01);
        const sigma = w * 0.14 + Math.sin(t * 0.6) * (w * 0.006);

        // Spawn subtle ambient network noise particles to keep the graph dynamic (only when engine is running)
        if (state.isCapturing && Math.random() < 0.035) {
            const isAnomaly = false; // strictly safe to avoid false warning confusion!
            const loss = Math.random() * 0.017; // Kept strictly inside safe region
            const safeThreshold = 0.03;
            
            let targetX = (loss / safeThreshold) * (w * 0.6);
            targetX = Math.max(5, Math.min(targetX, w - 5));
            
            const jitterY = (Math.random() - 0.5) * 8;
            
            this.particles.push({
                x: targetX,
                y: 0,
                vy: 0.8 + Math.random() * 1.0, // Ambient particles fall gentler and more floaty
                jitterY: jitterY,
                isAnomaly: isAnomaly,
                isAmbient: true,
                alpha: 0.32 + Math.random() * 0.25, // Prominent translucent particles
                hasLanded: false,
                driftPhase: Math.random() * Math.PI * 2
            });
        }

        // Draw background grid lines (tactical vector style)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        this.ctx.lineWidth = 0.5;
        this.ctx.setLineDash([2, 8]);
        for (let gy = 20; gy < h; gy += 20) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, gy);
            this.ctx.lineTo(w, gy);
            this.ctx.stroke();
        }
        this.ctx.setLineDash([]);

        // Draw Bell Curve (Normal Distribution)
        this.ctx.beginPath();
        this.ctx.moveTo(0, h); // Start at bottom left
        
        for (let x = 0; x <= w; x += 3) {
            const y = h - (waveAmp * Math.exp(-Math.pow(x - waveMu, 2) / (2 * Math.pow(sigma, 2))));
            this.ctx.lineTo(x, y);
        }
        this.ctx.lineTo(w, h); // End at bottom right
        this.ctx.closePath();

        // Gradient for curve body
        const gradient = this.ctx.createLinearGradient(0, 0, w, 0);
        gradient.addColorStop(0, 'rgba(0, 230, 118, 0.22)'); // Safe (Green)
        gradient.addColorStop(0.45, 'rgba(0, 230, 118, 0.04)'); // Safe tail
        gradient.addColorStop(0.6, 'rgba(255, 179, 0, 0.08)'); // Threshold warning
        gradient.addColorStop(0.85, 'rgba(255, 42, 42, 0.25)'); // Danger (Red)

        this.ctx.fillStyle = gradient;
        this.ctx.fill();

        // Stroke for the curve line
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        this.ctx.lineWidth = 1.2;
        this.ctx.stroke();

        // Draw Dynamic Threshold Line
        const threshX = w * 0.6;
        this.ctx.beginPath();
        this.ctx.moveTo(threshX, 0);
        this.ctx.lineTo(threshX, h);
        this.ctx.strokeStyle = 'rgba(255, 179, 0, 0.45)';
        this.ctx.setLineDash([4, 4]);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        
        // Threshold Label
        this.ctx.fillStyle = 'rgba(255, 179, 0, 0.7)';
        this.ctx.font = '8px "Inter", sans-serif';
        this.ctx.fillText('THRESHOLD', threshX + 6, 12);

        // Render falling particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            
            // Dynamic curve Y coordinate at the particle's X position matching the breathing parameters
            const curveY = h - (waveAmp * Math.exp(-Math.pow(p.x - waveMu, 2) / (2 * Math.pow(sigma, 2)))) + p.jitterY;
            
            if (!p.hasLanded) {
                p.y += p.vy;
                p.x += Math.sin(p.y * 0.06 + p.driftPhase) * 0.25;
                p.x = Math.max(2, Math.min(p.x, w - 2));
                if (p.y >= curveY) {
                    p.y = curveY;
                    p.hasLanded = true;
                }
            } else {
                p.y = curveY; // Ride the breathing curve wave!
                p.alpha -= p.isAmbient ? 0.0025 : 0.007; // Much slower decay for resting particles
            }

            // Remove dead particles
            if (p.alpha <= 0 || p.y > h + 10) {
                this.particles.splice(i, 1);
                continue;
            }

            this.ctx.beginPath();
            // Substantially increased particle sizes for pristine visibility
            const radius = p.isAmbient
                ? (p.isAnomaly ? 2.2 : 1.6)
                : (p.isAnomaly ? (p.hasLanded ? 3.5 : 4.5) : (p.hasLanded ? 2.0 : 3.0));
            this.ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            
            if (p.isAnomaly) {
                this.ctx.fillStyle = `rgba(255, 42, 42, ${p.alpha})`;
                this.ctx.shadowBlur = p.isAmbient ? 4 : (p.hasLanded ? 6 : 12);
                this.ctx.shadowColor = '#ff2a2a';
            } else {
                this.ctx.fillStyle = `rgba(0, 230, 118, ${p.alpha})`;
                this.ctx.shadowBlur = p.isAmbient ? 3 : (p.hasLanded ? 4 : 8);
                this.ctx.shadowColor = '#00e676';
            }
            
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
        }

        this.animationFrameId = requestAnimationFrame(() => this.render());
    }
}

export let confidenceViz = null;
export function initConfidenceCurve() {
    confidenceViz = new ConfidenceCurve('confidenceCanvas');
}
