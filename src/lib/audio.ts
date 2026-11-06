import { LOCALE_METADATA, TRANSLATIONS, type SupportedLocale } from './i18n';

/**
 * Procedural Web Audio synthesizer + multi-language voice announcer for NimTera.
 * - Generates local PCM / oscillator chimes so audio works deterministically even when browser TTS is unavailable.
 * - Uses BroadcastChannel / localStorage device election so only the designated active cashier tab announces events.
 * - Never announces on QR scan, Pay click, or pending tx; only on invoice creation ('payment_ready') and verified on-chain confirmation ('payment_confirmed').
 */

class CashierAudioEngine {
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private muted = false;
  private volume = 0.8;
  private voiceLocale: SupportedLocale = 'en';
  private isPrimaryDevice = true;
  private deviceId: string;
  private channel: BroadcastChannel | null = null;

  constructor() {
    this.deviceId = `nt_dev_${Math.random().toString(36).slice(2, 10)}`;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('nimtera_audio_coordination');
      this.channel.onmessage = (ev) => {
        if (ev.data?.type === 'CLAIM_PRIMARY' && ev.data?.deviceId !== this.deviceId) {
          this.isPrimaryDevice = false;
        }
      };
    }
  }

  public unlock(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.unlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  public claimPrimaryDevice() {
    this.isPrimaryDevice = true;
    this.channel?.postMessage({ type: 'CLAIM_PRIMARY', deviceId: this.deviceId });
  }

  public setConfig(opts: {
    muted?: boolean;
    volume?: number;
    voiceLocale?: SupportedLocale;
    isPrimaryDevice?: boolean;
  }) {
    if (opts.muted !== undefined) this.muted = opts.muted;
    if (opts.volume !== undefined) this.volume = Math.max(0, Math.min(1, opts.volume));
    if (opts.voiceLocale !== undefined) this.voiceLocale = opts.voiceLocale;
    if (opts.isPrimaryDevice !== undefined) {
      if (opts.isPrimaryDevice) this.claimPrimaryDevice();
      else this.isPrimaryDevice = false;
    }
  }

  public getStatus() {
    return {
      unlocked: this.unlocked,
      muted: this.muted,
      volume: this.volume,
      voiceLocale: this.voiceLocale,
      isPrimaryDevice: this.isPrimaryDevice,
      deviceId: this.deviceId,
    };
  }

  /**
   * Plays a warm two-tone harmonic chime when an order invoice is ready.
   */
  public playInvoiceReadyChime() {
    if (this.muted || !this.isPrimaryDevice) return;
    if (!this.unlocked) this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    this.playTone(523.25, now, 0.16, 'sine', 0.25 * this.volume); // C5
    this.playTone(659.25, now + 0.14, 0.28, 'triangle', 0.3 * this.volume); // E5
  }

  /**
   * Plays an ascending 3-note champagne bell chord when payment is verified on-chain.
   */
  public playPaymentConfirmedChime() {
    if (this.muted || !this.isPrimaryDevice) return;
    if (!this.unlocked) this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    this.playTone(587.33, now, 0.14, 'sine', 0.3 * this.volume); // D5
    this.playTone(739.99, now + 0.12, 0.16, 'sine', 0.32 * this.volume); // F#5
    this.playTone(880.0, now + 0.24, 0.42, 'triangle', 0.38 * this.volume); // A5
    this.playTone(1174.66, now + 0.32, 0.55, 'sine', 0.22 * this.volume); // D6
  }

  private playTone(
    freq: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    peakGain: number
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  public announcePaymentReady(amountFormatted: string, orderNumber: string, forceTest = false) {
    if (!forceTest && (this.muted || !this.isPrimaryDevice || !this.unlocked)) return;
    if (forceTest) this.unlock();
    this.playInvoiceReadyChime();
    const dict = TRANSLATIONS[this.voiceLocale] || TRANSLATIONS.en;
    const phrase = dict.voicePaymentReadyTemplate(amountFormatted, orderNumber);
    this.speakPhrase(phrase, this.voiceLocale);
  }

  public announcePaymentConfirmed(amountFormatted: string, orderNumber: string, forceTest = false) {
    if (!forceTest && (this.muted || !this.isPrimaryDevice || !this.unlocked)) return;
    if (forceTest) this.unlock();
    this.playPaymentConfirmedChime();
    const dict = TRANSLATIONS[this.voiceLocale] || TRANSLATIONS.en;
    const phrase = dict.voicePaymentConfirmedTemplate(amountFormatted, orderNumber);
    this.speakPhrase(phrase, this.voiceLocale);
  }

  private speakPhrase(text: string, locale: SupportedLocale) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = LOCALE_METADATA[locale]?.speechLang || 'en-US';
      utter.volume = this.volume;
      utter.rate = 0.98;
      window.speechSynthesis.speak(utter);
    } catch {
      // Synthesized Web Audio chime already played as deterministic local audio
    }
  }
}

export const cashierAudio = new CashierAudioEngine();
