/**
 * Cyberpunk Programmatic Audio Engine.
 * Synthesizes cinematic audio effects on-the-fly using the Web Audio API.
 * Bypasses the need for large asset downloads.
 */
class CyberAudioEngine {
    constructor() {
        this.ctx = null;
        this.humOsc1 = null;
        this.humOsc2 = null;
        this.humGain = null;
        this.isEnabled = true;
    }

    init() {
        if (this.ctx) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.ctx = new AudioContext();
    }

    toggleSound() {
        this.isEnabled = !this.isEnabled;
        if (!this.isEnabled) {
            this.stopHum();
        } else {
            this.startHum();
        }
        return this.isEnabled;
    }

    startHum() {
        if (!this.isEnabled) return;
        this.init();
        if (!this.ctx) return;
        if (this.humOsc1) return;

        // Resume if suspended (browser security policy)
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.humGain = this.ctx.createGain();
        this.humGain.gain.setValueAtTime(0.012, this.ctx.currentTime); // Low backdrop level

        this.humOsc1 = this.ctx.createOscillator();
        this.humOsc1.type = 'sine';
        this.humOsc1.frequency.setValueAtTime(55, this.ctx.currentTime); // A1 note

        this.humOsc2 = this.ctx.createOscillator();
        this.humOsc2.type = 'triangle';
        this.humOsc2.frequency.setValueAtTime(110, this.ctx.currentTime); // A2 note harmonics

        this.humOsc1.connect(this.humGain);
        this.humOsc2.connect(this.humGain);
        this.humGain.connect(this.ctx.destination);

        this.humOsc1.start();
        this.humOsc2.start();
    }

    stopHum() {
        if (this.humOsc1) {
            try { this.humOsc1.stop(); } catch(e){}
            this.humOsc1 = null;
        }
        if (this.humOsc2) {
            try { this.humOsc2.stop(); } catch(e){}
            this.humOsc2 = null;
        }
        if (this.humGain) {
            this.humGain.disconnect();
            this.humGain = null;
        }
    }

    playClick() {
        if (!this.isEnabled) return;
        this.init();
        if (!this.ctx || this.ctx.state === 'suspended') return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Ultra high pitch click
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

    playPing() {
        if (!this.isEnabled) return;
        this.init();
        if (!this.ctx || this.ctx.state === 'suspended') return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Cybernetic sonar sweep
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

    playAlarm() {
        if (!this.isEnabled) return;
        this.init();
        if (!this.ctx || this.ctx.state === 'suspended') return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Harsh warning sweep
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

    playRadarSweep() {
        if (!this.isEnabled) return;
        this.init();
        if (!this.ctx || this.ctx.state === 'suspended') return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Ultra soft low frequency resonant sonar pulse
        osc.type = 'sine';
        osc.frequency.setValueAtTime(380, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 1.2);

        // Faint backdrop sweep level
        gain.gain.setValueAtTime(0.005, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 1.5);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 1.6);
    }
}

export const audio = new CyberAudioEngine();
window.audioEngine = audio; // Expose globally for diagnostics
