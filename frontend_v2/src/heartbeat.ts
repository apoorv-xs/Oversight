import { state } from './state';

export class HeartbeatMonitor {
  private canvas: HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D | null = null;
  private history: { value: number; isAnomaly: boolean }[] = [];
  private maxPoints = 150;
  private isAnimating = false;
  private animationFrameId: number | null = null;
  private canvasWidth = 0;
  private canvasHeight = 0;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');

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

  resize(): void {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.canvasWidth = rect.width;
    this.canvasHeight = rect.height;
  }

  pulse(amplitude = 1, isAnomaly = false): void {
    const lastIdx = this.history.length - 1;
    this.history[lastIdx].value = Math.min(this.history[lastIdx].value + amplitude, 1.5);
    if (isAnomaly) {
      this.history[lastIdx].isAnomaly = true;
    }
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

  private render(): void {
    if (!this.isAnimating || !this.ctx) return;

    const w = this.canvasWidth;
    const h = this.canvasHeight;
    const baseline = h * 0.75;
    const step = w / (this.maxPoints - 1);

    this.history.shift();
    const idleNoise = (Math.random() - 0.5) * 0.05;
    this.history.push({ value: idleNoise, isAnomaly: false });

    this.ctx.clearRect(0, 0, w, h);

    // Grid
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

    // Baseline
    this.ctx.strokeStyle = 'rgba(0, 230, 118, 0.15)';
    this.ctx.beginPath();
    this.ctx.moveTo(0, baseline);
    this.ctx.lineTo(w, baseline);
    this.ctx.stroke();

    // Heartbeat
    this.ctx.beginPath();
    let hasRecentAnomaly = false;

    for (let i = 0; i < this.history.length; i++) {
      const point = this.history[i];
      const x = i * step;
      let y = baseline - (point.value * (h * 0.6));
      y = Math.max(5, Math.min(y, h - 5));

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        const prevX = (i - 1) * step;
        const prevY = Math.max(5, Math.min(baseline - (this.history[i - 1].value * (h * 0.6)), h - 5));
        const cx = (x + prevX) / 2;
        this.ctx.quadraticCurveTo(cx, prevY, x, y);
      }

      if (point.isAnomaly) hasRecentAnomaly = true;
    }

    if (hasRecentAnomaly) {
      this.ctx.strokeStyle = '#ff2a2a';
      this.ctx.lineWidth = 2.5;
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = '#ff2a2a';
    } else {
      this.ctx.strokeStyle = '#00e676';
      this.ctx.lineWidth = 1.5;
      this.ctx.shadowBlur = 6;
      this.ctx.shadowColor = '#00e676';
    }
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;

    this.animationFrameId = requestAnimationFrame(() => this.render());
  }
}

export let heartbeatViz: HeartbeatMonitor | null = null;

export function initHeartbeat(): void {
  heartbeatViz = new HeartbeatMonitor('heartbeatCanvas');
}
