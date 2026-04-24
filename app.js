const NOTE_NAMES  = ['C-','C#','D-','D#','E-','F-','F#','G-','G#','A-','A#','B-'];
const BASE_OCTAVE = 4;
const SLICE_KEYS  = ['Z','S','X','D','C','V','G','B','H','N','J','M','Q','2','W','3','E','R','5','T','6','Y','7','U'];

let _trackMuted        = [false,false,false,false,false,false];
let _trackSolo         = [false,false,false,false,false,false];
let _trackVol          = [1.0,  1.0,  1.0,  1.0,  1.0,  1.0 ];
let _trackPitch        = [0,    0,    0,    0,    0,    0    ];
let _savedSampleNames  = ['','','','','',''];
let _pendingSliceFracs = [null,null,null,null,null,null];
let _keyInfos          = [null,null,null,null,null,null];

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
    trkBuildTable(); stateSave();
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
function makeCell()               { return { note: null, vol: 0xff, volCmd: null, fx: null }; }
function makeStep(n)              { return Array.from({ length: n }, makeCell); }
function makePattern(steps, trks) { return Array.from({ length: steps }, () => makeStep(trks)); }

function resizePattern(pat, newSteps, newTracks) {
    return Array.from({length: newSteps}, (_, s) =>
        Array.from({length: newTracks}, (_, t) => {
            const c = pat[s]?.[t];
            return c ? { note: c.note, vol: c.vol, fx: c.fx ? {...c.fx} : null } : makeCell();
        })
    );
}

function stretchPattern(pat, oldSteps, newSteps, numTracks) {
    const newPat = makePattern(newSteps, numTracks);
    for (let s = 0; s < oldSteps; s++) {
        const ns = Math.round(s * newSteps / oldSteps);
        if (ns >= newSteps) continue;
        for (let t = 0; t < numTracks; t++) {
            const src = pat[s]?.[t];
            if (src?.note && !newPat[ns][t].note) {
                newPat[ns][t] = { note: src.note, vol: src.vol, fx: src.fx ? {...src.fx} : null };
            }
        }
    }
    return newPat;
}

const state = {
    bpm: 174, lpb: 4, numSteps: 32, numTracks: 4, swing: 0,
    pattern: null,
    patterns: null,
    currentPage: 0,
    arrangement: [0],
    arrEnabled: false,
    audioBuffers: new Array(6).fill(null),
    trackSlices:  Array.from({length: 6}, () => []),
};
state.patterns   = [makePattern(state.numSteps, state.numTracks)];
state.pattern    = state.patterns[0];

let sel = { step: 0, track: 0, col: 0, endStep: 0, endTrack: 0 };
let _trkMouseDown = false;
let _sampleTrack  = 0;

function curBuf()    { return state.audioBuffers[_sampleTrack]; }
function curSlices() { return state.trackSlices[_sampleTrack]; }

function trackSlicesToSave(t) {
    const buf = state.audioBuffers[t];
    if (buf) {
        const tot = buf.length;
        return state.trackSlices[t].map(s => ({ sf: s.start/tot, ef: s.end/tot, note: s.note }));
    }
    return _pendingSliceFracs[t] || [];
}

function stateSave() {
    try {
        localStorage.setItem('amen-tracker-v2', JSON.stringify({
            bpm: state.bpm, lpb: state.lpb, numSteps: state.numSteps,
            numTracks: state.numTracks, swing: state.swing,
            patterns: state.patterns,
            currentPage: state.currentPage,
            arrangement: state.arrangement,
            arrEnabled: state.arrEnabled,
            muted: _trackMuted.slice(0, state.numTracks),
            tracks: Array.from({length: state.numTracks}, (_, t) => ({
                sampleName: _savedSampleNames[t],
                slices: trackSlicesToSave(t),
                vol: _trackVol[t],
                pitch: _trackPitch[t],
            })),
        }));
    } catch(_) {}
}

function stateLoad() {
    try {
        let raw = localStorage.getItem('amen-tracker-v2');
        let v1  = false;
        if (!raw) { raw = localStorage.getItem('amen-tracker-v1'); v1 = true; }
        if (!raw) return false;
        const d = JSON.parse(raw);
        state.bpm       = d.bpm      ?? 174;
        state.lpb       = d.lpb      ?? 4;
        state.numSteps  = d.numSteps ?? 32;
        state.numTracks = d.numTracks?? 4;
        state.swing     = d.swing    ?? 0;
        if (Array.isArray(d.patterns) && d.patterns.length) {
            state.patterns = d.patterns;
        } else if (d.pattern?.length === state.numSteps && d.pattern[0]?.length === state.numTracks) {
            state.patterns = [d.pattern];
        } else {
            state.patterns = [makePattern(state.numSteps, state.numTracks)];
        }
        state.currentPage = Math.min(d.currentPage ?? 0, state.patterns.length - 1);
        state.pattern     = state.patterns[state.currentPage];
        state.arrangement = Array.isArray(d.arrangement) && d.arrangement.length ? d.arrangement : [0];
        state.arrEnabled  = !!d.arrEnabled;
        if (Array.isArray(d.muted)) d.muted.forEach((v,i) => { _trackMuted[i] = !!v; });

        if (!v1 && Array.isArray(d.tracks)) {
            d.tracks.forEach((tr, i) => {
                _savedSampleNames[i]  = tr.sampleName || '';
                _pendingSliceFracs[i] = tr.slices?.length ? tr.slices : null;
                _trackVol[i]          = tr.vol   ?? 1.0;
                _trackPitch[i]        = tr.pitch  ?? 0;
            });
        } else if (d.sampleName) {
            _savedSampleNames[0]  = d.sampleName;
            _pendingSliceFracs[0] = d.slices?.length ? d.slices : null;
        }

        document.getElementById('bpm').value        = state.bpm;
        document.getElementById('lpb').value        = state.lpb;
        document.getElementById('steps').value      = state.numSteps;
        document.getElementById('num-tracks').value = state.numTracks;
        document.getElementById('swing').value      = state.swing;
        document.getElementById('swing-val').textContent = state.swing + '%';
        if (_savedSampleNames[0])
            document.getElementById('sample-name').textContent = '⟳ ' + _savedSampleNames[0];
        return true;
    } catch(_) { return false; }
}

let _audioCtx   = null;
let _masterGain = null;
let _masterVol  = 0.9;
const _lastTrack = {}; // trackIdx -> { src, gain }

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

function extractSliceBuffer(sliceIndex, reverse, trackIdx) {
    const t      = trackIdx ?? sel.track;
    const ac     = getCtx();
    const buf    = state.audioBuffers[t];
    const slices = state.trackSlices[t];
    if (!buf || !slices[sliceIndex]) return null;
    const { start, end } = slices[sliceIndex];
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
    const sliceBuf = extractSliceBuffer(sliceIndex, reverse, trackIdx);
    if (!sliceBuf) return null;
    const src  = ac.createBufferSource();
    src.buffer = sliceBuf;
    src.playbackRate.value = Math.pow(2, pitchSemi / 12);
    const gain = ac.createGain();
    gain.gain.value = Math.max(0, Math.min(2, vol));
    src.connect(gain); gain.connect(_masterGain);
    const offset = Math.max(0, Math.min(sampleOffset, sliceBuf.duration - 0.001));
    src.start(startTime, offset);
    if (cutTime > 0) src.stop(startTime + cutTime);
    if (trackIdx !== undefined) _lastTrack[trackIdx] = { src, gain };
    return src;
}

function stopTrack(trackIdx, audioTime) {
    const t = _lastTrack[trackIdx];
    if (t) { try { t.src.stop(audioTime); } catch (_) {} delete _lastTrack[trackIdx]; }
}

