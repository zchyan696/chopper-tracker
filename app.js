const NOTE_NAMES  = ['C-','C#','D-','D#','E-','F-','F#','G-','G#','A-','A#','B-'];
const BASE_OCTAVE = 4;
const SLICE_KEYS  = ['Z','S','X','D','C','V','G','B','H','N','J','M','Q','2','W','3','E','R','5','T','6','Y','7','U'];

let _trackMuted        = [false,false,false,false,false,false];
let _savedSampleName   = '';
let _pendingSliceFracs = null;

const _undoStack = [];
const UNDO_MAX   = 60;
let   _copyBuf   = null;

function pushUndo() {
    _undoStack.push(JSON.parse(JSON.stringify(state.pattern)));
    if (_undoStack.length > UNDO_MAX) _undoStack.shift();
}

function undoPop() {
    if (!_undoStack.length) return;
    state.pattern = _undoStack.pop();
    trkBuildTable();
    stateSave();
}

function noteToSliceIndex(note) {
    if (!note || note === '---' || note === 'OFF') return -1;
    const name = note.substring(0, 2);
    const oct  = parseInt(note[2]);
    if (isNaN(oct)) return -1;
    const idx = NOTE_NAMES.indexOf(name);
    if (idx < 0) return -1;
    return (oct - BASE_OCTAVE) * 12 + idx;
}

function sliceIndexToNote(i) {
    const oct  = Math.floor(i / 12) + BASE_OCTAVE;
    const name = NOTE_NAMES[((i % 12) + 12) % 12];
    return `${name}${oct}`;
}

function makeCell()               { return { note: null, vol: 0xff, fx: null }; }
function makeStep(n)              { return Array.from({ length: n }, makeCell); }
function makePattern(steps, trks) { return Array.from({ length: steps }, () => makeStep(trks)); }

const state = {
    bpm: 174, lpb: 4, numSteps: 32, numTracks: 4,
    swing: 0,
    pattern: null, slices: [], audioBuffer: null,
};
state.pattern = makePattern(state.numSteps, state.numTracks);

function stateSave() {
    try {
        const totalLen = state.audioBuffer?.length || 1;
        localStorage.setItem('amen-tracker-v1', JSON.stringify({
            bpm: state.bpm, lpb: state.lpb, numSteps: state.numSteps,
            numTracks: state.numTracks, swing: state.swing,
            pattern: state.pattern,
            muted: _trackMuted.slice(0, state.numTracks),
            sampleName: document.getElementById('sample-name').textContent.replace(/^⟳ /,''),
            slices: state.slices.map(s => ({ sf: s.start/totalLen, ef: s.end/totalLen, note: s.note })),
        }));
    } catch(_) {}
}

function stateLoad() {
    try {
        const raw = localStorage.getItem('amen-tracker-v1');
        if (!raw) return false;
        const d = JSON.parse(raw);
        state.bpm       = d.bpm      ?? 174;
        state.lpb       = d.lpb      ?? 4;
        state.numSteps  = d.numSteps ?? 32;
        state.numTracks = d.numTracks?? 4;
        state.swing     = d.swing    ?? 0;
        if (d.pattern?.length === state.numSteps && d.pattern[0]?.length === state.numTracks)
            state.pattern = d.pattern;
        else
            state.pattern = makePattern(state.numSteps, state.numTracks);
        if (Array.isArray(d.muted)) d.muted.forEach((v,i) => { _trackMuted[i] = !!v; });
        _savedSampleName   = d.sampleName || '';
        _pendingSliceFracs = d.slices?.length ? d.slices : null;
        document.getElementById('bpm').value        = state.bpm;
        document.getElementById('lpb').value        = state.lpb;
        document.getElementById('steps').value      = state.numSteps;
        document.getElementById('num-tracks').value = state.numTracks;
        document.getElementById('swing').value      = state.swing;
        document.getElementById('swing-val').textContent = state.swing + '%';
        if (_savedSampleName)
            document.getElementById('sample-name').textContent = '⟳ ' + _savedSampleName;
        return true;
    } catch(_) { return false; }
}

let _audioCtx   = null;
let _masterGain = null;
let _masterVol  = 0.9;
const _lastSrc  = {};

function getCtx() {
    if (!_audioCtx) {
        _audioCtx   = new AudioContext();
        _masterGain = _audioCtx.createGain();
        _masterGain.gain.value = _masterVol;
        _masterGain.connect(_audioCtx.destination);
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

function extractSliceBuffer(sliceIndex, reverse) {
    const ac  = getCtx();
    const buf = state.audioBuffer;
    if (!buf || !state.slices[sliceIndex]) return null;
    const { start, end } = state.slices[sliceIndex];
    const len = end - start;
    if (len <= 0) return null;
    const out = ac.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch).subarray(start, end);
        const dst = out.getChannelData(ch);
        if (reverse) { for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i]; }
        else dst.set(src);
    }
    return out;
}

function playSliceAt(sliceIndex, opts, startTime, trackIdx) {
    const { vol = 1, pitchSemi = 0, reverse = false, sampleOffset = 0, cutTime = 0 } = opts || {};
    const ac       = getCtx();
    const sliceBuf = extractSliceBuffer(sliceIndex, reverse);
    if (!sliceBuf) return null;
    const src  = ac.createBufferSource();
    src.buffer = sliceBuf;
    src.playbackRate.value = Math.pow(2, pitchSemi / 12);
    const gain = ac.createGain();
    gain.gain.value = Math.max(0, Math.min(2, vol));
    src.connect(gain);
    gain.connect(_masterGain);
    const offset = Math.max(0, Math.min(sampleOffset, sliceBuf.duration - 0.001));
    src.start(startTime, offset);
    if (cutTime > 0) src.stop(startTime + cutTime);
    if (trackIdx !== undefined) _lastSrc[trackIdx] = src;
    return src;
}

function stopTrack(trackIdx, audioTime) {
    const src = _lastSrc[trackIdx];
    if (src) {
        try { src.stop(audioTime); } catch (_) {}
        delete _lastSrc[trackIdx];
    }
}

