export class HeartbeatMonitor {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        
        this.ctx = this.canvas.getContext('2d');
        this.history = [];
        this.maxPoints = 150;
        this.isAnimating = false;
        this.animationFrameId = null;
        
        // Initialize history with 0s
        for (let i = 0; i < this.maxPoints; i++) {
            this.history.push({ value: 0, isAnomaly: false });
        }
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
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
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
    }

    pulse(amplitude = 1, isAnomaly = false) {
        // Find the most recent point (at the right edge) and add amplitude
        const lastIdx = this.history.length - 1;
        
        // Smoothly combine if multiple packets hit in the same frame
        this.history[lastIdx].value = Math.min(this.history[lastIdx].value + amplitude, 1.5); 
        if (isAnomaly) {
            this.history[lastIdx].isAnomaly = true;
        }
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

    render() {
        if (!this.isAnimating || !this.ctx) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const baseline = h * 0.75; // 75% down the canvas
        const step = w / (this.maxPoints - 1);

        // Advance history (scroll left)
        this.history.shift();
        
        // Create subtle idle pulse (baseline noise)
        const idleNoise = (Math.random() - 0.5) * 0.05;
        this.history.push({ value: idleNoise, isAnomaly: false });

        // Clear canvas
        this.ctx.clearRect(0, 0, w, h);

        // Draw grid lines
        this.ctx.strokeStyle = 'rgba(0, 230, 118, 0.03)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for (let y = 0; y < h; y += 10) {
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(w, y);
        }
        for (let x = 0; x < w; x += 10) {
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, h);
        }
        this.ctx.stroke();

        // Draw baseline
        this.ctx.strokeStyle = 'rgba(0, 230, 118, 0.15)';
        this.ctx.beginPath();
        this.ctx.moveTo(0, baseline);
        this.ctx.lineTo(w, baseline);
        this.ctx.stroke();

        // Draw Heartbeat
        this.ctx.beginPath();
        
        let hasRecentAnomaly = false;

        for (let i = 0; i < this.history.length; i++) {
            const point = this.history[i];
            const x = i * step;
            
            // value is generally 0 to 1+. Map it to height.
            let y = baseline - (point.value * (h * 0.6));
            
            // Constrain y
            y = Math.max(5, Math.min(y, h - 5));

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                // Smooth curve
                const prevX = (i - 1) * step;
                const prevPoint = this.history[i - 1];
                let prevY = baseline - (prevPoint.value * (h * 0.6));
                prevY = Math.max(5, Math.min(prevY, h - 5));
                
                const cx = (x + prevX) / 2;
                this.ctx.quadraticCurveTo(cx, prevY, x, y);
            }

            if (point.isAnomaly) hasRecentAnomaly = true;
        }

        // Stroke styling based on current state
        if (hasRecentAnomaly) {
            this.ctx.strokeStyle = '#ff2a2a'; // Danger Red
            this.ctx.lineWidth = 2.5;
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = '#ff2a2a';
        } else {
            this.ctx.strokeStyle = '#00e676'; // Safe Matrix Green
            this.ctx.lineWidth = 1.5;
            this.ctx.shadowBlur = 6;
            this.ctx.shadowColor = '#00e676';
        }

        this.ctx.stroke();
        
        // Reset shadow for next frame
        this.ctx.shadowBlur = 0;

        this.animationFrameId = requestAnimationFrame(() => this.render());
    }
}

// Global instance
export let heartbeatViz = null;

export function initHeartbeat() {
    heartbeatViz = new HeartbeatMonitor('heartbeatCanvas');
}