function scheduleCell(cell, stepDuration, audioTime, trackIdx) {
    if (!cell) return;
    const anySolo = _trackSolo.some((v, i) => i < state.numTracks && v);
    if (_trackMuted[trackIdx] || (anySolo && !_trackSolo[trackIdx])) return;
    if (cell.note === 'OFF') { stopTrack(trackIdx, audioTime); return; }
    if (!cell.note) {
        if (cell.volCmd !== null && cell.volCmd !== undefined) {
            const trk = _lastTrack[trackIdx];
            if (trk?.gain) {
                const v = (cell.volCmd / 0xff) * (_trackVol[trackIdx] ?? 1.0);
                trk.gain.gain.setValueAtTime(Math.max(0, Math.min(2, v)), audioTime);
            }
        }
        return;
    }
    const si     = noteToSliceIndex(cell.note);
    const slices = state.trackSlices[trackIdx];
    const buf    = state.audioBuffers[trackIdx];
    if (si < 0 || si >= slices.length) return;

    const vol = (cell.vol ?? 0xff) / 0xff * (_trackVol[trackIdx] ?? 1.0);
    let pitchSemi = _trackPitch[trackIdx] ?? 0, reverse = false, retrigger = 1, sampleOffset = 0, cutTime = 0;
    if (cell.fx) {
        const v = cell.fx.value;
        if (cell.fx.type === 'P') pitchSemi += v;
        if (cell.fx.type === 'B') reverse   = true;
        if (cell.fx.type === 'R') retrigger = Math.max(1, v);
        if (cell.fx.type === 'S' && buf) {
            const sl = slices[si];
            sampleOffset = (v / 0xff) * (sl.end - sl.start) / buf.sampleRate;
        }
        if (cell.fx.type === 'C') cutTime = (v / 0xff) * stepDuration;
    }
    const opts = { vol, pitchSemi, reverse, sampleOffset, cutTime };
    if (retrigger > 1) {
        const iv = stepDuration / retrigger;
        for (let i = 0; i < retrigger; i++) playSliceAt(si, opts, audioTime + i * iv, trackIdx);
    } else {
        playSliceAt(si, opts, audioTime, trackIdx);
    }
}

function previewSlice(si) {
    const ac = getCtx();
    playSliceAt(si, { vol: 1 }, ac.currentTime, _sampleTrack);
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
        const pos = i * hop;
        if (pos - lastPoint < minGap) continue;
        const flux = Math.max(0, energy[i] - energy[i - 1]);
        let bg = 0;
        const s = Math.max(0, i - bgWin);
        for (let k = s; k < i; k++) bg += energy[k];
        bg /= (i - s);
        if (energy[i] > 0.005 && flux > bg * scale) { points.push(pos); lastPoint = pos; }
    }
    return points;
}

function buildSlices(framePositions, totalFrames) {
    const pts = [...new Set(framePositions)].sort((a, b) => a - b);
    state.trackSlices[_sampleTrack] = pts.map((start, i) => ({
        start, end: pts[i + 1] ?? totalFrames, note: sliceIndexToNote(i),
    }));
    stateSave();
}

function addManualSlice(normX) {
    if (!curBuf()) return;
    const frame    = Math.floor(normX * curBuf().length);
    const existing = curSlices().map(s => s.start);
    if (existing.includes(frame)) return;
    existing.push(frame);
    buildSlices(existing, curBuf().length);
}

function bpmFromFilename(name) {
    const nums = (name.match(/\d+/g) || []).map(Number).filter(n => n >= 60 && n <= 300);
    return nums.length ? nums[nums.length - 1] : null;
}

const SEQ_LOOKAHEAD = 0.12;
const SEQ_TICK_MS   = 25;
let _seqPlaying = false, _seqStep = 0, _seqNextTime = 0, _seqTimer = null, _seqOnStep = null;
let _seqArrPos  = 0;

function seqStepDur() { return 60 / (state.bpm * state.lpb); }

function seqTick() {
    const ac = getCtx();
    while (_seqNextTime < ac.currentTime + SEQ_LOOKAHEAD) {
        const dur    = seqStepDur();
        const swing  = (_seqStep % 2 === 1) ? dur * (state.swing / 100) : 0;
        const playAt = _seqNextTime + swing;
        for (let t = 0; t < state.numTracks; t++)
            scheduleCell(state.pattern[_seqStep]?.[t], dur, playAt, t);
        if (_seqOnStep) _seqOnStep(_seqStep);
        _seqNextTime += dur;
        _seqStep++;
        if (_seqStep >= state.numSteps) {
            _seqStep = 0;
            if (state.arrEnabled && state.arrangement.length) {
                _seqArrPos = (_seqArrPos + 1) % state.arrangement.length;
                const next = state.arrangement[_seqArrPos];
                if (next !== state.currentPage) {
                    state.currentPage = next;
                    state.pattern     = state.patterns[next] || state.patterns[0];
                    setTimeout(() => { updatePageSel(); updateArrangeBar(); }, 0);
                }
            }
        }
    }
    _seqTimer = setTimeout(seqTick, SEQ_TICK_MS);
}

function seqPlay(onStep) {
    if (_seqPlaying) return;
    _seqOnStep = onStep || null; _seqPlaying = true;
    _seqStep = 0; _seqArrPos = 0;
    if (state.arrEnabled && state.arrangement.length) {
        const start   = state.arrangement[0];
        state.currentPage = start;
        state.pattern     = state.patterns[start] || state.patterns[0];
        updatePageSel(); updateArrangeBar();
    }
    _seqNextTime = getCtx().currentTime + 0.05;
    seqTick();
}
function seqStop() {
    _seqPlaying = false; clearTimeout(_seqTimer); _seqTimer = null; _seqStep = 0;
    if (_seqOnStep) _seqOnStep(-1);
}

let _wfSmall, _wfSmallCtx, _wfBig, _wfBigCtx;
let _wfModalOpen = false;
let _wfZoom = 1, _wfOffset = 0, _wfDrag = null, _wfMoved = false;

function wfAC()  { return _wfModalOpen ? _wfBig    : _wfSmall; }
function wfACx() { return _wfModalOpen ? _wfBigCtx : _wfSmallCtx; }
function wfClampOffset(o) { return Math.max(0, Math.min(1 - 1 / _wfZoom, o)); }
function wfPxToNorm(px) { return _wfOffset + (px / (wfAC().offsetWidth || 1)) / _wfZoom; }
function wfNormToPx(n, canvas) {
    const c = canvas || wfAC();
    return (n - _wfOffset) * _wfZoom * (c.offsetWidth || 1);
}
function wfNearSlice(px, thresh) {
    thresh = thresh || 8;
    if (!curBuf()) return -1;
    const total = curBuf().length;
    let best = -1, bestD = thresh + 1;
    curSlices().forEach((sl, i) => {
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
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

    const buf    = curBuf();
    const slices = curSlices();

    if (!buf) {
        ctx.fillStyle = '#333'; ctx.font = '11px Courier New'; ctx.textAlign = 'center';
        ctx.fillText('no sample loaded', W/2, H/2 + 4);
        return;
    }

    const data     = buf.getChannelData(0);
    const total    = data.length;
    const mid      = H / 2;
    const visStart = Math.floor(_wfOffset * total);
    const visEnd   = Math.min(total, Math.ceil((_wfOffset + 1 / _wfZoom) * total));
    const visLen   = visEnd - visStart;
    const stride   = Math.max(1, Math.floor(visLen / W));
    const peaks    = new Float32Array(W * 2);
    for (let px = 0; px < W; px++) {
        const i0 = visStart + Math.floor((px / W) * visLen);
        let mn = 0, mx = 0;
        for (let k = 0; k < stride && i0 + k < total; k++) {
            const v = data[i0 + k];
            if (v < mn) mn = v; if (v > mx) mx = v;
        }
        peaks[px * 2] = mn; peaks[px * 2 + 1] = mx;
    }
    ctx.beginPath(); ctx.moveTo(0, mid);
    for (let px = 0; px < W; px++) ctx.lineTo(px, mid + peaks[px*2+1] * mid * 0.95);
    for (let px = W - 1; px >= 0; px--) ctx.lineTo(px, mid + peaks[px*2] * mid * 0.95);
    ctx.closePath(); ctx.fillStyle = 'rgba(220,220,220,0.9)'; ctx.fill();

    slices.forEach((sl, i) => {
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

    const endNorm = (state.numSteps * seqStepDur()) / buf.duration;
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
        if (!curBuf()) return;
        const r       = canvas.getBoundingClientRect();
        const curNorm = _wfOffset + ((e.clientX - r.left) / (canvas.offsetWidth || 1)) / _wfZoom;
        const factor  = e.deltaY < 0 ? 1.4 : 1 / 1.4;
        _wfZoom   = Math.max(1, Math.min(128, _wfZoom * factor));
        _wfOffset = wfClampOffset(curNorm - (e.clientX - r.left) / (canvas.offsetWidth || 1) / _wfZoom);
        wfDraw(); wfUpdateInfo();
    }, { passive: false });

    canvas.addEventListener('mousedown', e => {
        if (!curBuf() || e.button !== 0) return;
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
        if (!curBuf()) return;
        const r  = canvas.getBoundingClientRect();
        const px = e.clientX - r.left;
        const si = wfNearSlice(px, 12);
        if (si >= 0) {
            buildSlices(curSlices().map(s => s.start).filter((_, i) => i !== si), curBuf().length);
            wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
        } else {
            const norm  = _wfOffset + (px / (canvas.offsetWidth || 1)) / _wfZoom;
            const frame = Math.floor(norm * curBuf().length);
            let nearest = 0, minDist = Infinity;
            curSlices().forEach((sl, i) => { const d = Math.abs(sl.start - frame); if (d < minDist) { minDist = d; nearest = i; } });
            previewSlice(nearest);
        }
    });
}

window.addEventListener('mousemove', e => {
    if (!_wfDrag || !curBuf()) return;
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
        const newFrame = Math.round(newNorm * curBuf().length);
        const frames   = curSlices().map(s => s.start);
        frames[_wfDrag.sliceIdx] = newFrame;
        buildSlices(frames, curBuf().length);
        canvas.style.cursor = 'ew-resize';
    }
    wfDraw();
});

window.addEventListener('mouseup', e => {
    _trkMouseDown = false;
    if (!_wfDrag) return;
    const canvas = _wfDrag.canvas || wfAC();
    if (!_wfMoved && _wfDrag.type === 'pan' && curBuf()) {
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
    if (!el || !curBuf()) return;
    el.textContent = `${curSlices().length} slices  ·  zoom ${_wfZoom.toFixed(1)}×  ·  ${curBuf().duration.toFixed(2)}s`;
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
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && _wfModalOpen) wfCloseModal(); });
    wfDraw();
}