function scheduleCell(cell, stepDuration, audioTime, trackIdx) {
    if (!cell) return;
    if (_trackMuted[trackIdx]) return;
    if (cell.note === 'OFF') { stopTrack(trackIdx, audioTime); return; }
    if (!cell.note) return;
    const si = noteToSliceIndex(cell.note);
    if (si < 0 || si >= state.slices.length) return;

    const vol = (cell.vol ?? 0xff) / 0xff;
    let pitchSemi = 0, reverse = false, retrigger = 1, sampleOffset = 0, cutTime = 0;
    if (cell.fx) {
        const v = cell.fx.value;
        if (cell.fx.type === 'P') pitchSemi = v;
        if (cell.fx.type === 'B') reverse   = true;
        if (cell.fx.type === 'R') retrigger = Math.max(1, v);
        if (cell.fx.type === 'S') {
            const sl = state.slices[si];
            sampleOffset = (v / 0xff) * (sl.end - sl.start) / state.audioBuffer.sampleRate;
        }
        if (cell.fx.type === 'C') cutTime = (v / 0xff) * stepDuration;
    }
    const opts = { vol, pitchSemi, reverse, sampleOffset, cutTime };
    if (retrigger > 1) {
        const iv = stepDuration / retrigger;
        for (let i = 0; i < retrigger; i++)
            playSliceAt(si, opts, audioTime + i * iv, trackIdx);
    } else {
        playSliceAt(si, opts, audioTime, trackIdx);
    }
}

function previewSlice(si) {
    const ac = getCtx();
    playSliceAt(si, { vol: 1 }, ac.currentTime);
}

function detectTransients(buffer, sensitivity) {
    const data   = buffer.getChannelData(0);
    const sr     = buffer.sampleRate;
    const hop    = Math.floor(sr * 0.004);
    const minGap = Math.floor(sr * 0.040);
    const points = [0];

    const N      = Math.floor(data.length / hop);
    const energy = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        let sum = 0;
        const base = i * hop;
        const end  = Math.min(base + hop, data.length);
        for (let j = base; j < end; j++) sum += data[j] * data[j];
        energy[i] = Math.sqrt(sum / (end - base));
    }

    const bgWin = Math.ceil(0.12 * sr / hop);
    const scale = 1.2 + (10 - sensitivity) * 0.18;
    let lastPoint = 0;

    for (let i = 2; i < N; i++) {
        const pos  = i * hop;
        if (pos - lastPoint < minGap) continue;
        const flux = Math.max(0, energy[i] - energy[i - 1]);
        let bg = 0;
        const s = Math.max(0, i - bgWin);
        for (let k = s; k < i; k++) bg += energy[k];
        bg /= (i - s);
        if (energy[i] > 0.005 && flux > bg * scale) {
            points.push(pos);
            lastPoint = pos;
        }
    }
    return points;
}

function buildSlices(framePositions, totalFrames) {
    const pts = [...new Set(framePositions)].sort((a, b) => a - b);
    state.slices = pts.map((start, i) => ({
        start, end: pts[i + 1] ?? totalFrames, note: sliceIndexToNote(i),
    }));
    stateSave();
}

function addManualSlice(normX) {
    if (!state.audioBuffer) return;
    const frame    = Math.floor(normX * state.audioBuffer.length);
    const existing = state.slices.map(s => s.start);
    if (existing.includes(frame)) return;
    existing.push(frame);
    buildSlices(existing, state.audioBuffer.length);
}

function bpmFromFilename(name) {
    const nums = (name.match(/\d+/g) || []).map(Number).filter(n => n >= 60 && n <= 300);
    return nums.length ? nums[nums.length - 1] : null;
}

const SEQ_LOOKAHEAD = 0.12;
const SEQ_TICK_MS   = 25;

let _seqPlaying = false, _seqStep = 0, _seqNextTime = 0, _seqTimer = null, _seqOnStep = null;

function seqStepDur() { return 60 / (state.bpm * state.lpb); }

function seqTick() {
    const ac = getCtx();
    while (_seqNextTime < ac.currentTime + SEQ_LOOKAHEAD) {
        const dur   = seqStepDur();
        const swing = (_seqStep % 2 === 1) ? dur * (state.swing / 100) : 0;
        const playAt = _seqNextTime + swing;
        for (let t = 0; t < state.numTracks; t++)
            scheduleCell(state.pattern[_seqStep]?.[t], dur, playAt, t);
        if (_seqOnStep) _seqOnStep(_seqStep);
        _seqNextTime += dur;
        _seqStep = (_seqStep + 1) % state.numSteps;
    }
    _seqTimer = setTimeout(seqTick, SEQ_TICK_MS);
}

function seqPlay(onStep) {
    if (_seqPlaying) return;
    _seqOnStep   = onStep || null;
    _seqPlaying  = true;
    _seqStep     = 0;
    _seqNextTime = getCtx().currentTime + 0.05;
    seqTick();
}

function seqStop() {
    _seqPlaying = false;
    clearTimeout(_seqTimer);
    _seqTimer = null;
    _seqStep  = 0;
    if (_seqOnStep) _seqOnStep(-1);
}

let _wfSmall, _wfSmallCtx;
let _wfBig,   _wfBigCtx;
let _wfModalOpen = false;
let _wfZoom      = 1;
let _wfOffset    = 0;
let _wfDrag      = null;
let _wfMoved     = false;

function wfAC()  { return _wfModalOpen ? _wfBig    : _wfSmall; }
function wfACx() { return _wfModalOpen ? _wfBigCtx : _wfSmallCtx; }

function wfClampOffset(o) { return Math.max(0, Math.min(1 - 1 / _wfZoom, o)); }

function wfPxToNorm(px) {
    return _wfOffset + (px / (wfAC().offsetWidth || 1)) / _wfZoom;
}
function wfNormToPx(n, canvas) {
    const c = canvas || wfAC();
    return (n - _wfOffset) * _wfZoom * (c.offsetWidth || 1);
}
function wfNearSlice(px, thresh) {
    thresh = thresh || 8;
    if (!state.audioBuffer) return -1;
    const total = state.audioBuffer.length;
    let best = -1, bestD = thresh + 1;
    state.slices.forEach((sl, i) => {
        if (i === 0) return;
        const x = wfNormToPx(sl.start / total);
        const d = Math.abs(x - px);
        if (d < bestD) { bestD = d; best = i; }
    });
    return best;
}

