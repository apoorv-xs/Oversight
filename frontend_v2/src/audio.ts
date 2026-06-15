/**
 * Cyberpunk Programmatic Audio Engine.
 * Synthesizes cinematic audio effects on-the-fly using the Web Audio API.
 */
class CyberAudioEngine {
  private ctx: AudioContext | null = null;
  private humOsc1: OscillatorNode | null = null;
  private humOsc2: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  isEnabled: boolean = true;

  init(): void {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    this.ctx = new AudioContextClass();
  }

  toggleSound(): boolean {
    this.isEnabled = !this.isEnabled;
    if (!this.isEnabled) {
      this.stopHum();
    } else {
      this.startHum();
    }
    return this.isEnabled;
  }

  startHum(): void {
    if (!this.isEnabled) return;
    this.init();
    if (!this.ctx) return;
    if (this.humOsc1) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.humGain = this.ctx.createGain();
    this.humGain.gain.setValueAtTime(0.012, this.ctx.currentTime);

    this.humOsc1 = this.ctx.createOscillator();
    this.humOsc1.type = 'sine';
    this.humOsc1.frequency.setValueAtTime(55, this.ctx.currentTime);

    this.humOsc2 = this.ctx.createOscillator();
    this.humOsc2.type = 'triangle';
    this.humOsc2.frequency.setValueAtTime(110, this.ctx.currentTime);

    this.humOsc1.connect(this.humGain);
    this.humOsc2.connect(this.humGain);
    this.humGain.connect(this.ctx.destination);

    this.humOsc1.start();
    this.humOsc2.start();
  }

  stopHum(): void {
    if (this.humOsc1) {
      try { this.humOsc1.stop(); } catch { /* already stopped */ }
      this.humOsc1 = null;
    }
    if (this.humOsc2) {
      try { this.humOsc2.stop(); } catch { /* already stopped */ }
      this.humOsc2 = null;
    }
    if (this.humGain) {
      this.humGain.disconnect();
      this.humGain = null;
    }
  }

  playClick(): void {
    if (!this.isEnabled) return;
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.015);

    gain.gain.setValueAtTime(0.003, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.015);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.02);
  }

  playPing(): void {
    if (!this.isEnabled) return;
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(980, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.25);

    gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.35);
  }

  playAlarm(): void {
    if (!this.isEnabled) return;
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(130, this.ctx.currentTime + 0.4);

    gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.42);
  }

  playRadarSweep(): void {
    if (!this.isEnabled) return;
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 1.2);

    gain.gain.setValueAtTime(0.005, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 1.5);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 1.6);
  }
}

export const audio = new CyberAudioEngine();