function buildLegend() {
    const legend = document.getElementById('slice-legend');
    legend.innerHTML = '';
    const total  = curBuf()?.length ?? 1;
    curSlices().forEach((sl, i) => {
        const div  = document.createElement('div'); div.className = 'slice-item';
        const ns   = document.createElement('span'); ns.className = 'slice-note';
        ns.textContent = SLICE_KEYS[i] || sl.note;
        const bar  = document.createElement('div'); bar.className = 'slice-bar';
        const fill = document.createElement('div'); fill.className = 'slice-bar-fill';
        fill.style.width = `${((sl.end - sl.start) / total) * 100}%`;
        bar.appendChild(fill); div.appendChild(ns); div.appendChild(bar);
        div.addEventListener('click', () => previewSlice(i));
        legend.appendChild(div);
    });
}

function updateTimingInfo() {
    const el  = document.getElementById('timing-info');
    if (!el) return;
    const buf = curBuf();
    if (!buf) { el.textContent = ''; return; }
    const patDur = state.numSteps * seqStepDur();
    const smDur  = buf.duration;
    const diff   = patDur - smDur;
    const fmt    = s => s.toFixed(2) + 's';
    let status, color;
    if (Math.abs(diff) < 0.05)  { status = '✓ SYNC'; color = '#50e050'; }
    else if (diff > 0)           { status = `+${fmt(diff)} pattern longo`; color = '#e0a030'; }
    else                         { status = `${fmt(diff)} sample longo`;   color = '#e0a030'; }
    el.innerHTML =
        `<span style="color:#555">pattern</span> ${fmt(patDur)} &nbsp;` +
        `<span style="color:#555">sample</span> ${fmt(smDur)} &nbsp;` +
        `<span style="color:${color}">${status}</span>`;
}

function fillBreak() {
    const slices = curSlices();
    if (!slices.length) { alert('Carregue um sample e fatie primeiro.'); return; }
    pushUndo();
    const n = slices.length;
    const t = _sampleTrack;
    for (let s = 0; s < state.numSteps; s++) state.pattern[s][t] = makeCell();
    for (let i = 0; i < n && i < state.numSteps; i++) {
        const step = Math.round((i / n) * state.numSteps);
        if (step < state.numSteps) {
            state.pattern[step][t].note = sliceIndexToNote(i);
            state.pattern[step][t].vol  = 0xff;
        }
    }
    trkBuildTable(); stateSave();
}

function equalSlices(n) {
    if (!curBuf()) return;
    const total  = curBuf().length;
    const points = Array.from({ length: n }, (_, i) => Math.floor((i / n) * total));
    buildSlices(points, total);
    wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
}

const QWERTY_LOWER = { z:0,s:1,x:2,d:3,c:4,v:5,g:6,b:7,h:8,n:9,j:10,m:11 };
const QWERTY_UPPER = { q:0,2:1,w:2,3:3,e:4,r:5,5:6,t:7,6:8,y:9,7:10,u:11 };

function buildArrangeBar() {
    const container = document.getElementById('arrange-slots');
    if (!container) return;
    container.innerHTML = '';
    state.arrangement.forEach((pageIdx, i) => {
        const btn = document.createElement('button');
        btn.className   = 'arr-slot' + (_seqArrPos === i && state.arrEnabled && _seqPlaying ? ' arr-active' : '');
        btn.textContent = String.fromCharCode(65 + (pageIdx % 26));
        btn.title       = `Slot ${i+1}: Padrão ${String.fromCharCode(65 + pageIdx)} — clique para trocar, right-click para remover`;
        btn.addEventListener('click', () => {
            state.arrangement[i] = (state.arrangement[i] + 1) % state.patterns.length;
            buildArrangeBar(); stateSave();
        });
        btn.addEventListener('contextmenu', e => {
            e.preventDefault();
            state.arrangement.splice(i, 1);
            if (!state.arrangement.length) state.arrangement = [0];
            buildArrangeBar(); stateSave();
        });
        container.appendChild(btn);
    });
}

function updateArrangeBar() {
    document.querySelectorAll('.arr-slot').forEach((btn, i) => {
        btn.classList.toggle('arr-active', _seqArrPos === i && state.arrEnabled && _seqPlaying);
    });
}

function switchPage(n) {
    state.currentPage = Math.max(0, Math.min(n, state.patterns.length - 1));
    state.pattern     = state.patterns[state.currentPage];
    trkBuildTable();
    updatePageSel();
    stateSave();
}

function addPage(clone) {
    const newPat = clone
        ? JSON.parse(JSON.stringify(state.pattern))
        : makePattern(state.numSteps, state.numTracks);
    state.patterns.push(newPat);
    switchPage(state.patterns.length - 1);
}

function delPage() {
    if (state.patterns.length <= 1) return;
    state.patterns.splice(state.currentPage, 1);
    switchPage(Math.min(state.currentPage, state.patterns.length - 1));
}

function buildPageSel() {
    const container = document.getElementById('page-sel');
    if (!container) return;
    container.innerHTML = '';
    state.patterns.forEach((_, i) => {
        const btn = document.createElement('button');
        btn.className   = 'page-btn' + (i === state.currentPage ? ' active' : '');
        btn.textContent = String.fromCharCode(65 + i);
        btn.title       = `Padrão ${String.fromCharCode(65 + i)}`;
        btn.addEventListener('click', () => switchPage(i));
        container.appendChild(btn);
    });
}

function updatePageSel() {
    const btns = document.querySelectorAll('.page-btn');
    if (btns.length !== state.patterns.length) { buildPageSel(); return; }
    btns.forEach((b, i) => b.classList.toggle('active', i === state.currentPage));
}