function wfDrawOn(canvas, ctx) {
    const W = canvas.width  = canvas.offsetWidth  || 600;
    const H = canvas.height = canvas.offsetHeight || 200;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

    if (!state.audioBuffer) {
        ctx.fillStyle = '#333'; ctx.font = '11px Courier New'; ctx.textAlign = 'center';
        ctx.fillText('no sample loaded', W/2, H/2 + 4);
        return;
    }

    const data     = state.audioBuffer.getChannelData(0);
    const total    = data.length;
    const mid      = H / 2;
    const visStart = Math.floor(_wfOffset * total);
    const visEnd   = Math.min(total, Math.ceil((_wfOffset + 1 / _wfZoom) * total));
    const visLen   = visEnd - visStart;
    const stride   = Math.max(1, Math.floor(visLen / W));

    const peaks = new Float32Array(W * 2);
    for (let px = 0; px < W; px++) {
        const i0 = visStart + Math.floor((px / W) * visLen);
        let mn = 0, mx = 0;
        for (let k = 0; k < stride && i0 + k < total; k++) {
            const v = data[i0 + k];
            if (v < mn) mn = v; if (v > mx) mx = v;
        }
        peaks[px * 2]     = mn;
        peaks[px * 2 + 1] = mx;
    }

    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let px = 0; px < W; px++) ctx.lineTo(px, mid + peaks[px*2+1] * mid * 0.95);
    for (let px = W - 1; px >= 0; px--) ctx.lineTo(px, mid + peaks[px*2] * mid * 0.95);
    ctx.closePath();
    ctx.fillStyle = 'rgba(220,220,220,0.9)';
    ctx.fill();

    state.slices.forEach((sl, i) => {
        const norm = sl.start / total;
        if (norm < _wfOffset - 0.001 || norm > _wfOffset + 1 / _wfZoom + 0.001) return;
        const x          = (norm - _wfOffset) * _wfZoom * W;
        const isDragging = _wfDrag?.type === 'slice' && _wfDrag.sliceIdx === i;
        ctx.strokeStyle  = isDragging ? '#ffffff' : (i === 0 ? '#885500' : '#ff7700');
        ctx.lineWidth    = isDragging ? 3 : (i === 0 ? 1 : 2);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        if (i > 0) {
            ctx.fillStyle = isDragging ? '#fff' : '#ff7700';
            ctx.font      = `bold ${Math.min(11, Math.max(9, H/15))}px Courier New`;
            ctx.textAlign = 'left';
            ctx.fillText(SLICE_KEYS[i] ? `${i} [${SLICE_KEYS[i]}]` : String(i), x + 3, 14);
        }
    });

    const endNorm = (state.numSteps * seqStepDur()) / state.audioBuffer.duration;
    const endX    = (endNorm - _wfOffset) * _wfZoom * W;
    if (endX >= 0 && endX <= W) {
        const color = Math.abs(endNorm - 1) < 0.02 ? '#40e040' : '#e0a000';
        ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(endX, 0); ctx.lineTo(endX, H); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.font = '9px Courier New';
        ctx.textAlign = endX > W - 40 ? 'right' : 'left';
        ctx.fillText('END', endX + (endX > W - 40 ? -4 : 4), H - 5);
    }

    if (_wfZoom > 1) {
        ctx.fillStyle = '#444'; ctx.font = '9px Courier New'; ctx.textAlign = 'right';
        ctx.fillText(`${_wfZoom.toFixed(1)}×`, W - 4, H - 5);
    }
}

function wfDraw() {
    wfDrawOn(_wfSmall, _wfSmallCtx);
    if (_wfModalOpen) wfDrawOn(_wfBig, _wfBigCtx);
}

function wfAttachEvents(canvas) {
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        if (!state.audioBuffer) return;
        const r       = canvas.getBoundingClientRect();
        const curNorm = _wfOffset + ((e.clientX - r.left) / (canvas.offsetWidth || 1)) / _wfZoom;
        const factor  = e.deltaY < 0 ? 1.4 : 1 / 1.4;
        _wfZoom   = Math.max(1, Math.min(128, _wfZoom * factor));
        _wfOffset = wfClampOffset(curNorm - (e.clientX - r.left) / (canvas.offsetWidth || 1) / _wfZoom);
        wfDraw(); wfUpdateInfo();
    }, { passive: false });

    canvas.addEventListener('mousedown', e => {
        if (!state.audioBuffer || e.button !== 0) return;
        const r  = canvas.getBoundingClientRect();
        const px = e.clientX - r.left;
        const si = wfNearSlice(px);
        _wfMoved = false;
        _wfDrag  = si >= 0
            ? { type: 'slice', sliceIdx: si, startX: px, canvas }
            : { type: 'pan',   startX: px, startOffset: _wfOffset, canvas };
        e.preventDefault();
    });

    canvas.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!state.audioBuffer) return;
        const r  = canvas.getBoundingClientRect();
        const px = e.clientX - r.left;
        const si = wfNearSlice(px, 12);
        if (si >= 0) {
            buildSlices(state.slices.map(s => s.start).filter((_, i) => i !== si), state.audioBuffer.length);
            wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
        } else {
            const norm  = _wfOffset + (px / (canvas.offsetWidth || 1)) / _wfZoom;
            const frame = Math.floor(norm * state.audioBuffer.length);
            let nearest = 0, minDist = Infinity;
            state.slices.forEach((sl, i) => { const d = Math.abs(sl.start - frame); if (d < minDist) { minDist = d; nearest = i; } });
            previewSlice(nearest);
        }
    });
}

window.addEventListener('mousemove', e => {
    if (!_wfDrag || !state.audioBuffer) return;
    const canvas = _wfDrag.canvas || wfAC();
    const r  = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const dx = px - _wfDrag.startX;
    if (Math.abs(dx) > 2) _wfMoved = true;

    if (_wfDrag.type === 'pan') {
        _wfOffset = wfClampOffset(_wfDrag.startOffset - dx / (canvas.offsetWidth || 1) / _wfZoom);
        canvas.style.cursor = 'grabbing';
    } else {
        const newNorm  = Math.max(0.001, Math.min(0.999, _wfOffset + (px / (canvas.offsetWidth || 1)) / _wfZoom));
        const newFrame = Math.round(newNorm * state.audioBuffer.length);
        const frames   = state.slices.map(s => s.start);
        frames[_wfDrag.sliceIdx] = newFrame;
        buildSlices(frames, state.audioBuffer.length);
        canvas.style.cursor = 'ew-resize';
    }
    wfDraw();
});

window.addEventListener('mouseup', e => {
    if (!_wfDrag) return;
    const canvas = _wfDrag.canvas || wfAC();
    if (!_wfMoved && _wfDrag.type === 'pan' && state.audioBuffer) {
        const r  = canvas.getBoundingClientRect();
        const nx = _wfOffset + ((e.clientX - r.left) / (canvas.offsetWidth || 1)) / _wfZoom;
        addManualSlice(nx);
        wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
    } else if (_wfDrag.type === 'slice') {
        if (!_wfMoved) previewSlice(_wfDrag.sliceIdx);
        buildLegend(); updateSliceCount();
    }
    canvas.style.cursor = 'crosshair';
    _wfDrag = null; _wfMoved = false;
});

function wfOpenModal() {
    _wfModalOpen = true;
    document.getElementById('wf-modal').classList.remove('hidden');
    wfDraw(); wfUpdateInfo();
}

