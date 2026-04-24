import { state } from './state.js';
import { addManualSlice } from './slicer.js';
import { previewSlice } from './audio.js';

let canvas, ctx2d, onSliceUpdate;

export function init(onUpdate) {
    onSliceUpdate = onUpdate;
    canvas = document.getElementById('waveform');
    ctx2d  = canvas.getContext('2d');

    canvas.addEventListener('click', e => {
        if (!state.audioBuffer) return;
        const rect = canvas.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / rect.width;
        addManualSlice(nx);
        draw();
        if (onSliceUpdate) onSliceUpdate();
    });

    canvas.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!state.audioBuffer || !state.slices.length) return;
        // right-click: preview nearest slice
        const rect = canvas.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / rect.width;
        const frame = Math.floor(nx * state.audioBuffer.length);
        let nearest = 0, minDist = Infinity;
        state.slices.forEach((sl, i) => {
            const dist = Math.abs(sl.start - frame);
            if (dist < minDist) { minDist = dist; nearest = i; }
        });
        previewSlice(nearest);
    });

    draw();
}

export function draw() {
    const W = canvas.width  = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;
    ctx2d.clearRect(0, 0, W, H);

    ctx2d.fillStyle = '#0a0a0a';
    ctx2d.fillRect(0, 0, W, H);

    if (!state.audioBuffer) {
        ctx2d.fillStyle = '#222';
        ctx2d.font = '10px Courier New';
        ctx2d.textAlign = 'center';
        ctx2d.fillText('no sample', W / 2, H / 2);
        return;
    }

    const data   = state.audioBuffer.getChannelData(0);
    const total  = data.length;
    const mid    = H / 2;
    const stride = Math.max(1, Math.floor(total / W));

    // Waveform
    ctx2d.beginPath();
    ctx2d.strokeStyle = '#2a5a8a';
    ctx2d.lineWidth = 1;

    for (let px = 0; px < W; px++) {
        const i0 = Math.floor((px / W) * total);
        let mn = 0, mx = 0;
        for (let k = 0; k < stride; k++) {
            const v = data[i0 + k] ?? 0;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        ctx2d.moveTo(px, mid + mn * mid * 0.95);
        ctx2d.lineTo(px, mid + mx * mid * 0.95);
    }
    ctx2d.stroke();

    // Slice markers
    state.slices.forEach((sl, i) => {
        const x = (sl.start / total) * W;
        ctx2d.strokeStyle = i === 0 ? '#555' : '#4a90d9';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(x, 0);
        ctx2d.lineTo(x, H);
        ctx2d.stroke();

        // slice number label
        if (i < 32) {
            ctx2d.fillStyle = '#4a90d9';
            ctx2d.font = '9px Courier New';
            ctx2d.textAlign = 'left';
            ctx2d.fillText(i.toString(16).toUpperCase(), x + 2, 10);
        }
    });
}

export function buildLegend() {
    const legend = document.getElementById('slice-legend');
    legend.innerHTML = '';

    const total = state.audioBuffer?.length ?? 1;

    state.slices.forEach((sl, i) => {
        const div = document.createElement('div');
        div.className = 'slice-item';
        div.title = `click to preview`;

        const noteSpan = document.createElement('span');
        noteSpan.className = 'slice-note';
        noteSpan.textContent = sl.note;

        const bar = document.createElement('div');
        bar.className = 'slice-bar';
        const fill = document.createElement('div');
        fill.className = 'slice-bar-fill';
        fill.style.width = `${((sl.end - sl.start) / total) * 100}%`;
        bar.appendChild(fill);

        div.appendChild(noteSpan);
        div.appendChild(bar);
        div.addEventListener('click', () => previewSlice(i));
        legend.appendChild(div);
    });
}