function trkBuildTable() {
    const head = document.getElementById('tracker-head');
    const body = document.getElementById('tracker-body');
    head.innerHTML = ''; body.innerHTML = '';

    const hr1 = document.createElement('tr');
    const st  = document.createElement('th'); st.colSpan = 2; hr1.appendChild(st);
    for (let t = 0; t < state.numTracks; t++) {
        const th = document.createElement('th');
        th.colSpan = 3; th.style.textAlign = 'center';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:3px;margin-bottom:2px;flex-wrap:wrap';
        const lbl = document.createElement('span'); lbl.textContent = `T${t+1}`;
        lbl.style.cssText = 'font-size:9px;color:#777;letter-spacing:1px';

        const mb = document.createElement('button');
        mb.className = 'btn-mute'; mb.textContent = 'M';
        mb.classList.toggle('muted', !!_trackMuted[t]);
        mb.addEventListener('click', e => {
            e.stopPropagation();
            _trackMuted[t] = !_trackMuted[t];
            mb.classList.toggle('muted', _trackMuted[t]); stateSave();
        });

        const sb = document.createElement('button');
        sb.className = 'btn-solo'; sb.textContent = 'S';
        sb.classList.toggle('soloed', !!_trackSolo[t]);
        sb.addEventListener('click', e => {
            e.stopPropagation();
            _trackSolo[t] = !_trackSolo[t];
            sb.classList.toggle('soloed', _trackSolo[t]);
        });

        const clrBtn = document.createElement('button');
        clrBtn.className = 'btn-trk-action'; clrBtn.textContent = 'CLR';
        clrBtn.title = 'Limpar notas desta track no pattern atual';
        clrBtn.addEventListener('click', e => {
            e.stopPropagation(); pushUndo();
            for (let s = 0; s < state.numSteps; s++) {
                const cell = state.pattern[s][t];
                cell.note = null; cell.vol = 0xff; cell.fx = null;
            }
            state.audioBuffers[t]   = null;
            state.trackSlices[t]    = [];
            _pendingSliceFracs[t]   = null;
            _savedSampleNames[t]    = '';
            _trackVol[t]            = 1.0;
            _trackPitch[t]          = 0;
            if (_sampleTrack === t) refreshSamplePanel();
            trkBuildTable(); stateSave();
        });

        const rndBtn = document.createElement('button');
        rndBtn.className = 'btn-trk-action'; rndBtn.textContent = 'RND';
        rndBtn.title = 'Preencher com notas aleatórias';
        rndBtn.addEventListener('click', e => {
            e.stopPropagation(); pushUndo();
            const slices = state.trackSlices[t];
            if (!slices.length) return;
            const lpb      = state.lpb;
            const halfBeat = Math.max(1, Math.floor(lpb / 2));
            const quarter  = Math.max(1, Math.floor(lpb / 4));

            for (let s = 0; s < state.numSteps; s++) {
                const cell = state.pattern[s][t];

                // probability by rhythmic position
                let prob = 0.10;
                if      (s === 0)               prob = 1.00; // downbeat always
                else if (s % lpb === 0)         prob = 0.75; // beat
                else if (s % halfBeat === 0)    prob = 0.40; // half-beat
                else if (s % quarter === 0)     prob = 0.22; // quarter

                if (Math.random() < prob) {
                    // weighted slice: 60% chance of picking from first third (fundamental hits)
                    const pool = Math.random() < 0.60
                        ? Math.min(Math.ceil(slices.length / 3), slices.length)
                        : slices.length;
                    const si = Math.floor(Math.random() * pool);
                    cell.note = sliceIndexToNote(si);

                    // velocity: mostly loud, some medium, rare ghost
                    const vr = Math.random();
                    if      (vr < 0.12) cell.vol = 0x30 + Math.floor(Math.random() * 0x40); // ghost
                    else if (vr < 0.30) cell.vol = 0xA0 + Math.floor(Math.random() * 0x40); // medium
                    else                cell.vol = 0xff;

                    // occasional retrigger FX on offbeats
                    if (s % lpb !== 0 && Math.random() < 0.15) {
                        cell.fx = { type: 'R', value: [2, 3, 4][Math.floor(Math.random() * 3)] };
                    } else {
                        cell.fx = null;
                    }
                } else {
                    cell.note = null; cell.vol = 0xff; cell.fx = null;
                }
            }
            trkBuildTable(); stateSave();
        });

        topRow.appendChild(lbl); topRow.appendChild(mb); topRow.appendChild(sb);
        topRow.appendChild(clrBtn); topRow.appendChild(rndBtn);

        const volRow = document.createElement('div');
        volRow.style.cssText = 'display:flex;align-items:center;gap:4px;justify-content:center;margin-bottom:2px';
        const volLbl = document.createElement('span'); volLbl.textContent = 'VOL'; volLbl.style.cssText = 'font-size:8px;color:#555';
        const volSlider = document.createElement('input');
        volSlider.type = 'range'; volSlider.min = 0; volSlider.max = 150; volSlider.step = 1;
        volSlider.value = Math.round((_trackVol[t] ?? 1.0) * 100);
        volSlider.className = 'trk-vol-slider';
        const volVal = document.createElement('span'); volVal.className = 'trk-vol-val';
        volVal.textContent = volSlider.value + '%';
        volSlider.addEventListener('input', () => {
            _trackVol[t] = parseInt(volSlider.value) / 100;
            volVal.textContent = volSlider.value + '%';
            stateSave();
        });
        volRow.appendChild(volLbl); volRow.appendChild(volSlider); volRow.appendChild(volVal);

        const pitchRow = document.createElement('div');
        pitchRow.style.cssText = 'display:flex;align-items:center;gap:3px;justify-content:center;margin-bottom:2px';
        const pitchLbl = document.createElement('span'); pitchLbl.textContent = 'TUNE'; pitchLbl.style.cssText = 'font-size:8px;color:#555';
        const pitchDn  = document.createElement('button'); pitchDn.className = 'btn-trk-action'; pitchDn.textContent = '−';
        const pitchVal = document.createElement('span'); pitchVal.className = 'trk-pitch-val';
        const showPitch = v => { pitchVal.textContent = (v > 0 ? '+' : '') + v; pitchVal.style.color = v === 0 ? '#444' : '#c09030'; };
        showPitch(_trackPitch[t] ?? 0);
        const pitchUp  = document.createElement('button'); pitchUp.className = 'btn-trk-action'; pitchUp.textContent = '+';
        pitchDn.addEventListener('click', e => {
            e.stopPropagation();
            _trackPitch[t] = Math.max(-24, (_trackPitch[t] ?? 0) - 1);
            showPitch(_trackPitch[t]); stateSave();
        });
        pitchUp.addEventListener('click', e => {
            e.stopPropagation();
            _trackPitch[t] = Math.min(24, (_trackPitch[t] ?? 0) + 1);
            showPitch(_trackPitch[t]); stateSave();
        });
        pitchVal.addEventListener('dblclick', e => {
            e.stopPropagation();
            _trackPitch[t] = 0; showPitch(0); stateSave();
        });
        pitchRow.appendChild(pitchLbl); pitchRow.appendChild(pitchDn); pitchRow.appendChild(pitchVal); pitchRow.appendChild(pitchUp);

        const nameEl = document.createElement('div');
        nameEl.id        = `trk-sample-name-${t}`;
        nameEl.className = 'trk-sample-label';
        const sn = _savedSampleNames[t];
        nameEl.textContent = sn ? sn.replace(/\.[^.]+$/, '').substring(0, 16) : '';
        nameEl.title = sn || '';

        th.appendChild(topRow); th.appendChild(volRow); th.appendChild(pitchRow); th.appendChild(nameEl);
        hr1.appendChild(th);
        if (t < state.numTracks - 1) {
            const sep = document.createElement('th'); sep.className = 'track-sep'; hr1.appendChild(sep);
        }
    }
    head.appendChild(hr1);

    const hr2 = document.createElement('tr');
    hr2.appendChild(document.createElement('th'));
    const e2 = document.createElement('th'); e2.className = 'track-sep'; hr2.appendChild(e2);
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
                td.dataset.step = s; td.dataset.track = t; td.dataset.col = c;
                td.classList.add(['cell-note','cell-vol','cell-fx'][c]);
                td.addEventListener('mousedown', e => {
                    const prevTrack = sel.track;
                    sel = { step:s, track:t, col:c, endStep:s, endTrack:t };
                    _trkMouseDown = true;
                    trkRefreshSel();
                    if (t !== prevTrack) refreshSamplePanel(t);
                    if (e.button === 2) {
                        pushUndo();
                        const cell = state.pattern[s][t];
                        cell.note = null; cell.vol = 0xff; cell.fx = null;
                        trkRefreshCells(s, t); return;
                    }
                    if (c === 0) {
                        const cell = state.pattern[s][t];
                        if (cell.note && cell.note !== 'OFF') {
                            const si = noteToSliceIndex(cell.note); if (si >= 0) previewSlice(si);
                        }
                    }
                });
                td.addEventListener('mouseover', () => {
                    if (!_trkMouseDown) return;
                    sel.endStep = s; sel.endTrack = t; trkRefreshSel();
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
    return document.querySelector(`#tracker-body td[data-step="${step}"][data-track="${track}"][data-col="${col}"]`);
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
        if (!cell.note || cell.note === 'OFF') {
            if (cell.volCmd !== null && cell.volCmd !== undefined) {
                text = cell.volCmd.toString(16).toUpperCase().padStart(2,'0');
            } else { text = '--'; empty = true; }
        } else text = (cell.vol ?? 0xff).toString(16).toUpperCase().padStart(2,'0');
    } else {
        text = fxStr(cell.fx); empty = !cell.fx;
    }
    td.textContent = text;
    td.classList.toggle('cell-empty', empty);
    td.classList.toggle('cell-off', isOff);
    td.classList.toggle('cell-volcmd', col === 1 && !cell.note && cell.volCmd !== null && cell.volCmd !== undefined);
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
    const s1 = Math.min(sel.step, sel.endStep), s2 = Math.max(sel.step, sel.endStep);
    const t1 = Math.min(sel.track, sel.endTrack), t2 = Math.max(sel.track, sel.endTrack);
    for (let s = s1; s <= s2; s++)
        for (let t = t1; t <= t2; t++)
            for (let c = 0; c < 3; c++) {
                const td = trkGetTd(s, t, c);
                if (td) td.classList.add('cell-selected');
            }
    const anchor = trkGetTd(sel.step, sel.track, sel.col);
    if (anchor) anchor.scrollIntoView({ block:'nearest', inline:'nearest' });
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

function buildTrackSelector() {
    const container = document.getElementById('sample-track-sel');
    if (!container) return;
    container.innerHTML = '';
    for (let t = 0; t < state.numTracks; t++) {
        const btn = document.createElement('button');
        btn.className = 'trk-sel-btn';
        btn.dataset.t = t;
        const sn = _savedSampleNames[t];
        btn.innerHTML = `T${t+1}${sn ? `<span class="tsb-name">${sn.replace(/\.[^.]+$/,'').substring(0,10)}</span>` : ''}`;
        btn.title = sn || `Track ${t+1} — sem sample`;
        btn.addEventListener('click', () => {
            _sampleTrack = t;
            refreshSamplePanel();
        });
        container.appendChild(btn);
    }
    updateTrackSelector();
}

function updateTrackSelector() {
    document.querySelectorAll('.trk-sel-btn').forEach(btn => {
        const t  = parseInt(btn.dataset.t);
        const sn = _savedSampleNames[t];
        btn.classList.toggle('active', t === _sampleTrack);
        btn.innerHTML = `T${t+1}${sn ? `<span class="tsb-name">${sn.replace(/\.[^.]+$/,'').substring(0,10)}</span>` : ''}`;
        btn.title = sn || `Track ${t+1} — sem sample`;
    });
    const dz = document.querySelector('#dropzone .drop-text');
    if (dz) dz.innerHTML = `DROP SAMPLE → T${_sampleTrack+1}<br><span>ou clique para abrir</span>`;
}

function refreshSamplePanel(newTrack) {
    if (newTrack !== undefined) _sampleTrack = newTrack;
    const t  = _sampleTrack;
    const sn = _savedSampleNames[t];
    document.getElementById('sample-name').textContent = sn || '';
    showKeyInfo(_keyInfos[t]);
    _wfZoom = 1; _wfOffset = 0;
    wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
    const hasBuf = !!state.audioBuffers[t];
    ['btn-auto-slice','btn-clear-slices','btn-fill-break','btn-slice-8','btn-slice-16','btn-slice-32']
        .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !hasBuf; });
    updateTrackSelector();
}

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (_wfModalOpen) {
        const sk = e.key.toUpperCase();
        const si = SLICE_KEYS.indexOf(sk);
        if (si >= 0) previewSlice(si);
        if (e.key === 'Escape') wfCloseModal();
        return;
    }
    const key = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); undoPop(); return; }
    if ((e.ctrlKey || e.metaKey) && key === 'c') {
        e.preventDefault();
        const s1 = Math.min(sel.step, sel.endStep), s2 = Math.max(sel.step, sel.endStep);
        const t1 = Math.min(sel.track, sel.endTrack), t2 = Math.max(sel.track, sel.endTrack);
        _copyBuf = [];
        for (let s = s1; s <= s2; s++) {
            const row = [];
            for (let t = t1; t <= t2; t++) row.push(JSON.parse(JSON.stringify(state.pattern[s][t])));
            _copyBuf.push(row);
        }
        return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'v') {
        e.preventDefault();
        if (!_copyBuf?.length) return;
        pushUndo();
        const { step, track } = sel;
        for (let ds = 0; ds < _copyBuf.length; ds++)
            for (let dt = 0; dt < _copyBuf[ds].length; dt++) {
                const s = step + ds, t = track + dt;
                if (s < state.numSteps && t < state.numTracks) {
                    state.pattern[s][t] = JSON.parse(JSON.stringify(_copyBuf[ds][dt]));
                    for (let c = 0; c < 3; c++) trkUpdateCell(null, s, t, c);
                }
            }
        sel.endStep  = Math.min(state.numSteps  - 1, step  + _copyBuf.length - 1);
        sel.endTrack = Math.min(state.numTracks - 1, track + _copyBuf[0].length - 1);
        trkRefreshSel(); stateSave();
        return;
    }

    if (key === 'arrowdown')  { e.preventDefault(); trkMove(1, 0, 0); return; }
    if (key === 'arrowup')    { e.preventDefault(); trkMove(-1, 0, 0); return; }
    if (key === 'arrowleft')  { e.preventDefault(); trkMove(0, 0, -1); return; }
    if (key === 'arrowright') { e.preventDefault(); trkMove(0, 0, 1); return; }
    if (key === 'tab')        { e.preventDefault(); trkMove(0, e.shiftKey ? -1 : 1, 0); return; }
    if (key === 'delete' || key === 'backspace') {
        e.preventDefault(); pushUndo();
        const s1 = Math.min(sel.step, sel.endStep), s2 = Math.max(sel.step, sel.endStep);
        const t1 = Math.min(sel.track, sel.endTrack), t2 = Math.max(sel.track, sel.endTrack);
        if (s1 === s2 && t1 === t2) { trkClearCell(); }
        else {
            for (let s = s1; s <= s2; s++)
                for (let t = t1; t <= t2; t++) {
                    const cell = state.pattern[s][t];
                    cell.note = null; cell.vol = 0xff; cell.fx = null;
                    for (let c = 0; c < 3; c++) trkUpdateCell(null, s, t, c);
                }
            stateSave();
        }
        return;
    }

    const { step, track, col } = sel;
    if (col === 0) {
        if (key === ']') {
            pushUndo();
            const cell = state.pattern[step][track];
            cell.note = 'OFF'; cell.fx = null;
            trkRefreshCells(step, track); trkMove(1, 0, 0); return;
        }
        const noteIdx = QWERTY_LOWER[key] ?? QWERTY_UPPER[key] ?? -1;
        if (noteIdx >= 0) {
            pushUndo();
            const oct  = (QWERTY_UPPER[key] !== undefined) ? BASE_OCTAVE + 1 : BASE_OCTAVE;
            trkSetNote(step, track, `${NOTE_NAMES[noteIdx]}${oct}`);
            trkMove(1, 0, 0); return;
        }
        if (key === 'f1' || key === 'f2') { e.preventDefault(); pushUndo(); trkShiftOctave(step, track, key === 'f2' ? 1 : -1); return; }
    }
    if (col === 1) {
        if (/^[0-9a-f]$/i.test(key)) {
            const cell = state.pattern[step]?.[track]; if (!cell) return;
            pushUndo();
            if (cell.note && cell.note !== 'OFF') {
                const cur = (cell.vol ?? 0xff).toString(16).padStart(2,'0');
                cell.vol = parseInt(cur[1] + key, 16);
            } else {
                const cur = (cell.volCmd ?? 0x00).toString(16).padStart(2,'0');
                cell.volCmd = parseInt(cur[1] + key, 16);
            }
            trkRefreshCells(step, track); trkMove(1, 0, 0); return;
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
    if (cell.fx && (key === '+' || key === '=')) { cell.fx.value = Math.min(0xff, cell.fx.value + 1); trkRefreshCells(step, track); return; }
    if (cell.fx && key === '-')                  { cell.fx.value = Math.max(0, cell.fx.value - 1);    trkRefreshCells(step, track); return; }
    if (cell.fx && /^[0-9a-f]$/i.test(key)) {
        const cur = cell.fx.value.toString(16).padStart(2,'0');
        cell.fx.value = parseInt(cur[1] + key, 16);
        trkRefreshCells(step, track); return;
    }
}

function trkMove(dStep, dTrack, dCol) {
    const prevTrack = sel.track;
    sel.col   = ((sel.col   + dCol)   % 3               + 3)               % 3;
    sel.track = ((sel.track + dTrack) % state.numTracks  + state.numTracks)  % state.numTracks;
    sel.step  = ((sel.step  + dStep)  % state.numSteps   + state.numSteps)   % state.numSteps;
    sel.endStep = sel.step; sel.endTrack = sel.track;
    trkRefreshSel();
    if (sel.track !== prevTrack) refreshSamplePanel(sel.track);
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
    if (col === 1) { if (cell.note && cell.note !== 'OFF') cell.vol = 0xff; else cell.volCmd = null; }
    if (col === 2) cell.fx = null;
    trkRefreshCells(step, track);
}

const AUDIO_EXTS = new Set(['wav','mp3','aif','aiff','ogg','flac']);
let _kitsAll = [], _kitsFiltered = [], _kitsPreviewCtx = null, _kitsPreviewSrc = null;
let _kitsUseHttp = false;
let _kitsDirStack = []; // [{name, handle?, node?}]
let _kitsHttpTree  = null;

function kitsMount() {
    document.getElementById('kits-search').addEventListener('input', e => kitsFilter(e.target.value));
    document.getElementById('btn-change-folder').addEventListener('click', kitsOpenFolder);
}

function buildHttpTree(files) {
    const root = { dirs: {}, files: [] };
    files.forEach(f => {
        const parts = f.path.split('/');
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!node.dirs[p]) node.dirs[p] = { dirs: {}, files: [] };
            node = node.dirs[p];
        }
        node.files.push(f);
    });
    return root;
}