function wfCloseModal() {
    _wfModalOpen = false;
    document.getElementById('wf-modal').classList.add('hidden');
    wfDraw();
}

function wfUpdateInfo() {
    const el = document.getElementById('wf-modal-info');
    if (!el || !state.audioBuffer) return;
    el.textContent = `${state.slices.length} slices  ·  zoom ${_wfZoom.toFixed(1)}×  ·  ${state.audioBuffer.duration.toFixed(2)}s`;
}

function wfInit() {
    _wfSmall    = document.getElementById('waveform');
    _wfSmallCtx = _wfSmall.getContext('2d');
    _wfBig      = document.getElementById('wf-canvas-big');
    _wfBigCtx   = _wfBig.getContext('2d');

    wfAttachEvents(_wfSmall);
    wfAttachEvents(_wfBig);

    document.getElementById('btn-wf-expand').addEventListener('click', wfOpenModal);
    document.getElementById('wf-modal-close').addEventListener('click', wfCloseModal);
    document.getElementById('wf-modal-zoom-reset').addEventListener('click', () => {
        _wfZoom = 1; _wfOffset = 0; wfDraw(); wfUpdateInfo();
    });
    document.getElementById('wf-modal-auto-slice').addEventListener('click', autoSlice);
    document.getElementById('wf-modal-fill').addEventListener('click', fillBreak);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && _wfModalOpen) { wfCloseModal(); }
    });

    wfDraw();
}

function buildLegend() {
    const legend = document.getElementById('slice-legend');
    legend.innerHTML = '';
    const total = state.audioBuffer?.length ?? 1;
    state.slices.forEach((sl, i) => {
        const div  = document.createElement('div');
        div.className = 'slice-item';
        const ns   = document.createElement('span');
        ns.className   = 'slice-note';
        ns.textContent = SLICE_KEYS[i] || sl.note;
        const bar  = document.createElement('div');
        bar.className  = 'slice-bar';
        const fill = document.createElement('div');
        fill.className = 'slice-bar-fill';
        fill.style.width = `${((sl.end - sl.start) / total) * 100}%`;
        bar.appendChild(fill);
        div.appendChild(ns); div.appendChild(bar);
        div.addEventListener('click', () => previewSlice(i));
        legend.appendChild(div);
    });
}

function updateTimingInfo() {
    const el = document.getElementById('timing-info');
    if (!el) return;
    if (!state.audioBuffer) { el.textContent = ''; return; }

    const patDur = state.numSteps * seqStepDur();
    const smDur  = state.audioBuffer.duration;
    const diff   = patDur - smDur;
    const fmt    = s => s.toFixed(2) + 's';

    let status, color;
    if (Math.abs(diff) < 0.05) {
        status = '✓ SYNC'; color = '#50e050';
    } else if (diff > 0) {
        status = `+${fmt(diff)} pattern longo`; color = '#e0a030';
    } else {
        status = `${fmt(diff)} sample longo`; color = '#e0a030';
    }

    el.innerHTML =
        `<span style="color:#555">pattern</span> ${fmt(patDur)} &nbsp;` +
        `<span style="color:#555">sample</span> ${fmt(smDur)} &nbsp;` +
        `<span style="color:${color}">${status}</span>`;
}

function fillBreak() {
    if (!state.slices.length) { alert('Carregue um sample e fatie primeiro.'); return; }
    pushUndo();
    const n = state.slices.length;
    for (let s = 0; s < state.numSteps; s++) state.pattern[s][0] = makeCell();
    for (let i = 0; i < n && i < state.numSteps; i++) {
        const step = Math.round((i / n) * state.numSteps);
        if (step < state.numSteps) {
            state.pattern[step][0].note = sliceIndexToNote(i);
            state.pattern[step][0].vol  = 0xff;
        }
    }
    trkBuildTable();
    stateSave();
}

function equalSlices(n) {
    if (!state.audioBuffer) return;
    const total  = state.audioBuffer.length;
    const points = Array.from({ length: n }, (_, i) => Math.floor((i / n) * total));
    buildSlices(points, total);
    wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
}

const QWERTY_LOWER = { z:0,s:1,x:2,d:3,c:4,v:5,g:6,b:7,h:8,n:9,j:10,m:11 };
const QWERTY_UPPER = { q:0,2:1,w:2,3:3,e:4,r:5,5:6,t:7,6:8,y:9,7:10,u:11 };

let sel = { step: 0, track: 0, col: 0 };

function trkBuildTable() {
    const head = document.getElementById('tracker-head');
    const body = document.getElementById('tracker-body');
    head.innerHTML = ''; body.innerHTML = '';

    const hr1 = document.createElement('tr');
    const st  = document.createElement('th'); st.colSpan = 2; hr1.appendChild(st);
    for (let t = 0; t < state.numTracks; t++) {
        const th  = document.createElement('th');
        th.colSpan = 3; th.style.textAlign = 'center';
        const lbl = document.createElement('span');
        lbl.textContent = `TRACK ${t+1} `;
        const mb  = document.createElement('button');
        mb.className = 'btn-mute'; mb.textContent = 'M';
        mb.classList.toggle('muted', !!_trackMuted[t]);
        mb.addEventListener('click', e => {
            e.stopPropagation();
            _trackMuted[t] = !_trackMuted[t];
            mb.classList.toggle('muted', _trackMuted[t]);
            stateSave();
        });
        th.appendChild(lbl); th.appendChild(mb);
        hr1.appendChild(th);
        if (t < state.numTracks - 1) {
            const sep = document.createElement('th'); sep.className = 'track-sep'; hr1.appendChild(sep);
        }
    }
    head.appendChild(hr1);

    const hr2 = document.createElement('tr');
    hr2.appendChild(document.createElement('th'));
    const e2  = document.createElement('th'); e2.className = 'track-sep'; hr2.appendChild(e2);
    for (let t = 0; t < state.numTracks; t++) {
        ['NOTE','VOL','FX'].forEach((label, ci) => {
            const th = document.createElement('th');
            th.textContent = label; th.className = ['th-note','th-vol','th-fx'][ci];
            hr2.appendChild(th);
        });
        if (t < state.numTracks - 1) {
            const sep = document.createElement('th'); sep.className = 'track-sep'; hr2.appendChild(sep);
        }
    }
    head.appendChild(hr2);

    for (let s = 0; s < state.numSteps; s++) {
        const tr = document.createElement('tr');
        tr.dataset.step = s;
        if (s % state.lpb === 0) tr.classList.add('row-beat');

        const stepTd = document.createElement('td');
        stepTd.className   = 'step-num';
        stepTd.textContent = s.toString(16).padStart(2,'0').toUpperCase();
        tr.appendChild(stepTd);

        const sep0 = document.createElement('td'); sep0.className = 'track-sep'; tr.appendChild(sep0);

        for (let t = 0; t < state.numTracks; t++) {
            for (let c = 0; c < 3; c++) {
                const td = document.createElement('td');
                td.dataset.step  = s; td.dataset.track = t; td.dataset.col = c;
                td.classList.add(['cell-note','cell-vol','cell-fx'][c]);
                td.addEventListener('mousedown', e => {
                    sel = { step:s, track:t, col:c };
                    trkRefreshSel();
                    if (e.button === 2) {
                        pushUndo();
                        const cell = state.pattern[s][t];
                        cell.note = null; cell.vol = 0xff; cell.fx = null;
                        trkRefreshCells(s, t);
                        return;
                    }
                    if (c === 0) {
                        const cell = state.pattern[s][t];
                        if (cell.note && cell.note !== 'OFF') {
                            const si = noteToSliceIndex(cell.note); if (si >= 0) previewSlice(si);
                        }
                    }
                });
                td.addEventListener('contextmenu', e => e.preventDefault());
                trkUpdateCell(td, s, t, c);
                tr.appendChild(td);
            }
            if (t < state.numTracks - 1) {
                const sep = document.createElement('td'); sep.className = 'track-sep'; tr.appendChild(sep);
            }
        }
        body.appendChild(tr);
    }
    trkRefreshSel();
}

