import { state, sliceIndexToNote } from './state.js';

// Detect transient onsets in buffer channel 0.
// Returns array of sample frame positions (including 0).
export function detectTransients(buffer, sensitivity = 5) {
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;

    // window ~10ms
    const winSize = Math.max(64, Math.floor(sr * 0.010));
    const threshold = 1 + (10 - sensitivity) * 0.4; // ratio of RMS increase

    const points = [0];
    let prevRms = 0;
    // minimum gap between slices: ~30ms
    const minGap = Math.floor(sr * 0.030);
    let lastPoint = 0;

    for (let i = 0; i < data.length - winSize; i += winSize) {
        let sum = 0;
        for (let j = i; j < i + winSize; j++) sum += data[j] * data[j];
        const rms = Math.sqrt(sum / winSize);

        if (prevRms > 0.001 && rms / prevRms > threshold && i - lastPoint >= minGap) {
            points.push(i);
            lastPoint = i;
        }
        prevRms = rms;
    }

    return points;
}

// Build state.slices from an array of frame positions
export function buildSlices(framePositions, totalFrames) {
    const pts = [...new Set(framePositions)].sort((a, b) => a - b);
    state.slices = pts.map((start, i) => ({
        start,
        end: pts[i + 1] ?? totalFrames,
        note: sliceIndexToNote(i),
    }));
}

// Add a manual slice at a normalized x position (0-1) in the buffer
export function addManualSlice(normX) {
    if (!state.audioBuffer) return;
    const frame = Math.floor(normX * state.audioBuffer.length);
    const existing = state.slices.map(s => s.start);
    if (existing.includes(frame)) return;
    existing.push(frame);
    buildSlices(existing, state.audioBuffer.length);
}

export function clearSlices() {
    state.slices = [];
}