async function kitsTryHttp() {
    try {
        const r = await fetch('./kits-index.json');
        if (!r.ok) return false;
        const paths = await r.json();
        _kitsAll     = paths.map(p => ({ name: p.split('/').pop(), path: p }));
        _kitsUseHttp = true;
        _kitsHttpTree = buildHttpTree(_kitsAll);
        _kitsDirStack = [{ name: 'kits', node: _kitsHttpTree, handle: null }];
        await kitsRenderDir();
        return true;
    } catch (_) { return false; }
}

async function kitsOpenFolder() {
    if (!window.showDirectoryPicker) { alert('Use Chrome ou Edge.'); return; }
    try {
        const dir = await window.showDirectoryPicker({ mode: 'read' });
        _kitsUseHttp  = false;
        _kitsAll      = [];
        _kitsDirStack = [{ name: dir.name, handle: dir, node: null }];
        document.getElementById('kits-search').value = '';
        await kitsRenderDir();
        document.getElementById('kits-status').textContent = 'scanning...';
        const results = [];
        async function scan(dh, base) {
            for await (const [name, handle] of dh.entries()) {
                if (name.startsWith('.') || name.startsWith('__')) continue;
                const fp = base ? `${base}/${name}` : name;
                if (handle.kind === 'directory') await scan(handle, fp);
                else if (AUDIO_EXTS.has(name.split('.').pop().toLowerCase()))
                    results.push({ name, path: fp, handle });
            }
        }
        await scan(dir, '');
        _kitsAll = results;
        document.getElementById('kits-status').textContent = `${results.length} samples total`;
    } catch (e) {
        if (e.name !== 'AbortError')
            document.getElementById('kits-status').textContent = 'erro: ' + e.message;
    }
}