function trkGetTd(step, track, col) {
    return document.querySelector(
        `#tracker-body td[data-step="${step}"][data-track="${track}"][data-col="${col}"]`
    );
}

function trkUpdateCell(tdOrNull, step, track, col) {
    const td   = tdOrNull || trkGetTd(step, track, col);
    if (!td) return;
    const cell = state.pattern[step]?.[track];
    if (!cell) return;
    let text = '', empty = false, isOff = false;

    if (col === 0) {
        if (cell.note === 'OFF') { text = 'OFF'; isOff = true; }
        else { text = cell.note ?? '---'; empty = !cell.note; }
    } else if (col === 1) {
        if (!cell.note || cell.note === 'OFF') { text = '--'; empty = true; }
        else text = (cell.vol ?? 0xff).toString(16).toUpperCase().padStart(2,'0');
    } else {
        text = fxStr(cell.fx); empty = !cell.fx;
    }

    td.textContent = text;
    td.classList.toggle('cell-empty', empty);
    td.classList.toggle('cell-off', isOff);
}

function fxStr(fx) {
    if (!fx) return '---';
    if (fx.type === 'B') return 'B--';
    if (fx.type === 'R') return `R${fx.value.toString().padStart(2,'0')}`;
    if (fx.type === 'P') return fx.value < 0 ? `P-${Math.abs(fx.value)}` : `P${fx.value.toString().padStart(2,'0')}`;
    if (fx.type === 'S') return `S${fx.value.toString(16).toUpperCase().padStart(2,'0')}`;
    if (fx.type === 'C') return `C${fx.value.toString(16).toUpperCase().padStart(2,'0')}`;
    return '---';
}

function trkRefreshSel() {
    document.querySelectorAll('.cell-selected').forEach(e => e.classList.remove('cell-selected'));
    const td = trkGetTd(sel.step, sel.track, sel.col);
    if (td) { td.classList.add('cell-selected'); td.scrollIntoView({ block:'nearest', inline:'nearest' }); }
}

function trkHighlightStep(step) {
    document.querySelectorAll('.row-playing').forEach(r => r.classList.remove('row-playing'));
    if (step < 0) return;
    const row = document.querySelector(`#tracker-body tr[data-step="${step}"]`);
    if (row) row.classList.add('row-playing');
}

function trkRefreshCells(step, track) {
    for (let c = 0; c < 3; c++) trkUpdateCell(null, step, track, c);
    stateSave();
}

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (_wfModalOpen) return;
    const key = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); undoPop(); return; }
    if ((e.ctrlKey || e.metaKey) && key === 'c') {
        e.preventDefault();
        const { step, track } = sel;
        _copyBuf = JSON.parse(JSON.stringify(state.pattern[step][track]));
        return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'v') {
        e.preventDefault();
        if (!_copyBuf) return;
        const { step, track } = sel;
        pushUndo();
        state.pattern[step][track] = JSON.parse(JSON.stringify(_copyBuf));
        trkRefreshCells(step, track);
        trkMove(1, 0, 0);
        return;
    }

    if (key === 'arrowdown')  { e.preventDefault(); trkMove(1, 0, 0); return; }
    if (key === 'arrowup')    { e.preventDefault(); trkMove(-1, 0, 0); return; }
    if (key === 'arrowleft')  { e.preventDefault(); trkMove(0, 0, -1); return; }
    if (key === 'arrowright') { e.preventDefault(); trkMove(0, 0, 1); return; }
    if (key === 'tab')        { e.preventDefault(); trkMove(0, e.shiftKey ? -1 : 1, 0); return; }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); pushUndo(); trkClearCell(); return; }

    const { step, track, col } = sel;

    if (col === 0) {
        if (key === ']') {
            pushUndo();
            const cell = state.pattern[step][track];
            cell.note = 'OFF'; cell.fx = null;
            trkRefreshCells(step, track);
            trkMove(1, 0, 0); return;
        }
        const noteIdx = QWERTY_LOWER[key] ?? QWERTY_UPPER[key] ?? -1;
        if (noteIdx >= 0) {
            pushUndo();
            const oct  = (QWERTY_UPPER[key] !== undefined) ? BASE_OCTAVE + 1 : BASE_OCTAVE;
            const note = `${NOTE_NAMES[noteIdx]}${oct}`;
            trkSetNote(step, track, note);
            trkMove(1, 0, 0); return;
        }
        if (key === 'f1' || key === 'f2') { e.preventDefault(); pushUndo(); trkShiftOctave(step, track, key === 'f2' ? 1 : -1); return; }
    }
    if (col === 1) {
        if (/^[0-9a-f]$/i.test(key)) {
            const cell = state.pattern[step]?.[track];
            if (!cell?.note || cell.note === 'OFF') return;
            pushUndo();
            const cur = (cell.vol ?? 0xff).toString(16).padStart(2,'0');
            cell.vol  = parseInt(cur[1] + key, 16);
            trkRefreshCells(step, track); return;
        }
    }
    if (col === 2) { pushUndo(); trkFxKey(key, step, track); }
});

