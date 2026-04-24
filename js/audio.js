import { state, noteToSliceIndex } from './state.js';

let ctx = null;
let masterGain = null;

export function getCtx() {
    if (!ctx) {
        ctx = new AudioContext();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.9;
        masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

export function getMaster() {
    getCtx();
    return masterGain;
}

// Build a sub-buffer for one slice (optionally reversed)
export function extractSliceBuffer(sliceIndex, reverse = false) {
    const ac = getCtx();
    const buf = state.audioBuffer;
    if (!buf || !state.slices[sliceIndex]) return null;

    const { start, end } = state.slices[sliceIndex];
    const len = end - start;
    if (len <= 0) return null;

    const out = ac.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch).subarray(start, end);
        const dst = out.getChannelData(ch);
        if (reverse) {
            for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i];
        } else {
            dst.set(src);
        }
    }
    return out;
}

// Play a single slice with options; returns scheduled source node
export function playSlice(sliceIndex, opts = {}, startTime = 0) {
    const { vol = 1, pitchSemi = 0, reverse = false } = opts;
    const ac = getCtx();
    const sliceBuf = extractSliceBuffer(sliceIndex, reverse);
    if (!sliceBuf) return null;

    const src = ac.createBufferSource();
    src.buffer = sliceBuf;
    src.playbackRate.value = Math.pow(2, pitchSemi / 12);

    const gain = ac.createGain();
    gain.gain.value = Math.max(0, Math.min(2, vol));

    src.connect(gain);
    gain.connect(masterGain);
    src.start(startTime);
    return src;
}

// Schedule a tracker cell for playback at audioCtx time `time`
export function scheduleCell(cell, stepDuration, audioTime) {
    if (!cell || !cell.note) return;
    const sliceIdx = noteToSliceIndex(cell.note);
    if (sliceIdx < 0 || sliceIdx >= state.slices.length) return;

    const vol = (cell.vol ?? 0xff) / 0xff;
    let pitchSemi = 0;
    let reverse = false;
    let retrigger = 0;

    if (cell.fx) {
        const fx = cell.fx;
        if (fx.type === 'P') pitchSemi = fx.value;
        if (fx.type === 'B') reverse = true;
        if (fx.type === 'R') retrigger = Math.max(1, fx.value);
    }

    if (retrigger > 1) {
        const interval = stepDuration / retrigger;
        for (let i = 0; i < retrigger; i++) {
            playSlice(sliceIdx, { vol, pitchSemi, reverse }, audioTime + i * interval);
        }
    } else {
        playSlice(sliceIdx, { vol, pitchSemi, reverse }, audioTime);
    }
}

// Preview a single slice immediately (for click-preview)
export function previewSlice(sliceIndex) {
    const ac = getCtx();
    playSlice(sliceIndex, { vol: 1 }, ac.currentTime);
}