async function kitsEnter(name, handle, node) {
    _kitsDirStack.push({ name, handle: handle || null, node: node || null });
    document.getElementById('kits-search').value = '';
    await kitsRenderDir();
}

async function kitsGoTo(i) {
    _kitsDirStack.splice(i + 1);
    await kitsRenderDir();
}

async function kitsRenderDir() {
    const cur  = _kitsDirStack[_kitsDirStack.length - 1];
    const list = document.getElementById('kits-list');
    list.innerHTML = '';
    let dirs = [], files = [];

    if (_kitsUseHttp && cur.node) {
        dirs  = Object.entries(cur.node.dirs).map(([name, node]) => ({ name, node })).sort((a,b) => a.name.localeCompare(b.name));
        files = [...cur.node.files].sort((a,b) => a.name.localeCompare(b.name));
    } else if (!_kitsUseHttp && cur.handle) {
        for await (const [name, handle] of cur.handle.entries()) {
            if (name.startsWith('.') || name.startsWith('__')) continue;
            if (handle.kind === 'directory') dirs.push({ name, handle });
            else if (AUDIO_EXTS.has(name.split('.').pop().toLowerCase())) files.push({ name, handle });
        }
        dirs.sort((a,b)  => a.name.localeCompare(b.name));
        files.sort((a,b) => a.name.localeCompare(b.name));
    }

    dirs.forEach(d => {
        const li = document.createElement('li');
        li.className = 'kit-folder-item';
        li.innerHTML = `<span class="kit-folder-icon">▶</span><span class="kit-folder-name">${d.name}</span>`;
        li.addEventListener('click',    () => kitsEnter(d.name, d.handle || null, d.node || null));
        list.appendChild(li);
    });

    _kitsFiltered = files;
    files.forEach((f, i) => {
        const li = document.createElement('li'); li.dataset.idx = i;
        const ns = document.createElement('span'); ns.className = 'kit-name'; ns.textContent = f.name;
        li.appendChild(ns);
        li.addEventListener('click',    () => kitsSelect(li, i, false));
        li.addEventListener('dblclick', () => kitsSelect(li, i, true));
        list.appendChild(li);
    });

    kitsBreadcrumb();
    document.getElementById('kits-status').textContent = `${dirs.length > 0 ? dirs.length + ' pastas · ' : ''}${files.length} samples`;
}

function kitsBreadcrumb() {
    const bc = document.getElementById('kits-breadcrumb');
    if (!bc) return;
    bc.innerHTML = '';
    _kitsDirStack.forEach((item, i) => {
        const span = document.createElement('span');
        span.className = 'kit-bc';
        span.textContent = item.name;
        span.addEventListener('click', () => kitsGoTo(i));
        bc.appendChild(span);
        if (i < _kitsDirStack.length - 1) {
            const sep = document.createElement('span'); sep.className = 'kit-bc-sep'; sep.textContent = ' › ';
            bc.appendChild(sep);
        }
    });
}