function trkFxKey(key, step, track) {
    const cell = state.pattern[step]?.[track]; if (!cell) return;
    if (key === 'r') { cell.fx = { type:'R', value:3    }; trkRefreshCells(step, track); return; }
    if (key === 'b') { cell.fx = { type:'B', value:0    }; trkRefreshCells(step, track); return; }
    if (key === 'p') { cell.fx = { type:'P', value:0    }; trkRefreshCells(step, track); return; }
    if (key === 's') { cell.fx = { type:'S', value:0x40 }; trkRefreshCells(step, track); return; }
    if (key === 'c') { cell.fx = { type:'C', value:0x80 }; trkRefreshCells(step, track); return; }
    if (cell.fx && (key === '+' || key === '=')) {
        cell.fx.value = Math.min(0xff, cell.fx.value + 1);
        trkRefreshCells(step, track); return;
    }
    if (cell.fx && key === '-') {
        cell.fx.value = Math.max(0, cell.fx.value - 1);
        trkRefreshCells(step, track); return;
    }
    if (cell.fx && /^[0-9a-f]$/i.test(key)) {
        const cur = cell.fx.value.toString(16).padStart(2,'0');
        cell.fx.value = parseInt(cur[1] + key, 16);
        trkRefreshCells(step, track); return;
    }
}

function trkMove(dStep, dTrack, dCol) {
    sel.col   = ((sel.col   + dCol)   % 3               + 3)               % 3;
    sel.track = ((sel.track + dTrack) % state.numTracks  + state.numTracks)  % state.numTracks;
    sel.step  = ((sel.step  + dStep)  % state.numSteps   + state.numSteps)   % state.numSteps;
    trkRefreshSel();
}

function trkSetNote(step, track, note) {
    const cell = state.pattern[step][track];
    cell.note  = note;
    if (!cell.vol) cell.vol = 0xff;
    trkRefreshCells(step, track);
    const si = noteToSliceIndex(note); if (si >= 0) previewSlice(si);
}

function trkShiftOctave(step, track, delta) {
    const cell = state.pattern[step]?.[track]; if (!cell?.note || cell.note === 'OFF') return;
    const oct  = parseInt(cell.note[2]) + delta;
    if (oct < 0 || oct > 9) return;
    cell.note = cell.note.substring(0, 2) + oct;
    trkRefreshCells(step, track);
}

function trkClearCell() {
    const { step, track, col } = sel;
    const cell = state.pattern[step]?.[track]; if (!cell) return;
    if (col === 0) { cell.note = null; cell.fx = null; }
    if (col === 1) cell.vol = 0xff;
    if (col === 2) cell.fx = null;
    trkRefreshCells(step, track);
}

const AUDIO_EXTS = new Set(['wav','mp3','aif','aiff','ogg','flac']);
let _kitsAll = [], _kitsFiltered = [], _kitsPreviewCtx = null, _kitsPreviewSrc = null;
let _kitsUseHttp = false;

function kitsMount() {
    document.getElementById('kits-search').addEventListener('input', e => kitsFilter(e.target.value));
    document.getElementById('btn-change-folder').addEventListener('click', kitsOpenFolder);
    const list = document.getElementById('kits-list');
    list.addEventListener('click', e => {
        const li = e.target.closest('li[data-idx]'); if (!li) return;
        kitsSelect(li, parseInt(li.dataset.idx), false);
    });
    list.addEventListener('dblclick', e => {
        const li = e.target.closest('li[data-idx]'); if (!li) return;
        kitsSelect(li, parseInt(li.dataset.idx), true);
    });
}

async function kitsTryHttp() {
    try {
        const r = await fetch('./kits-index.json');
        if (!r.ok) return false;
        const paths  = await r.json();
        _kitsAll      = paths.map(p => ({ name: p.split('/').pop(), path: p }));
        _kitsFiltered = _kitsAll;
        _kitsUseHttp  = true;
        document.getElementById('kits-status').textContent = `${_kitsAll.length} samples`;
        kitsRender(_kitsAll);
        return true;
    } catch (_) { return false; }
}

async function kitsOpenFolder() {
    if (!window.showDirectoryPicker) { alert('Use Chrome ou Edge.'); return; }
    try {
        const dir = await window.showDirectoryPicker({ mode: 'read' });
        document.getElementById('kits-status').textContent = 'scanning...';
        const results = [];
        async function scan(dh, base) {
            for await (const [name, handle] of dh.entries()) {
                if (name.startsWith('.') || name.startsWith('__')) continue;
                const fp = base ? `${base}/${name}` : name;
                if (handle.kind === 'directory') await scan(handle, fp);
                else if (handle.kind === 'file' && AUDIO_EXTS.has(name.split('.').pop().toLowerCase()))
                    results.push({ name, path: fp, handle });
            }
        }
        await scan(dir, '');
        _kitsAll = results; _kitsFiltered = results; _kitsUseHttp = false;
        document.getElementById('kits-status').textContent = `${results.length} samples`;
        kitsRender(results);
    } catch (e) {
        if (e.name !== 'AbortError')
            document.getElementById('kits-status').textContent = 'erro: ' + e.message;
    }
}

function kitsFilter(q) {
    const lq = q.toLowerCase().trim();
    _kitsFiltered = lq ? _kitsAll.filter(f => f.path.toLowerCase().includes(lq)) : _kitsAll;
    kitsRender(_kitsFiltered);
    document.getElementById('kits-status').textContent = `${_kitsFiltered.length} / ${_kitsAll.length} samples`;
}

function kitsRender(files) {
    const list = document.getElementById('kits-list');
    list.innerHTML = '';
    files.forEach((f, i) => {
        const li    = document.createElement('li'); li.dataset.idx = i;
        const parts = f.path.split('/'); const fname = parts.pop(); const fdir = parts.join('/');
        if (fdir) { const ds = document.createElement('span'); ds.className = 'kit-dir'; ds.textContent = fdir + '/'; li.appendChild(ds); }
        const ns = document.createElement('span'); ns.className = 'kit-name'; ns.textContent = fname; li.appendChild(ns);
        list.appendChild(li);
    });
}

async function kitsSelect(li, idx, load) {
    document.querySelectorAll('#kits-list li.active').forEach(e => e.classList.remove('active'));
    li.classList.add('active');
    const f = _kitsFiltered[idx]; if (!f) return;
    if (load) {
        kitsStopPreview();
        if (_kitsUseHttp) { const r = await fetch(f.path); await loadSampleBuffer(f.name, await r.arrayBuffer()); }
        else { const file = await f.handle.getFile(); await loadSampleFile(file); }
        switchTab('sample');
    } else {
        if (_kitsUseHttp) await kitsPreviewPath(f.path);
        else { const file = await f.handle.getFile(); await kitsPreviewBuf(await file.arrayBuffer()); }
    }
}

