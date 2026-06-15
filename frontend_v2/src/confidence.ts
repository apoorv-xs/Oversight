import { state } from './state';

interface Particle {
  x: number;
  y: number;
  vy: number;
  jitterY: number;
  isAnomaly: boolean;
  isAmbient: boolean;
  alpha: number;
  hasLanded: boolean;
  driftPhase: number;
}

export class ConfidenceCurve {
  private canvas: HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D | null = null;
  particles: Particle[] = [];
  private isAnimating = false;
  private animationFrameId: number | null = null;
  private cssWidth = 0;
  private cssHeight = 0;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.resize();
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.canvas.parentElement!);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stop();
      } else {
        this.start();
      }
    });

    this.start();
  }

  private resize(): void {
    if (!this.canvas) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx!.scale(dpr, dpr);

    this.cssWidth = w;
    this.cssHeight = h;
  }

  start(): void {
    if (this.isAnimating) return;
    this.isAnimating = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.render();
  }

  stop(): void {
    this.isAnimating = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  addPacket(loss: number, threshold: number, isAnomaly: boolean): void {
    if (!this.canvas || !state.isCapturing) return;

    const w = this.cssWidth;
    const h = this.cssHeight;

    const safeThreshold = threshold || 0.03;
    let targetX = (loss / safeThreshold) * (w * 0.6);
    targetX = Math.max(5, Math.min(targetX, w - 5));

    const jitterY = (Math.random() - 0.5) * 8;

    this.particles.push({
      x: targetX,
      y: 0,
      jitterY,
      isAnomaly,
      isAmbient: false,
      alpha: 1.0,
      vy: 2.2 + Math.random() * 1.8,
      hasLanded: false,
      driftPhase: Math.random() * Math.PI * 2,
    });
  }

  private render(): void {
    if (!this.isAnimating || !this.ctx) return;

    const w = this.cssWidth;
    const h = this.cssHeight;

    this.ctx.clearRect(0, 0, w, h);

    const t = Date.now() * 0.001;
    const waveMu = w * 0.25 + Math.sin(t * 0.8) * (w * 0.015) + Math.cos(t * 0.3) * (w * 0.008);
    const waveAmp = h * 0.82 + Math.sin(t * 1.2) * (h * 0.02) + Math.cos(t * 0.5) * (h * 0.01);
    const sigma = w * 0.14 + Math.sin(t * 0.6) * (w * 0.006);

    // Spawn ambient particles
    if (state.isCapturing && Math.random() < 0.035) {
      const loss = Math.random() * 0.017;
      const safeThreshold = 0.03;
      let targetX = (loss / safeThreshold) * (w * 0.6);
      targetX = Math.max(5, Math.min(targetX, w - 5));
      const jitterY = (Math.random() - 0.5) * 8;

      this.particles.push({
        x: targetX,
        y: 0,
        vy: 0.8 + Math.random() * 1.0,
        jitterY,
        isAnomaly: false,
        isAmbient: true,
        alpha: 0.32 + Math.random() * 0.25,
        hasLanded: false,
        driftPhase: Math.random() * Math.PI * 2,
      });
    }

    // Background grid
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

    // Bell curve
    this.ctx.beginPath();
    this.ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 3) {
      const y = h - (waveAmp * Math.exp(-Math.pow(x - waveMu, 2) / (2 * Math.pow(sigma, 2))));
      this.ctx.lineTo(x, y);
    }
    this.ctx.lineTo(w, h);
    this.ctx.closePath();

    const gradient = this.ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(0, 230, 118, 0.22)');
    gradient.addColorStop(0.45, 'rgba(0, 230, 118, 0.04)');
    gradient.addColorStop(0.6, 'rgba(255, 179, 0, 0.08)');
    gradient.addColorStop(0.85, 'rgba(255, 42, 42, 0.25)');
    this.ctx.fillStyle = gradient;
    this.ctx.fill();

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    this.ctx.lineWidth = 1.2;
    this.ctx.stroke();

    // Threshold line
    const threshX = w * 0.6;
    this.ctx.beginPath();
    this.ctx.moveTo(threshX, 0);
    this.ctx.lineTo(threshX, h);
    this.ctx.strokeStyle = 'rgba(255, 179, 0, 0.45)';
    this.ctx.setLineDash([4, 4]);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.fillStyle = 'rgba(255, 179, 0, 0.7)';
    this.ctx.font = '8px "Inter", sans-serif';
    this.ctx.fillText('THRESHOLD', threshX + 6, 12);

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
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
        p.y = curveY;
        p.alpha -= p.isAmbient ? 0.0025 : 0.007;
      }

      if (p.alpha <= 0 || p.y > h + 10) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.beginPath();
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

export let confidenceViz: ConfidenceCurve | null = null;

export function initConfidenceCurve(): void {
  confidenceViz = new ConfidenceCurve('confidenceCanvas');
}