function kitsFilter(q) {
    const lq = q.toLowerCase().trim();
    if (!lq) { kitsRenderDir(); return; }
    _kitsFiltered = _kitsAll.filter(f => f.path.toLowerCase().includes(lq) || f.name.toLowerCase().includes(lq));
    const list = document.getElementById('kits-list');
    list.innerHTML = '';
    _kitsFiltered.forEach((f, i) => {
        const li = document.createElement('li'); li.dataset.idx = i;
        const parts = f.path.split('/'); parts.pop(); const fdir = parts.join('/');
        if (fdir) { const ds = document.createElement('span'); ds.className = 'kit-dir'; ds.textContent = fdir + '/'; li.appendChild(ds); }
        const ns = document.createElement('span'); ns.className = 'kit-name'; ns.textContent = f.name; li.appendChild(ns);
        li.addEventListener('click',    () => kitsSelect(li, i, false));
        li.addEventListener('dblclick', () => kitsSelect(li, i, true));
        list.appendChild(li);
    });
    const bc = document.getElementById('kits-breadcrumb'); if (bc) bc.innerHTML = '';
    document.getElementById('kits-status').textContent = `${_kitsFiltered.length} resultados`;
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
    await kitsPreviewBuf(await (await fetch(path)).arrayBuffer());
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

async function exportWav(pageIndices) {
    const pages    = pageIndices && pageIndices.length ? pageIndices : [state.currentPage];
    const sr       = 44100;
    const stepDur  = 60 / (state.bpm * state.lpb);
    const pageDur  = stepDur * state.numSteps;
    const totalDur = pageDur * pages.length + 2;
    const offCtx   = new OfflineAudioContext(2, Math.ceil(totalDur * sr), sr);
    const master   = offCtx.createGain(); master.gain.value = 0.9; master.connect(offCtx.destination);
    // per-track gain nodes so volCmd can automate volume mid-pattern
    const offTrackGain = Array.from({length: state.numTracks}, (_, t) => {
        const g = offCtx.createGain(); g.gain.value = _trackVol[t] ?? 1.0; g.connect(master); return g;
    });
    let hasContent = false;

    function extractOff(si, reverse, t) {
        const buf    = state.audioBuffers[t];
        const slices = state.trackSlices[t];
        if (!buf || !slices[si]) return null;
        const sl = slices[si]; const len = sl.end - sl.start; if (len <= 0) return null;
        const out = offCtx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const s = buf.getChannelData(ch).subarray(sl.start, sl.end);
            const d = out.getChannelData(ch);
            if (reverse) { for (let i = 0; i < len; i++) d[i] = s[len-1-i]; } else d.set(s);
        }
        return out;
    }

    pages.forEach((pageIdx, pi) => {
        const pattern  = state.patterns[pageIdx] || state.patterns[0];
        const pageBase = pi * pageDur;
        for (let s = 0; s < state.numSteps; s++) {
            const swing    = (s % 2 === 1) ? stepDur * (state.swing / 100) : 0;
            const baseTime = pageBase + s * stepDur + swing;
            for (let t = 0; t < state.numTracks; t++) {
                const cell = pattern[s]?.[t]; if (!cell) continue;
                // volCmd without note
                if (!cell.note && cell.volCmd !== null && cell.volCmd !== undefined) {
                    const v = (cell.volCmd / 0xff);
                    offTrackGain[t].gain.setValueAtTime(Math.max(0, Math.min(2, v)), baseTime);
                    hasContent = true;
                    continue;
                }
                if (!cell.note || cell.note === 'OFF') continue;
                const si   = noteToSliceIndex(cell.note);
                const buf  = state.audioBuffers[t]; const slices = state.trackSlices[t];
                if (si < 0 || si >= slices.length || !buf) continue;
                hasContent = true;
                const vol  = (cell.vol ?? 0xff) / 0xff;
                let pitchSemi = _trackPitch[t] ?? 0, reverse = false, retrigger = 1, sampleOffset = 0, cutTime = 0;
                if (cell.fx) {
                    const fv = cell.fx.value;
                    if (cell.fx.type === 'P') pitchSemi += fv;
                    if (cell.fx.type === 'B') reverse   = true;
                    if (cell.fx.type === 'R') retrigger = Math.max(1, fv);
                    if (cell.fx.type === 'S') sampleOffset = (fv / 0xff) * (slices[si].end - slices[si].start) / buf.sampleRate;
                    if (cell.fx.type === 'C') cutTime = (fv / 0xff) * stepDur;
                }
                const sched = t0 => {
                    const sbuf = extractOff(si, reverse, t); if (!sbuf) return;
                    const src  = offCtx.createBufferSource();
                    src.buffer = sbuf; src.playbackRate.value = Math.pow(2, pitchSemi / 12);
                    const g    = offCtx.createGain(); g.gain.value = Math.max(0, Math.min(2, vol));
                    src.connect(g); g.connect(offTrackGain[t]);
                    src.start(t0, Math.max(0, Math.min(sampleOffset, sbuf.duration - 0.001)));
                    if (cutTime > 0) src.stop(t0 + cutTime);
                };
                if (retrigger > 1) { const iv = stepDur / retrigger; for (let i = 0; i < retrigger; i++) sched(baseTime + i * iv); }
                else sched(baseTime);
            }
        }
    });

    if (!hasContent) throw new Error('Sem notas no padrão.');
    return bufToWav(await offCtx.startRendering());
}

function bufToWav(buf) {
    const numCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
    const bps = 2, ba = numCh * bps, ds = len * ba;
    const ab  = new ArrayBuffer(44 + ds); const view = new DataView(ab);
    const ws  = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o+i, s.charCodeAt(i)); };
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
    const n = curSlices().length;
    document.getElementById('slice-count').textContent =
        n === 0 ? 'nenhum slice' : `${n} slices — click=adicionar  right-click=preview`;
}

async function loadSampleFile(file) {
    await loadSampleBuffer(file.name, await file.arrayBuffer());
}

async function loadSampleBuffer(name, ab) {
    const t           = _sampleTrack;
    const ac          = getCtx();
    const pendingName = _savedSampleNames[t];

    _savedSampleNames[t] = name;
    document.getElementById('sample-name').textContent = name;
    state.audioBuffers[t] = await ac.decodeAudioData(ab);
    _wfZoom = 1; _wfOffset = 0;
    ['btn-auto-slice','btn-clear-slices','btn-fill-break','btn-slice-8','btn-slice-16','btn-slice-32']
        .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });

    const detectedBpm = bpmFromFilename(name);
    if (detectedBpm) { state.bpm = detectedBpm; document.getElementById('bpm').value = detectedBpm; }

    setTimeout(() => { _keyInfos[t] = analyzeKey(state.audioBuffers[t]); showKeyInfo(_keyInfos[t]); }, 0);

    if (_pendingSliceFracs[t] && name === pendingName) {
        const total = state.audioBuffers[t].length;
        state.trackSlices[t] = _pendingSliceFracs[t].map(f => ({
            start: Math.round(f.sf * total), end: Math.round(f.ef * total), note: f.note,
        }));
        _pendingSliceFracs[t] = null;
        wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
    } else {
        _pendingSliceFracs[t] = null;
        autoSlice();
    }

    const nameEl = document.getElementById(`trk-sample-name-${t}`);
    if (nameEl) { nameEl.textContent = name.replace(/\.[^.]+$/, '').substring(0, 16); nameEl.title = name; }
    updateTrackSelector();
    stateSave();
}

function freqToNote(freq) {
    if (!freq || freq <= 0) return null;
    const semis = 12 * Math.log2(freq / 440);
    const n     = Math.round(semis);
    const cents = Math.round((semis - n) * 100);
    const oct   = Math.floor(n / 12) + 4;
    const name  = NOTE_NAMES[((n % 12) + 12) % 12];
    return { name, oct, cents, freq: Math.round(freq) };
}

function analyzeKey(buffer) {
    const data   = buffer.getChannelData(0);
    const sr     = buffer.sampleRate;
    const step   = 4;
    const effSr  = sr / step;
    const rawLen = Math.min(data.length, Math.floor(sr * 3));
    const len    = Math.floor(rawLen / step);
    const samples = new Float32Array(len);
    for (let i = 0; i < len; i++) samples[i] = data[i * step];
    const minLag = Math.floor(effSr / 700);
    const maxLag = Math.floor(effSr / 55);
    const winLen = len - maxLag;
    if (winLen < 100) return null;
    let bestTau = minLag, bestCorr = -Infinity;
    for (let tau = minLag; tau < maxLag; tau++) {
        let corr = 0;
        for (let i = 0; i < winLen; i++) corr += samples[i] * samples[i + tau];
        if (corr > bestCorr) { bestCorr = corr; bestTau = tau; }
    }
    return freqToNote(effSr / bestTau);
}

function showKeyInfo(result) {
    const el = document.getElementById('key-info');
    if (!el) return;
    if (!result) { el.innerHTML = ''; return; }
    const sign  = result.cents >= 0 ? '+' : '';
    const color = Math.abs(result.cents) < 15 ? '#50c050' : '#e0a030';
    el.innerHTML =
        `<span style="color:#555;font-size:10px">pitch dominante</span>` +
        `<span class="key-note">${result.name}${result.oct}</span>` +
        `<span class="key-cents" style="color:${color}">${sign}${result.cents}¢</span>` +
        `<span class="key-hz">${result.freq}Hz</span>`;
}


function autoSlice() {
    if (!curBuf()) return;
    const sens   = parseInt(document.getElementById('sensitivity').value);
    const points = detectTransients(curBuf(), sens);
    buildSlices(points, curBuf().length);
    wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo();
}