async function kitsPreviewPath(path) {
    kitsStopPreview();
    if (!_kitsPreviewCtx) _kitsPreviewCtx = new AudioContext();
    if (_kitsPreviewCtx.state === 'suspended') await _kitsPreviewCtx.resume();
    const r = await fetch(path);
    await kitsPreviewBuf(await r.arrayBuffer());
}

async function kitsPreviewBuf(ab) {
    if (!_kitsPreviewCtx) _kitsPreviewCtx = new AudioContext();
    if (_kitsPreviewCtx.state === 'suspended') await _kitsPreviewCtx.resume();
    const buf = await _kitsPreviewCtx.decodeAudioData(ab);
    kitsStopPreview();
    const src = _kitsPreviewCtx.createBufferSource();
    src.buffer = buf; src.connect(_kitsPreviewCtx.destination); src.start();
    _kitsPreviewSrc = src;
}

function kitsStopPreview() {
    if (_kitsPreviewSrc) { try { _kitsPreviewSrc.stop(); } catch(_){} _kitsPreviewSrc = null; }
}

async function exportWav() {
    if (!state.audioBuffer || !state.slices.length) throw new Error('Sem sample ou slices.');
    const sr       = state.audioBuffer.sampleRate;
    const stepDur  = 60 / (state.bpm * state.lpb);
    const totalDur = stepDur * state.numSteps + 2;
    const offCtx   = new OfflineAudioContext(2, Math.ceil(totalDur * sr), sr);
    const master   = offCtx.createGain(); master.gain.value = 0.9; master.connect(offCtx.destination);

    function extractOff(si, reverse) {
        const buf = state.audioBuffer; const sl = state.slices[si]; if (!sl) return null;
        const len = sl.end - sl.start; if (len <= 0) return null;
        const out = offCtx.createBuffer(buf.numberOfChannels, len, sr);
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const s = buf.getChannelData(ch).subarray(sl.start, sl.end);
            const d = out.getChannelData(ch);
            if (reverse) { for (let i = 0; i < len; i++) d[i] = s[len-1-i]; } else d.set(s);
        }
        return out;
    }

    for (let s = 0; s < state.numSteps; s++) {
        const swing    = (s % 2 === 1) ? stepDur * (state.swing / 100) : 0;
        const baseTime = s * stepDur + swing;
        for (let t = 0; t < state.numTracks; t++) {
            const cell = state.pattern[s]?.[t]; if (!cell?.note || cell.note === 'OFF') continue;
            const si   = noteToSliceIndex(cell.note); if (si < 0 || si >= state.slices.length) continue;
            const vol  = (cell.vol ?? 0xff) / 0xff;
            let pitchSemi = 0, reverse = false, retrigger = 1, sampleOffset = 0, cutTime = 0;
            if (cell.fx) {
                const fv = cell.fx.value;
                if (cell.fx.type === 'P') pitchSemi = fv;
                if (cell.fx.type === 'B') reverse   = true;
                if (cell.fx.type === 'R') retrigger = Math.max(1, fv);
                if (cell.fx.type === 'S') sampleOffset = (fv / 0xff) * (state.slices[si].end - state.slices[si].start) / sr;
                if (cell.fx.type === 'C') cutTime = (fv / 0xff) * stepDur;
            }
            const sched = t0 => {
                const sbuf = extractOff(si, reverse); if (!sbuf) return;
                const src  = offCtx.createBufferSource();
                src.buffer = sbuf; src.playbackRate.value = Math.pow(2, pitchSemi / 12);
                const g    = offCtx.createGain(); g.gain.value = Math.max(0, Math.min(2, vol));
                src.connect(g); g.connect(master);
                src.start(t0, Math.max(0, Math.min(sampleOffset, sbuf.duration - 0.001)));
                if (cutTime > 0) src.stop(t0 + cutTime);
            };
            if (retrigger > 1) { const iv = stepDur / retrigger; for (let i = 0; i < retrigger; i++) sched(baseTime + i * iv); }
            else sched(baseTime);
        }
    }

    return bufToWav(await offCtx.startRendering());
}

function bufToWav(buf) {
    const numCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
    const bps   = 2, ba = numCh * bps, ds = len * ba;
    const ab    = new ArrayBuffer(44 + ds); const view = new DataView(ab);
    const ws    = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o+i, s.charCodeAt(i)); };
    ws(0,'RIFF'); view.setUint32(4,36+ds,true); ws(8,'WAVE'); ws(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,numCh,true);
    view.setUint32(24,sr,true); view.setUint32(28,sr*ba,true); view.setUint16(32,ba,true);
    view.setUint16(34,16,true); ws(36,'data'); view.setUint32(40,ds,true);
    let off = 44;
    for (let i = 0; i < len; i++) for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
    }
    return new Blob([ab], { type:'audio/wav' });
}

