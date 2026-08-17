/**
 * Sound + haptic feedback for NOT10. Every sound is synthesized with the
 * Web Audio API (short oscillator tones with an envelope) - no audio
 * files, keeping the app self-contained like everything else here.
 * Muting persists to localStorage. Haptics use navigator.vibrate where
 * available (mobile only; silently a no-op elsewhere).
 */
import * as storage from './storage.js';

let ctx = null;
let muted = storage.getSoundMuted();

function getContext() {
    if (!ctx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        ctx = new AudioContextClass();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

/**
 * Play one or more short tones in sequence.
 * @param {Array<{freq: number, duration: number, type?: OscillatorType, gain?: number, delay?: number}>} notes
 */
function tones(notes) {
    if (muted) return;
    const audioCtx = getContext();
    if (!audioCtx) return;

    let startAt = audioCtx.currentTime;
    for (const note of notes) {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.type = note.type || 'sine';
        osc.frequency.value = note.freq;

        const t0 = startAt + (note.delay || 0);
        const peak = note.gain ?? 0.15;
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(peak, t0 + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + note.duration);

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + note.duration + 0.02);
    }
}

function vibrate(pattern) {
    if (muted) return;
    navigator.vibrate?.(pattern);
}

export function isMuted() {
    return muted;
}

export function setMuted(value) {
    muted = !!value;
    storage.saveSoundMuted(muted);
}

export function toggleMuted() {
    setMuted(!muted);
    return muted;
}

// A soft, low click - placing/raising a bet.
export function playBet() {
    tones([{ freq: 320, duration: 0.08, type: 'triangle', gain: 0.12 }]);
}

// A confident two-note confirm - call or finalize.
export function playConfirm() {
    tones([
        { freq: 440, duration: 0.08, type: 'sine', gain: 0.12 },
        { freq: 660, duration: 0.1, type: 'sine', gain: 0.14, delay: 0.07 }
    ]);
}

// A bigger, tenser stack of notes - going all-in.
export function playAllIn() {
    tones([
        { freq: 220, duration: 0.12, type: 'sawtooth', gain: 0.1 },
        { freq: 330, duration: 0.14, type: 'sawtooth', gain: 0.12, delay: 0.08 },
        { freq: 440, duration: 0.18, type: 'sawtooth', gain: 0.14, delay: 0.16 }
    ]);
    vibrate([15, 30, 15]);
}

// A short, dry percussive tap - a card landing on the table.
export function playCard() {
    tones([{ freq: 180, duration: 0.06, type: 'square', gain: 0.08 }]);
}

// The bust/reveal "money moment" - a hard downward sting.
export function playBust() {
    tones([
        { freq: 300, duration: 0.15, type: 'sawtooth', gain: 0.16 },
        { freq: 160, duration: 0.28, type: 'sawtooth', gain: 0.18, delay: 0.1 }
    ]);
    vibrate([40, 40, 80]);
}

// Winning a round's pot / the game - a bright rising chime.
export function playWin() {
    tones([
        { freq: 523, duration: 0.12, type: 'sine', gain: 0.14 },
        { freq: 659, duration: 0.12, type: 'sine', gain: 0.14, delay: 0.1 },
        { freq: 784, duration: 0.22, type: 'sine', gain: 0.16, delay: 0.2 }
    ]);
    vibrate([20, 20, 20, 20, 60]);
}

// The game ended and it wasn't you - a plain, neutral descending tone.
// Not harsh like a bust, not triumphant like playWin(), just enough that
// the end-of-game moment isn't silent for everyone except the winner.
export function playGameOver() {
    tones([
        { freq: 392, duration: 0.14, type: 'sine', gain: 0.12 },
        { freq: 330, duration: 0.22, type: 'sine', gain: 0.12, delay: 0.12 }
    ]);
}