window.addEventListener('DOMContentLoaded', () => {
    stateLoad();
    trkBuildTable();
    buildPageSel();
    buildTrackSelector();
    wfInit();
    kitsMount();

    kitsTryHttp().then(ok => {
        if (!ok) document.getElementById('kits-status').textContent = 'use INICIAR.bat para auto-carregar kits';
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'analyze') { window.open('analyze.html', '_blank'); return; }
            switchTab(btn.dataset.tab);
        });
    });

    document.getElementById('bpm').addEventListener('change', e => {
        state.bpm = parseInt(e.target.value) || 174; wfDraw(); updateTimingInfo(); stateSave();
    });
    document.getElementById('lpb').addEventListener('change', e => {
        const oldLpb   = state.lpb;
        const oldSteps = state.numSteps;
        state.lpb      = Math.max(1, parseInt(e.target.value) || 4);
        const beats    = oldSteps / oldLpb;
        state.numSteps = Math.max(8, Math.min(256, Math.round(beats * state.lpb)));
        document.getElementById('steps').value = state.numSteps;
        state.patterns = state.patterns.map(p => stretchPattern(p, oldSteps, state.numSteps, state.numTracks));
        state.pattern  = state.patterns[state.currentPage];
        trkBuildTable(); wfDraw(); updateTimingInfo(); stateSave();
    });
    document.getElementById('steps').addEventListener('change', e => {
        const newSteps = Math.max(8, Math.min(256, parseInt(e.target.value) || state.numSteps));
        e.target.value = newSteps;
        state.numSteps = newSteps;
        state.patterns = state.patterns.map(p => resizePattern(p, state.numSteps, state.numTracks));
        state.pattern  = state.patterns[state.currentPage];
        trkBuildTable(); wfDraw(); updateTimingInfo(); stateSave();
    });
    document.getElementById('num-tracks').addEventListener('change', e => {
        state.numTracks = parseInt(e.target.value);
        if (_sampleTrack >= state.numTracks) _sampleTrack = 0;
        state.patterns = state.patterns.map(p => resizePattern(p, state.numSteps, state.numTracks));
        state.pattern  = state.patterns[state.currentPage];
        trkBuildTable(); buildTrackSelector(); stateSave();
    });
    document.getElementById('master-vol').addEventListener('input', e => {
        _masterVol = parseInt(e.target.value) / 100;
        document.getElementById('vol-val').textContent = e.target.value + '%';
        if (_masterGain) _masterGain.gain.value = _masterVol;
    });
    document.getElementById('swing').addEventListener('input', e => {
        state.swing = parseInt(e.target.value);
        document.getElementById('swing-val').textContent = e.target.value + '%'; stateSave();
    });

    document.getElementById('btn-page-add'  ).addEventListener('click', () => addPage(false));
    document.getElementById('btn-page-clone').addEventListener('click', () => addPage(true));
    document.getElementById('btn-page-del'  ).addEventListener('click', delPage);

    buildArrangeBar();
    const btnArrToggle = document.getElementById('btn-arr-toggle');
    btnArrToggle.textContent = state.arrEnabled ? 'ON' : 'OFF';
    if (state.arrEnabled) btnArrToggle.classList.add('on');
    btnArrToggle.addEventListener('click', () => {
        state.arrEnabled = !state.arrEnabled;
        btnArrToggle.textContent = state.arrEnabled ? 'ON' : 'OFF';
        btnArrToggle.classList.toggle('on', state.arrEnabled);
        stateSave();
    });
    document.getElementById('btn-arr-add').addEventListener('click', () => {
        state.arrangement.push(state.currentPage);
        buildArrangeBar(); stateSave();
    });
    document.getElementById('btn-arr-clear').addEventListener('click', () => {
        state.arrangement = [state.currentPage];
        buildArrangeBar(); stateSave();
    });

    document.getElementById('btn-export-arr').addEventListener('click', async () => {
        const btn = document.getElementById('btn-export-arr');
        btn.textContent = '... rendering'; btn.disabled = true;
        try {
            const pages = state.arrEnabled && state.arrangement.length
                ? state.arrangement
                : state.patterns.map((_, i) => i);
            const blob = await exportWav(pages);
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = 'amen-full.wav'; a.click();
            URL.revokeObjectURL(url);
        } catch (err) { alert('Erro: ' + err.message); }
        finally { btn.textContent = '↓ ALL'; btn.disabled = false; }
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
        document.getElementById('btn-play').textContent = '▶ PLAY';
        document.getElementById('btn-play').classList.remove('active');
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
        state.trackSlices[_sampleTrack] = [];
        wfDraw(); buildLegend(); updateSliceCount(); updateTimingInfo(); stateSave();
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
        const proj = {
            v: 2, bpm: state.bpm, lpb: state.lpb, numSteps: state.numSteps,
            numTracks: state.numTracks, swing: state.swing,
            patterns: state.patterns,
            currentPage: state.currentPage,
            arrangement: state.arrangement,
            arrEnabled: state.arrEnabled,
            muted: _trackMuted.slice(0, state.numTracks),
            tracks: Array.from({length: state.numTracks}, (_, t) => ({
                sampleName: _savedSampleNames[t],
                slices: trackSlicesToSave(t),
                vol: _trackVol[t],
                pitch: _trackPitch[t],
            })),
        };
        const firstName = _savedSampleNames.find(n => n) || 'projeto';
        const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `${firstName.replace(/\.[^.]+$/, '')}.json`; a.click();
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
                if (Array.isArray(d.patterns) && d.patterns.length) {
                    state.patterns = d.patterns;
                } else if (d.pattern) {
                    state.patterns = [d.pattern];
                } else {
                    state.patterns = [makePattern(state.numSteps, state.numTracks)];
                }
                state.currentPage = Math.min(d.currentPage ?? 0, state.patterns.length - 1);
                state.pattern     = state.patterns[state.currentPage];
                state.arrangement = Array.isArray(d.arrangement) && d.arrangement.length ? d.arrangement : [0];
                state.arrEnabled  = !!d.arrEnabled;
                if (Array.isArray(d.muted)) d.muted.forEach((v,i) => { _trackMuted[i] = !!v; });

                if (Array.isArray(d.tracks)) {
                    d.tracks.forEach((tr, i) => {
                        const savedName = tr.sampleName || '';
                        const fracs     = tr.slices?.length ? tr.slices : null;
                        _savedSampleNames[i]  = savedName;
                        _pendingSliceFracs[i] = fracs;
                        _trackVol[i]          = tr.vol   ?? 1.0;
                        _trackPitch[i]        = tr.pitch  ?? 0;
                        const buf = state.audioBuffers[i];
                        if (buf && fracs && savedName) {
                            const total = buf.length;
                            state.trackSlices[i] = fracs.map(f => ({
                                start: Math.round(f.sf * total), end: Math.round(f.ef * total), note: f.note,
                            }));
                            _pendingSliceFracs[i] = null;
                        }
                        const nameEl = document.getElementById(`trk-sample-name-${i}`);
                        if (nameEl) { nameEl.textContent = savedName.replace(/\.[^.]+$/, '').substring(0, 16); nameEl.title = savedName; }
                    });
                } else if (d.sampleName) {
                    _savedSampleNames[0]  = d.sampleName;
                    _pendingSliceFracs[0] = d.slices?.length ? d.slices : null;
                }

                document.getElementById('bpm').value        = state.bpm;
                document.getElementById('lpb').value        = state.lpb;
                document.getElementById('steps').value      = state.numSteps;
                document.getElementById('num-tracks').value = state.numTracks;
                document.getElementById('swing').value      = state.swing;
                document.getElementById('swing-val').textContent = state.swing + '%';
                trkBuildTable(); buildPageSel(); buildArrangeBar(); refreshSamplePanel();
                const tog = document.getElementById('btn-arr-toggle');
                if (tog) { tog.textContent = state.arrEnabled ? 'ON' : 'OFF'; tog.classList.toggle('on', state.arrEnabled); }
                stateSave();
            } catch(err) { alert('Erro ao carregar projeto: ' + err.message); }
        };
        reader.readAsText(file); projInput.value = '';
    });

    window.addEventListener('resize', wfDraw);
});
