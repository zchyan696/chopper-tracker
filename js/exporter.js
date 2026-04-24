import { state, noteToSliceIndex } from './state.js';
import { extractSliceBuffer, getCtx } from './audio.js';

// Render the full pattern offline and return a WAV Blob
export async function exportWav() {
    if (!state.audioBuffer || !state.slices.length) {
        throw new Error('No sample or slices loaded.');
    }

    const sr = state.audioBuffer.sampleRate;
    const stepDur = 60 / (state.bpm * state.lpb);
    const totalDur = stepDur * state.numSteps + 2; // +2s tail
    const totalFrames = Math.ceil(totalDur * sr);

    const offlineCtx = new OfflineAudioContext(2, totalFrames, sr);
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(offlineCtx.destination);

    // Re-extract slices into the offline context
    function extractOffline(sliceIndex, reverse) {
        const buf = state.audioBuffer;
        const sl  = state.slices[sliceIndex];
        if (!sl) return null;
        const len = sl.end - sl.start;
        if (len <= 0) return null;

        const out = offlineCtx.createBuffer(buf.numberOfChannels, len, sr);
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const src = buf.getChannelData(ch).subarray(sl.start, sl.end);
            const dst = out.getChannelData(ch);
            if (reverse) {
                for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i];
            } else {
                dst.set(src);
            }
        }
        return out;
    }

    for (let s = 0; s < state.numSteps; s++) {
        const time = s * stepDur;
        for (let t = 0; t < state.numTracks; t++) {
            const cell = state.pattern[s]?.[t];
            if (!cell?.note) continue;
            const si = noteToSliceIndex(cell.note);
            if (si < 0 || si >= state.slices.length) continue;

            const vol      = (cell.vol ?? 0xff) / 0xff;
            let pitchSemi  = 0;
            let reverse    = false;
            let retrigger  = 1;

            if (cell.fx) {
                if (cell.fx.type === 'P') pitchSemi = cell.fx.value;
                if (cell.fx.type === 'B') reverse   = true;
                if (cell.fx.type === 'R') retrigger  = Math.max(1, cell.fx.value);
            }

            const scheduleAt = (startTime) => {
                const sbuf = extractOffline(si, reverse);
                if (!sbuf) return;
                const src  = offlineCtx.createBufferSource();
                src.buffer = sbuf;
                src.playbackRate.value = Math.pow(2, pitchSemi / 12);
                const gain = offlineCtx.createGain();
                gain.gain.value = Math.max(0, Math.min(2, vol));
                src.connect(gain);
                gain.connect(masterGain);
                src.start(startTime);
            };

            if (retrigger > 1) {
                const interval = stepDur / retrigger;
                for (let i = 0; i < retrigger; i++) scheduleAt(time + i * interval);
            } else {
                scheduleAt(time);
            }
        }
    }

    const rendered = await offlineCtx.startRendering();
    return audioBufferToWav(rendered);
}

function audioBufferToWav(buf) {
    const numCh  = buf.numberOfChannels;
    const sr     = buf.sampleRate;
    const len    = buf.length;
    const bytesPerSample = 2;
    const blockAlign     = numCh * bytesPerSample;
    const byteRate       = sr * blockAlign;
    const dataSize       = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);

    function writeStr(off, s) {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let off = 44;
    for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < numCh; ch++) {
            const s = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i]));
            view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            off += 2;
        }
    }

    return new Blob([ab], { type: 'audio/wav' });
}
