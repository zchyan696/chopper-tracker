import { state, makePattern } from './state.js';
import { getCtx }             from './audio.js';
import { detectTransients, buildSlices, clearSlices } from './slicer.js';
import { play, stop, isPlaying } from './sequencer.js';
import { buildTable, highlightPlayStep, init as initTracker } from './tracker-ui.js';
import { init as initWaveform, draw as drawWaveform, buildLegend } from './waveform-ui.js';
import { exportWav } from './exporter.js';
import { KitsBrowser } from './kits.js';

// ── INIT ────────────────────────────────────────────────────────
initTracker(null);
initWaveform(onSliceUpdate);
buildTable();

// ── TABS ─────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    });
});

// ── KITS BROWSER ─────────────────────────────────────────────────
const kits = new KitsBrowser({
    onLoad: async (file) => {
        await loadFile(file);
        // Switch to sample tab to show the loaded sample
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        document.querySelector('.tab-btn[data-tab="sample"]').classList.add('active');
        document.getElementById('tab-sample').classList.remove('hidden');
    },
});
kits.mount();

// ── BPM / LPB / STEPS / TRACKS ──────────────────────────────────
document.getElementById('bpm').addEventListener('change', e => {
    state.bpm = parseInt(e.target.value) || 174;
});
document.getElementById('lpb').addEventListener('change', e => {
    state.lpb = parseInt(e.target.value) || 4;
    // Rebuild to refresh beat row highlighting
    state.pattern = makePattern(state.numSteps, state.numTracks);
    buildTable();
});
document.getElementById('steps').addEventListener('change', e => {
    state.numSteps = parseInt(e.target.value);
    state.pattern  = makePattern(state.numSteps, state.numTracks);
    buildTable();
});
document.getElementById('num-tracks').addEventListener('change', e => {
    state.numTracks = parseInt(e.target.value);
    state.pattern   = makePattern(state.numSteps, state.numTracks);
    buildTable();
});

// ── PLAY / STOP ──────────────────────────────────────────────────
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');

btnPlay.addEventListener('click', () => {
    getCtx(); // unlock audio
    if (isPlaying()) { stop(); setPlayUI(false); return; }
    play(step => highlightPlayStep(step));
    setPlayUI(true);
});

btnStop.addEventListener('click', () => {
    stop();
    setPlayUI(false);
    highlightPlayStep(-1);
});

function setPlayUI(active) {
    btnPlay.classList.toggle('active', active);
    btnPlay.textContent = active ? '■ STOP' : '▶ PLAY';
}

// ── SAMPLE LOADING ───────────────────────────────────────────────
const dropzone  = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
});

fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadFile(file);
});

async function loadFile(file) {
    const ac = getCtx();
    document.getElementById('sample-name').textContent = file.name;
    const ab = await file.arrayBuffer();
    state.audioBuffer = await ac.decodeAudioData(ab);

    document.getElementById('btn-auto-slice').disabled  = false;
    document.getElementById('btn-clear-slices').disabled = false;

    // Auto-slice on load
    autoSlice();
}

// ── SLICER ───────────────────────────────────────────────────────
const sensitivityInput = document.getElementById('sensitivity');
const sensVal          = document.getElementById('sens-val');

sensitivityInput.addEventListener('input', e => {
    sensVal.textContent = e.target.value;
});

document.getElementById('btn-auto-slice').addEventListener('click', autoSlice);
document.getElementById('btn-clear-slices').addEventListener('click', () => {
    clearSlices();
    drawWaveform();
    buildLegend();
    updateSliceCount();
});

function autoSlice() {
    if (!state.audioBuffer) return;
    const sens   = parseInt(sensitivityInput.value);
    const points = detectTransients(state.audioBuffer, sens);
    buildSlices(points, state.audioBuffer.length);
    onSliceUpdate();
}

function onSliceUpdate() {
    drawWaveform();
    buildLegend();
    updateSliceCount();
}

function updateSliceCount() {
    const n = state.slices.length;
    document.getElementById('slice-count').textContent =
        n === 0 ? 'no slices' : `${n} slice${n !== 1 ? 's' : ''} — left-click waveform to add, right-click to preview`;
}

// ── EXPORT ───────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', async () => {
    const btn = document.getElementById('btn-export');
    btn.textContent = '... rendering';
    btn.disabled = true;
    try {
        const blob = await exportWav();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'amen-pattern.wav';
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Export error: ' + err.message);
    } finally {
        btn.textContent = '↓ WAV';
        btn.disabled = false;
    }
});

// ── RESIZE waveform ──────────────────────────────────────────────
window.addEventListener('resize', () => drawWaveform());