function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${name}`));
}

function updateSliceCount() {
    const n = state.slices.length;
    document.getElementById('slice-count').textContent =
        n === 0 ? 'nenhum slice' : `${n} slices — click=adicionar  right-click=preview`;
}

async function loadSampleFile(file) {
    await loadSampleBuffer(file.name, await file.arrayBuffer());
}

async function loadSampleBuffer(name, ab) {
    const ac = getCtx();
    document.getElementById('sample-name').textContent = name;
    state.audioBuffer = await ac.decodeAudioData(ab);
    _wfZoom = 1; _wfOffset = 0;
    ['btn-auto-slice','btn-clear-slices','btn-fill-break','btn-slice-8','btn-slice-16','btn-slice-32']
        .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });

    const detectedBpm = bpmFromFilename(name);
    if (detectedBpm) {
        state.bpm = detectedBpm;
        document.getElementById('bpm').value = detectedBpm;
    }

    if (_pendingSliceFracs && name === _savedSampleName) {
        const total = state.audioBuffer.length;
        state.slices = _pendingSliceFracs.map(f => ({
            start: Math.round(f.sf * total),
            end:   Math.round(f.ef * total),
            note:  f.note,
        }));
        _pendingSliceFracs = null;
        wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
    } else {
        _pendingSliceFracs = null;
        autoSlice();
    }
    stateSave();
}

function autoSlice() {
    if (!state.audioBuffer) return;
    const sens   = parseInt(document.getElementById('sensitivity').value);
    const points = detectTransients(state.audioBuffer, sens);
    buildSlices(points, state.audioBuffer.length);
    wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
}

window.addEventListener('DOMContentLoaded', () => {
    stateLoad();
    trkBuildTable();
    wfInit();
    kitsMount();

    kitsTryHttp().then(ok => {
        if (!ok) document.getElementById('kits-status').textContent = 'use INICIAR.bat para auto-carregar kits';
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.getElementById('bpm').addEventListener('change', e => {
        state.bpm = parseInt(e.target.value) || 174;
        wfDraw(); updateTimingInfo(); stateSave();
    });
    document.getElementById('lpb').addEventListener('change', e => {
        state.lpb = parseInt(e.target.value) || 4;
        state.pattern = makePattern(state.numSteps, state.numTracks); trkBuildTable();
        wfDraw(); updateTimingInfo(); stateSave();
    });
    document.getElementById('steps').addEventListener('change', e => {
        state.numSteps = parseInt(e.target.value);
        state.pattern  = makePattern(state.numSteps, state.numTracks); trkBuildTable();
        wfDraw(); updateTimingInfo(); stateSave();
    });
    document.getElementById('num-tracks').addEventListener('change', e => {
        state.numTracks = parseInt(e.target.value);
        state.pattern   = makePattern(state.numSteps, state.numTracks); trkBuildTable();
        stateSave();
    });

    document.getElementById('master-vol').addEventListener('input', e => {
        _masterVol = parseInt(e.target.value) / 100;
        document.getElementById('vol-val').textContent = e.target.value + '%';
        if (_masterGain) _masterGain.gain.value = _masterVol;
    });

    document.getElementById('swing').addEventListener('input', e => {
        state.swing = parseInt(e.target.value);
        document.getElementById('swing-val').textContent = e.target.value + '%';
        stateSave();
    });

    document.getElementById('btn-slice-8' ).addEventListener('click', () => equalSlices(8));
    document.getElementById('btn-slice-16').addEventListener('click', () => equalSlices(16));
    document.getElementById('btn-slice-32').addEventListener('click', () => equalSlices(32));

    const btnPlay = document.getElementById('btn-play');
    btnPlay.addEventListener('click', () => {
        getCtx();
        if (_seqPlaying) { seqStop(); btnPlay.textContent = '▶ PLAY'; btnPlay.classList.remove('active'); return; }
        seqPlay(step => trkHighlightStep(step));
        btnPlay.textContent = '■ STOP'; btnPlay.classList.add('active');
    });
    document.getElementById('btn-stop').addEventListener('click', () => {
        seqStop(); trkHighlightStep(-1);
        const btnPlay = document.getElementById('btn-play');
        btnPlay.textContent = '▶ PLAY'; btnPlay.classList.remove('active');
    });

    const dropzone  = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault(); dropzone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0]; if (file) loadSampleFile(file);
    });
    fileInput.addEventListener('change', e => { const file = e.target.files[0]; if (file) loadSampleFile(file); });

    document.getElementById('sensitivity').addEventListener('input', e => {
        document.getElementById('sens-val').textContent = e.target.value;
    });
    document.getElementById('btn-auto-slice').addEventListener('click', autoSlice);
    document.getElementById('btn-clear-slices').addEventListener('click', () => {
        state.slices = []; wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo(); stateSave();
    });
    document.getElementById('btn-fill-break').addEventListener('click', fillBreak);

    document.getElementById('btn-export').addEventListener('click', async () => {
        const btn = document.getElementById('btn-export');
        btn.textContent = '... rendering'; btn.disabled = true;
        try {
            const blob = await exportWav();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = 'amen-pattern.wav'; a.click();
            URL.revokeObjectURL(url);
        } catch (err) { alert('Erro: ' + err.message); }
        finally { btn.textContent = '↓ WAV'; btn.disabled = false; }
    });

    document.getElementById('btn-save-proj').addEventListener('click', () => {
        const totalLen = state.audioBuffer?.length || 1;
        const proj = {
            v: 1,
            bpm: state.bpm, lpb: state.lpb, numSteps: state.numSteps,
            numTracks: state.numTracks, swing: state.swing,
            pattern: state.pattern,
            muted: _trackMuted.slice(0, state.numTracks),
            sampleName: document.getElementById('sample-name').textContent.replace(/^⟳ /,''),
            slices: state.slices.map(s => ({ sf: s.start/totalLen, ef: s.end/totalLen, note: s.note })),
        };
        const name = (proj.sampleName || 'projeto').replace(/\.[^.]+$/, '');
        const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `${name}.json`; a.click();
        URL.revokeObjectURL(url);
    });

    const projInput = document.getElementById('proj-file-input');
    document.getElementById('btn-load-proj').addEventListener('click', () => projInput.click());
    projInput.addEventListener('change', e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const d = JSON.parse(ev.target.result);
                state.bpm       = d.bpm      ?? 174;
                state.lpb       = d.lpb      ?? 4;
                state.numSteps  = d.numSteps ?? 32;
                state.numTracks = d.numTracks?? 4;
                state.swing     = d.swing    ?? 0;
                if (d.pattern?.length === state.numSteps && d.pattern[0]?.length === state.numTracks)
                    state.pattern = d.pattern;
                else
                    state.pattern = makePattern(state.numSteps, state.numTracks);
                if (Array.isArray(d.muted)) d.muted.forEach((v,i) => { _trackMuted[i] = !!v; });

                const savedName   = d.sampleName || '';
                const fracs       = d.slices?.length ? d.slices : null;
                const currentName = document.getElementById('sample-name').textContent.replace(/^⟳ /,'');

                if (state.audioBuffer && fracs && savedName && savedName === currentName) {
                    const total  = state.audioBuffer.length;
                    state.slices = fracs.map(f => ({
                        start: Math.round(f.sf * total),
                        end:   Math.round(f.ef * total),
                        note:  f.note,
                    }));
                    _pendingSliceFracs = null;
                    _savedSampleName   = savedName;
                } else {
                    _savedSampleName   = savedName;
                    _pendingSliceFracs = fracs;
                    if (savedName)
                        document.getElementById('sample-name').textContent = '⟳ ' + savedName;
                }

                document.getElementById('bpm').value        = state.bpm;
                document.getElementById('lpb').value        = state.lpb;
                document.getElementById('steps').value      = state.numSteps;
                document.getElementById('num-tracks').value = state.numTracks;
                document.getElementById('swing').value      = state.swing;
                document.getElementById('swing-val').textContent = state.swing + '%';
                trkBuildTable();
                wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
                stateSave();
            } catch(err) { alert('Erro ao carregar projeto: ' + err.message); }
        };
        reader.readAsText(file);
        projInput.value = '';
    });

    window.addEventListener('resize', wfDraw);
});
