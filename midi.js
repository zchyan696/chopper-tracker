'use strict';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALE_DEFS = {
    major:      { name: 'MAJOR',      intervals: [0, 2, 4, 5, 7, 9, 11] },
    minor:      { name: 'MINOR',      intervals: [0, 2, 3, 5, 7, 8, 10] },
    harmonic:   { name: 'HARMONIC',   intervals: [0, 2, 3, 5, 7, 8, 11] },
    melodic:    { name: 'MELODIC',    intervals: [0, 2, 3, 5, 7, 9, 11] },
    dorian:     { name: 'DORIAN',     intervals: [0, 2, 3, 5, 7, 9, 10] },
    phrygian:   { name: 'PHRYGIAN',   intervals: [0, 1, 3, 5, 7, 8, 10] },
    lydian:     { name: 'LYDIAN',     intervals: [0, 2, 4, 6, 7, 9, 11] },
    mixolydian: { name: 'MIXOLYDIAN', intervals: [0, 2, 4, 5, 7, 9, 10] },
    pentMajor:  { name: 'PENT MAJ',   intervals: [0, 2, 4, 7, 9] },
    pentMinor:  { name: 'PENT MIN',   intervals: [0, 3, 5, 7, 10] },
    blues:      { name: 'BLUES',      intervals: [0, 3, 5, 6, 7, 10] },
};
const CHROMATIC_KEY_MAP = [
    { code: 'KeyA', semi: 0,  label: 'A' },
    { code: 'KeyW', semi: 1,  label: 'W' },
    { code: 'KeyS', semi: 2,  label: 'S' },
    { code: 'KeyE', semi: 3,  label: 'E' },
    { code: 'KeyD', semi: 4,  label: 'D' },
    { code: 'KeyF', semi: 5,  label: 'F' },
    { code: 'KeyT', semi: 6,  label: 'T' },
    { code: 'KeyG', semi: 7,  label: 'G' },
    { code: 'KeyY', semi: 8,  label: 'Y' },
    { code: 'KeyH', semi: 9,  label: 'H' },
    { code: 'KeyU', semi: 10, label: 'U' },
    { code: 'KeyJ', semi: 11, label: 'J' },
    { code: 'KeyK', semi: 12, label: 'K' },
    { code: 'KeyO', semi: 13, label: 'O' },
    { code: 'KeyL', semi: 14, label: 'L' },
    { code: 'KeyP', semi: 15, label: 'P' },
    { code: 'Semicolon', semi: 16, label: ';' },
    { code: 'Quote', semi: 17, label: '\'' },
];
const SCALE_LINE_KEY_MAP = [
    { code: 'KeyA', degree: 0,  label: 'A' },
    { code: 'KeyS', degree: 1,  label: 'S' },
    { code: 'KeyD', degree: 2,  label: 'D' },
    { code: 'KeyF', degree: 3,  label: 'F' },
    { code: 'KeyG', degree: 4,  label: 'G' },
    { code: 'KeyH', degree: 5,  label: 'H' },
    { code: 'KeyJ', degree: 6,  label: 'J' },
    { code: 'KeyK', degree: 7,  label: 'K' },
    { code: 'KeyL', degree: 8,  label: 'L' },
    { code: 'Semicolon', degree: 9, label: ';' },
    { code: 'Quote', degree: 10, label: '\'' },
    { code: 'BracketLeft', degree: 11, label: '[' },
    { code: 'BracketRight', degree: 12, label: ']' },
];
const STORE_KEY = 'amen-midi-room-v2';
const ROLL_MIN_MIDI = 48;
const ROLL_MAX_MIDI = 84;
const SNAP_DIVISIONS = { 8: 2, 16: 4, 32: 8 };
const SERVER = 'http://127.0.0.1:7270';
const KEY_TEMPLATES = {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
const DEFAULT_REFERENCE_GAIN = 0.36;
const UNDO_LIMIT = 120;
const ROLL_LABEL_W = 54;

const state = {
    root: 'C',
    scale: 'major',
    octave: 4,
    bpm: 174,
    keyboardMode: 'chromatic',
    notes: [],
    selectedNoteIds: [],
    selectedRange: null,
    stepInput: false,
    stepCursor: 0,
    loopPlayback: false,
    snap: 16,
    viewStart: 0,
    viewDuration: 4,
    noteSeq: 1,
    isPlaying: false,
    playStartAudioTime: 0,
    playFrom: 0,
    playTo: 0,
    playheadTime: 0,
    playTimerIds: [],
    isRecording: false,
    isCountIn: false,
    countInBeats: 4,
    countInEnd: 0,
    metronomeOn: true,
    referenceEnabled: true,
    pendingRecord: null,
    recordStart: 0,
    recordOffset: 0,
    recordLimit: null,
    activeVoices: new Map(),
    heldCodes: new Map(),
    recordHeld: new Map(),
    referenceBuffer: null,
    referenceName: '',
    referenceUrl: '',
    referenceDuration: 0,
    referenceBpm: null,
    referenceKey: '',
    referencePeaks: null,
    referenceSelection: null,
    referenceSliceNote: '',
    referenceClips: [],
    activeReferenceClip: -1,
    serverOnline: false,
    referenceSource: null,
    hoverMidi: null,
};

let audioCtx = null;
let masterGain = null;
let rollMetrics = null;
let rollRects = [];
let rollPointer = null;
let playheadAnim = 0;
let clipboardNotes = [];
let metronomeNodes = [];
let countInTimerIds = [];
let serverTimerId = 0;
let referenceMetrics = null;
let referencePointer = null;
let overviewMetrics = null;
const undoStack = [];

function $(id) {
    return document.getElementById(id);
}

function nextNoteId() {
    return `n${state.noteSeq++}`;
}

function normalizeNote(note) {
    return {
        id: note.id || nextNoteId(),
        midi: Math.max(0, Math.min(127, Math.round(note.midi))),
        start: Math.max(0, Number(note.start) || 0),
        duration: Math.max(0.05, Number(note.duration) || 0.05),
        velocity: Math.max(1, Math.min(127, Math.round(note.velocity ?? 100))),
    };
}

function sortNotes() {
    state.notes.sort((a, b) => a.start - b.start || a.midi - b.midi || a.id.localeCompare(b.id));
}

function captureEditorState() {
    return {
        notes: state.notes.map(note => ({ ...note })),
        selectedNoteIds: state.selectedNoteIds.slice(),
        selectedRange: state.selectedRange ? { ...state.selectedRange } : null,
        stepCursor: state.stepCursor,
        noteSeq: state.noteSeq,
    };
}

function pushUndo(label) {
    undoStack.push({ label, snapshot: captureEditorState() });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function restoreSnapshot(snapshot) {
    state.notes = snapshot.notes.map(note => ({ ...note }));
    state.selectedNoteIds = snapshot.selectedNoteIds.slice();
    state.selectedRange = snapshot.selectedRange ? { ...snapshot.selectedRange } : null;
    state.stepCursor = snapshot.stepCursor;
    state.noteSeq = snapshot.noteSeq;
    clampView();
    updateSelectionInfo();
    updateHeader();
    drawRoll();
    saveState();
}

function undoEdit() {
    const entry = undoStack.pop();
    if (!entry) return;
    restoreSnapshot(entry.snapshot);
    $('midi-edit-info').textContent = `undo ${entry.label}`;
}

function status(text) {
    $('midi-status').textContent = text;
}

function getAudio() {
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new AudioContext();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.85;
        masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function beatDuration() {
    return 60 / state.bpm;
}

function gridStep() {
    return beatDuration() / SNAP_DIVISIONS[state.snap];
}

function rootPc() {
    return NOTE_NAMES.indexOf(state.root);
}

function scaleIntervals() {
    return SCALE_DEFS[state.scale]?.intervals || SCALE_DEFS.major.intervals;
}

function isScaleMidi(midi) {
    const rel = ((midi % 12) - rootPc() + 12) % 12;
    return scaleIntervals().includes(rel);
}

function midiName(midi) {
    return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function frequencyToMidi(freq) {
    return 69 + (12 * Math.log2(freq / 440));
}

function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
        root: state.root,
        scale: state.scale,
        octave: state.octave,
        bpm: state.bpm,
        keyboardMode: state.keyboardMode,
        stepInput: state.stepInput,
        stepCursor: state.stepCursor,
        loopPlayback: state.loopPlayback,
        snap: state.snap,
        viewStart: state.viewStart,
        viewDuration: state.viewDuration,
        countInBeats: state.countInBeats,
        metronomeOn: state.metronomeOn,
        referenceEnabled: state.referenceEnabled,
        referenceName: state.referenceName,
        referenceUrl: state.referenceUrl,
        referenceBpm: state.referenceBpm,
        referenceKey: state.referenceKey,
        referenceSelection: state.referenceSelection,
        referenceSliceNote: state.referenceSliceNote,
        notes: state.notes,
    }));
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        state.root = NOTE_NAMES.includes(data.root) ? data.root : state.root;
        state.scale = SCALE_DEFS[data.scale] ? data.scale : state.scale;
        state.octave = Math.max(1, Math.min(7, parseInt(data.octave, 10) || state.octave));
        state.bpm = Math.max(40, Math.min(300, parseInt(data.bpm, 10) || state.bpm));
        state.keyboardMode = data.keyboardMode === 'scale' ? 'scale' : 'chromatic';
        state.stepInput = !!data.stepInput;
        state.stepCursor = Math.max(0, Number(data.stepCursor) || 0);
        state.loopPlayback = !!data.loopPlayback;
        state.snap = SNAP_DIVISIONS[data.snap] ? Number(data.snap) : 16;
        state.viewStart = Math.max(0, Number(data.viewStart) || 0);
        state.viewDuration = Math.max(1, Number(data.viewDuration) || 4);
        state.countInBeats = [1, 2, 4, 8].includes(Number(data.countInBeats)) ? Number(data.countInBeats) : 4;
        state.metronomeOn = data.metronomeOn !== false;
        state.referenceEnabled = data.referenceEnabled !== false;
        state.referenceName = String(data.referenceName || '');
        state.referenceUrl = String(data.referenceUrl || '');
        state.referenceBpm = Number.isFinite(Number(data.referenceBpm)) ? Number(data.referenceBpm) : null;
        state.referenceKey = String(data.referenceKey || '');
        state.referenceSelection = data.referenceSelection && Number.isFinite(data.referenceSelection.start) && Number.isFinite(data.referenceSelection.end)
            ? { start: Math.max(0, Number(data.referenceSelection.start)), end: Math.max(0, Number(data.referenceSelection.end)) }
            : null;
        state.referenceSliceNote = String(data.referenceSliceNote || '');
        if (Array.isArray(data.notes)) {
            state.notes = data.notes
                .filter(note => Number.isFinite(note?.midi) && Number.isFinite(note?.start) && Number.isFinite(note?.duration))
                .map(normalizeNote);
        }
        state.noteSeq = state.notes.reduce((max, note) => {
            const n = parseInt(String(note.id || '').replace(/\D/g, ''), 10) || 0;
            return Math.max(max, n + 1);
        }, 1);
    } catch (_) {}
}

function updateHeader() {
    $('midi-root-view').textContent = state.root;
    $('midi-scale-view').textContent = SCALE_DEFS[state.scale].name;
    $('midi-octave-view').textContent = String(state.octave);
    $('midi-bpm-view').textContent = String(state.bpm);
    $('midi-ref-bpm-view').textContent = state.referenceBpm ? state.referenceBpm.toFixed(1) : '--';
    $('midi-ref-key-view').textContent = state.referenceSliceNote || '--';
    $('midi-note-count').textContent = String(state.notes.length);
    $('midi-length').textContent = `${state.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0).toFixed(2)}s`;
    $('midi-take-info').textContent = state.notes.length ? `${state.notes.length} notas gravadas` : 'nenhuma nota gravada';
    $('btn-midi-record').classList.toggle('active', state.isRecording || state.isCountIn);
    $('btn-midi-record').textContent = state.isRecording ? 'STOP REC' : (state.isCountIn ? 'COUNT IN' : 'REC');
    $('btn-midi-play').classList.toggle('active', state.isPlaying);
    $('btn-midi-play').textContent = state.isPlaying ? 'STOP' : 'PLAY';
    $('btn-midi-loop').classList.toggle('active', state.loopPlayback);
    $('btn-midi-loop').textContent = state.loopPlayback ? 'LOOP ON' : 'LOOP OFF';
    $('btn-mode-chromatic').classList.toggle('active', state.keyboardMode === 'chromatic');
    $('btn-mode-scale').classList.toggle('active', state.keyboardMode === 'scale');
    $('btn-step-input').classList.toggle('active', state.stepInput);
    $('btn-step-input').textContent = state.stepInput ? 'STEP ON' : 'STEP OFF';
    $('btn-metronome').classList.toggle('active', state.metronomeOn);
    $('btn-metronome').textContent = state.metronomeOn ? 'CLICK ON' : 'CLICK OFF';
    $('btn-ref-monitor').classList.toggle('active', state.referenceEnabled);
    $('btn-ref-monitor').textContent = state.referenceEnabled ? 'REF ON' : 'REF OFF';
    $('btn-snap-8').classList.toggle('active', state.snap === 8);
    $('btn-snap-16').classList.toggle('active', state.snap === 16);
    $('btn-snap-32').classList.toggle('active', state.snap === 32);
    $('midi-step-info').textContent = `cursor ${state.stepCursor.toFixed(2)}s · snap 1/${state.snap}`;
    $('midi-count-in').value = String(state.countInBeats);
    $('midi-ref-name').textContent = state.referenceName || 'sem referencia';
    $('midi-ref-analysis').textContent = state.referenceBuffer
        ? `bpm ${state.referenceBpm ? state.referenceBpm.toFixed(1) : '--'} · slice ${referenceSelectionLabel()} · note ${state.referenceSliceNote || '--'}`
        : 'bpm -- · slice -- · note --';
    $('midi-srv-dot').className = `srv-dot ${state.serverOnline ? 'on' : 'off'}`;
    $('midi-srv-text').textContent = state.serverOnline ? 'server online' : 'server offline';
}

function updateKeyboardHelp() {
    const primary = $('midi-help-primary');
    const secondary = $('midi-help-secondary');
    const caption = $('midi-help-caption');
    if (state.keyboardMode === 'scale') {
        primary.textContent = 'A S D F G H J K L ; \' [ ]';
        secondary.textContent = 'graus consecutivos da escala em uma linha';
        caption.textContent = `modo escala ${SCALE_DEFS[state.scale].name.toLowerCase()}`;
    } else {
        primary.textContent = 'A W S E D F T G Y H U J K O L P ; \'';
        secondary.textContent = 'brancas e pretas no layout de piano';
        caption.textContent = 'modo piano cromatico';
    }
}

function referenceSelectionLabel() {
    if (!state.referenceSelection) return '--';
    return `${state.referenceSelection.start.toFixed(2)}-${state.referenceSelection.end.toFixed(2)}s`;
}

function createReferenceClip(name, buffer) {
    return {
        name,
        audioBuffer: buffer,
        duration: buffer.duration,
        peaks: computeReferencePeaks(buffer, 1800),
        selStart: 0,
        selEnd: buffer.duration,
        viewStart: 0,
        viewEnd: null,
        sliceNote: '',
    };
}

function getActiveReferenceClip() {
    return state.activeReferenceClip >= 0 ? state.referenceClips[state.activeReferenceClip] || null : null;
}

function saveActiveReferenceClipState() {
    const clip = getActiveReferenceClip();
    if (!clip) return;
    clip.selStart = state.referenceSelection ? state.referenceSelection.start : 0;
    clip.selEnd = state.referenceSelection ? state.referenceSelection.end : clip.duration;
    clip.sliceNote = state.referenceSliceNote || '';
}

function loadReferenceClip(idx) {
    const clip = state.referenceClips[idx];
    if (!clip) return;
    state.activeReferenceClip = idx;
    state.referenceBuffer = clip.audioBuffer;
    state.referenceName = clip.name;
    state.referenceDuration = clip.duration;
    state.referencePeaks = clip.peaks;
    state.referenceSelection = { start: clip.selStart, end: clip.selEnd };
    state.referenceSliceNote = clip.sliceNote || '';
    updateHeader();
    drawReference();
    drawReferenceOverview();
    renderReferenceTabs();
}

function switchReferenceClip(idx) {
    if (idx === state.activeReferenceClip) return;
    saveActiveReferenceClipState();
    loadReferenceClip(idx);
}

function deleteReferenceClip(idx) {
    if (idx <= 0 || idx >= state.referenceClips.length) return;
    state.referenceClips.splice(idx, 1);
    const next = Math.min(state.activeReferenceClip, state.referenceClips.length - 1);
    loadReferenceClip(next);
}

function renderReferenceTabs() {
    const wrap = $('midi-ref-tabs');
    if (!wrap) return;
    wrap.innerHTML = '';
    state.referenceClips.forEach((clip, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `midi-ref-tab${index === state.activeReferenceClip ? ' active' : ''}${index > 0 ? ' cut' : ''}`;
        btn.addEventListener('click', () => switchReferenceClip(index));
        const label = document.createElement('span');
        label.textContent = clip.name;
        btn.appendChild(label);
        if (index > 0) {
            const close = document.createElement('span');
            close.className = 'midi-ref-tab-x';
            close.textContent = '×';
            close.title = 'fechar corte';
            close.addEventListener('click', event => {
                event.stopPropagation();
                deleteReferenceClip(index);
            });
            btn.appendChild(close);
        }
        wrap.appendChild(btn);
    });
    const cut = document.createElement('button');
    cut.type = 'button';
    cut.className = 'midi-ref-tab cut';
    cut.textContent = '✂ CUT SELECTION';
    cut.disabled = !state.referenceBuffer;
    cut.addEventListener('click', createReferenceCutFromSelection);
    wrap.appendChild(cut);
}

function createReferenceCutFromSelection() {
    const clip = getActiveReferenceClip();
    if (!clip || !clip.audioBuffer || !state.referenceSelection) return;
    const ss = state.referenceSelection.start;
    const se = state.referenceSelection.end;
    if (se - ss < 0.001) {
        status('selecao muito curta para cortar');
        return;
    }
    const ctx = getAudio();
    const sr = clip.audioBuffer.sampleRate;
    const s0 = Math.floor(ss * sr);
    const s1 = Math.ceil(se * sr);
    const len = Math.max(1, s1 - s0);
    const channels = clip.audioBuffer.numberOfChannels;
    const newBuf = ctx.createBuffer(channels, len, sr);
    for (let ch = 0; ch < channels; ch++) {
        newBuf.getChannelData(ch).set(clip.audioBuffer.getChannelData(ch).subarray(s0, s1));
    }
    const cutCount = state.referenceClips.filter((_, index) => index > 0).length + 1;
    const newClip = createReferenceClip(`Corte ${cutCount}`, newBuf);
    saveActiveReferenceClipState();
    state.referenceClips.push(newClip);
    loadReferenceClip(state.referenceClips.length - 1);
    status(`corte criado: ${newClip.name}`);
}

function updateLiveNote(midi) {
    $('midi-live-note-name').textContent = Number.isFinite(midi) ? midiName(midi) : '--';
}

function renderKeyboardMap() {
    const wrap = $('midi-key-map');
    if (!wrap) return;
    wrap.innerHTML = '';
    keyboardAssignments().forEach(item => {
        const row = document.createElement('div');
        row.className = 'midi-key-map-item';
        row.innerHTML = `<span class="key">${item.label}</span><span class="note">${midiName(item.midi)}</span>`;
        wrap.appendChild(row);
    });
}

function snapTime(time) {
    const step = gridStep();
    return Math.max(0, Math.round(time / step) * step);
}

function totalLength() {
    const noteEnd = state.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
    const selEnd = state.selectedRange ? state.selectedRange.end : 0;
    return Math.max(2, noteEnd, state.stepCursor + gridStep(), selEnd, state.referenceDuration || 0);
}

function clampView() {
    state.viewDuration = Math.max(0.5, Math.min(64, state.viewDuration));
    const maxStart = Math.max(0, totalLength() - state.viewDuration);
    state.viewStart = Math.max(0, Math.min(maxStart, state.viewStart));
}

function fitViewToContent() {
    const len = totalLength();
    state.viewStart = 0;
    state.viewDuration = Math.max(2, Math.min(24, Math.ceil(len * 4) / 4));
    clampView();
}

function zoomView(factor, anchorTime) {
    const anchor = anchorTime ?? (state.viewStart + state.viewDuration / 2);
    const nextDuration = Math.max(0.5, Math.min(64, state.viewDuration * factor));
    const ratio = (anchor - state.viewStart) / state.viewDuration;
    state.viewDuration = nextDuration;
    state.viewStart = anchor - (ratio * nextDuration);
    clampView();
    updateHeader();
    drawRoll();
    saveState();
}

function panView(deltaSeconds) {
    state.viewStart += deltaSeconds;
    clampView();
    updateHeader();
    drawRoll();
    saveState();
}

function playbackRange() {
    if (state.selectedRange) return { start: state.selectedRange.start, end: state.selectedRange.end };
    return { start: 0, end: totalLength() };
}

function updateSelectionInfo() {
    const el = $('midi-selection-info');
    if (state.selectedNoteIds.length) {
        el.textContent = state.selectedNoteIds.length === 1 ? '1 nota selecionada' : `${state.selectedNoteIds.length} notas selecionadas`;
        return;
    }
    if (!state.selectedRange) {
        el.textContent = 'sem selecao';
        return;
    }
    el.textContent = `regiao ${state.selectedRange.start.toFixed(2)}s -> ${state.selectedRange.end.toFixed(2)}s`;
}

function selectionTargetNotes() {
    if (state.selectedNoteIds.length) {
        return state.selectedNoteIds.map(getNoteById).filter(Boolean);
    }
    if (state.selectedRange) {
        return state.notes.filter(note => (note.start + note.duration) > state.selectedRange.start && note.start < state.selectedRange.end);
    }
    return state.notes;
}

function clampMidi(midi) {
    return Math.max(0, Math.min(127, midi));
}

function setSelectedNotes(ids) {
    state.selectedNoteIds = Array.from(new Set(ids.filter(Boolean)));
    if (state.selectedNoteIds.length) state.selectedRange = null;
    const note = state.selectedNoteIds.length ? getNoteById(state.selectedNoteIds[0]) : null;
    if (note) state.stepCursor = snapTime(note.start);
    updateSelectionInfo();
    updateHeader();
    drawRoll();
}

function setSelectedRange(start, end) {
    const a = Math.max(0, Math.min(start, end));
    const b = Math.max(0, Math.max(start, end));
    if (b - a < 0.02) {
        state.selectedRange = null;
    } else {
        const snapA = snapTime(a);
        const snapB = Math.max(snapA + gridStep(), snapTime(b));
        state.selectedRange = { start: snapA, end: snapB };
        state.stepCursor = snapA;
    }
    state.selectedNoteIds = [];
    updateSelectionInfo();
    updateHeader();
    drawRoll();
}

function setStepCursor(time) {
    state.stepCursor = Math.max(0, snapTime(time));
    updateHeader();
    drawRoll();
    saveState();
}

function advanceStepCursor(deltaSteps) {
    setStepCursor(state.stepCursor + (gridStep() * deltaSteps));
}

function getNoteById(id) {
    return state.notes.find(note => note.id === id) || null;
}

function eraseRange(start, end) {
    const out = [];
    state.notes.forEach(note => {
        const noteStart = note.start;
        const noteEnd = note.start + note.duration;
        if (noteEnd <= start || noteStart >= end) {
            out.push(note);
            return;
        }
        if (noteStart < start) {
            out.push(normalizeNote({ ...note, duration: Math.max(0.05, start - noteStart) }));
        }
        if (noteEnd > end) {
            out.push(normalizeNote({ ...note, start: end, duration: Math.max(0.05, noteEnd - end) }));
        }
    });
    state.notes = out;
    sortNotes();
}

function quantizeTarget() {
    const target = selectionTargetNotes();
    if (!target.length) return;
    pushUndo('quantize');
    target.forEach(note => {
        note.start = snapTime(note.start);
        note.duration = Math.max(gridStep(), snapTime(note.duration));
    });
    sortNotes();
    drawRoll();
    updateHeader();
    saveState();
    status('quantized');
}

function transposeTarget(semitones) {
    const target = selectionTargetNotes();
    if (!target.length) return;
    pushUndo('transpose');
    target.forEach(note => { note.midi = clampMidi(note.midi + semitones); });
    sortNotes();
    drawRoll();
    updateHeader();
    saveState();
    status(`transpose ${semitones > 0 ? '+' : ''}${semitones}`);
}

function duplicateTarget(semitones) {
    const target = selectionTargetNotes();
    if (!target.length) return;
    pushUndo('duplicate octave');
    const clones = target.map(note => normalizeNote({
        midi: clampMidi(note.midi + semitones),
        start: note.start,
        duration: note.duration,
        velocity: note.velocity,
    }));
    state.notes.push(...clones);
    sortNotes();
    drawRoll();
    updateHeader();
    saveState();
    status(`duplicated ${semitones > 0 ? '+' : ''}${semitones}`);
}

function copySelectedNotes() {
    const notes = selectionTargetNotes();
    if (!notes.length) return;
    const minStart = Math.min(...notes.map(note => note.start));
    clipboardNotes = notes.map(note => ({
        midi: note.midi,
        start: note.start - minStart,
        duration: note.duration,
        velocity: note.velocity,
    }));
    $('midi-edit-info').textContent = `${clipboardNotes.length} notas copiadas`;
}

function pasteClipboardNotes(skipUndo) {
    if (!clipboardNotes.length) return;
    if (!skipUndo) pushUndo('paste');
    const ids = [];
    clipboardNotes.forEach(note => {
        const clone = normalizeNote({
            midi: note.midi,
            start: state.stepCursor + note.start,
            duration: note.duration,
            velocity: note.velocity,
        });
        state.notes.push(clone);
        ids.push(clone.id);
    });
    sortNotes();
    clampView();
    setSelectedNotes(ids);
    saveState();
    $('midi-edit-info').textContent = `${ids.length} notas coladas`;
}

function duplicateSelectionBlock() {
    const notes = selectionTargetNotes();
    if (!notes.length) return;
    pushUndo('duplicate block');
    copySelectedNotes();
    const blockLen = Math.max(...clipboardNotes.map(note => note.start + note.duration));
    state.stepCursor = snapTime(Math.min(...notes.map(note => note.start)) + blockLen);
    pasteClipboardNotes(true);
    $('midi-edit-info').textContent = 'bloco duplicado';
}

function deleteSelectedNote() {
    if (!state.selectedNoteIds.length) return;
    pushUndo('delete');
    const kill = new Set(state.selectedNoteIds);
    state.notes = state.notes.filter(note => !kill.has(note.id));
    state.selectedNoteIds = [];
    updateSelectionInfo();
    drawRoll();
    updateHeader();
    saveState();
}

function stopVoice(midi) {
    const voice = state.activeVoices.get(midi);
    if (!voice) return;
    const ctx = getAudio();
    const now = ctx.currentTime;
    try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
        voice.oscs.forEach(osc => osc.stop(now + 0.12));
    } catch (_) {}
    state.activeVoices.delete(midi);
    document.querySelectorAll(`.piano-key[data-midi="${midi}"]`).forEach(el => el.classList.remove('active'));
}

function stopAllVoices() {
    Array.from(state.activeVoices.keys()).forEach(stopVoice);
    updateLiveNote(null);
}

function beginRecordNote(midi) {
    if (!state.isRecording) return;
    state.recordHeld.set(midi, state.recordOffset + (getAudio().currentTime - state.recordStart));
}

function endRecordNote(midi) {
    if (!state.isRecording) return;
    const start = state.recordHeld.get(midi);
    if (start === undefined) return;
    state.recordHeld.delete(midi);
    const end = state.recordOffset + (getAudio().currentTime - state.recordStart);
    const clipEnd = state.recordLimit ?? end;
    const clippedStart = Math.max(start, state.recordOffset);
    const clippedEnd = Math.min(end, clipEnd);
    if (clippedEnd <= clippedStart) return;
    state.notes.push(normalizeNote({
        midi,
        start: clippedStart,
        duration: Math.max(0.05, clippedEnd - clippedStart),
        velocity: 100,
    }));
    sortNotes();
    updateHeader();
    drawRoll();
    saveState();
}

function buildVoice(midi, startAt, duration, gainLevel) {
    const ctx = getAudio();
    const freq = midiToFrequency(midi);
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    oscA.type = 'triangle';
    oscB.type = 'sine';
    oscA.frequency.value = freq;
    oscB.frequency.value = freq / 2;
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    filter.Q.value = 1.1;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainLevel, startAt + 0.02);
    if (duration !== null) {
        gain.gain.setValueAtTime(gainLevel, startAt + Math.max(0.02, duration - 0.03));
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration + 0.03);
        oscA.stop(startAt + duration + 0.05);
        oscB.stop(startAt + duration + 0.05);
    }
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    oscA.start(startAt);
    oscB.start(startAt);
    return { oscs: [oscA, oscB], gain };
}

function playMidi(midi, source) {
    const ctx = getAudio();
    stopVoice(midi);
    const voice = buildVoice(midi, ctx.currentTime, null, 0.22);
    state.activeVoices.set(midi, voice);
    document.querySelectorAll(`.piano-key[data-midi="${midi}"]`).forEach(el => el.classList.add('active'));
    updateLiveNote(midi);
    status(`${source} ${midiName(midi)}`);
    beginRecordNote(midi);
}

function releaseMidi(midi) {
    endRecordNote(midi);
    stopVoice(midi);
    if (!state.activeVoices.size) updateLiveNote(null);
    status('pronto');
}

function schedulePlaybackNote(note, when, duration) {
    buildVoice(note.midi, getAudio().currentTime + when, duration, 0.2);
}

function previewShortMidi(midi) {
    schedulePlaybackNote({ midi }, 0, 0.12);
    status(`step ${midiName(midi)}`);
}

function clearPlaybackTimers() {
    state.playTimerIds.forEach(id => clearTimeout(id));
    state.playTimerIds = [];
}

function clearCountInTimers() {
    countInTimerIds.forEach(id => clearTimeout(id));
    countInTimerIds = [];
}

function clearMetronome() {
    metronomeNodes.forEach(node => {
        try { node.stop(); } catch (_) {}
    });
    metronomeNodes = [];
}

function scheduleMetronome(startAt, beats, startBeatIndex) {
    if (!state.metronomeOn || beats <= 0) return;
    clearMetronome();
    const ctx = getAudio();
    const beatSec = beatDuration();
    for (let i = 0; i < beats; i++) {
        const absoluteBeat = (startBeatIndex || 0) + i;
        const when = startAt + (i * beatSec);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const accent = absoluteBeat % 4 === 0;
        osc.type = 'square';
        osc.frequency.value = accent ? 1760 : 1280;
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.11, when + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(when);
        osc.stop(when + 0.06);
        metronomeNodes.push(osc);
    }
}

function stopReferencePlayback() {
    if (!state.referenceSource) return;
    try { state.referenceSource.stop(); } catch (_) {}
    state.referenceSource = null;
}

function startReferencePlayback(range, startAt, loop) {
    const clip = getActiveReferenceClip();
    if (!clip || !clip.audioBuffer || !state.referenceEnabled) return;
    stopReferencePlayback();
    const ctx = getAudio();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = DEFAULT_REFERENCE_GAIN;
    source.buffer = clip.audioBuffer;
    source.connect(gain);
    gain.connect(masterGain);
    const safeStart = Math.min(range.start, Math.max(0, clip.audioBuffer.duration - 0.02));
    const safeEnd = Math.min(range.end, clip.audioBuffer.duration);
    if (safeEnd <= safeStart) return;
    if (loop && safeEnd - safeStart > 0.05) {
        source.loop = true;
        source.loopStart = safeStart;
        source.loopEnd = safeEnd;
    }
    source.start(startAt, safeStart, loop ? undefined : (safeEnd - safeStart));
    source.onended = () => {
        if (state.referenceSource === source) state.referenceSource = null;
    };
    state.referenceSource = source;
}

function animatePlayhead() {
    cancelAnimationFrame(playheadAnim);
    const tick = () => {
        if (!state.isPlaying) return;
        state.playheadTime = state.playFrom + (getAudio().currentTime - state.playStartAudioTime);
        if (state.playheadTime >= state.playTo) {
            if (state.loopPlayback && state.selectedRange) {
                startPlayback(true);
                return;
            }
            stopPlayback();
            return;
        }
        drawRoll();
        drawReference();
        playheadAnim = requestAnimationFrame(tick);
    };
    playheadAnim = requestAnimationFrame(tick);
}

function stopPlayback() {
    if (!state.isPlaying) return;
    state.isPlaying = false;
    clearPlaybackTimers();
    stopReferencePlayback();
    clearMetronome();
    cancelAnimationFrame(playheadAnim);
    state.playheadTime = state.selectedRange ? state.selectedRange.start : 0;
    state.stepCursor = state.playheadTime;
    updateHeader();
    drawRoll();
    drawReference();
    status('pronto');
}

function startPlayback(restartLoop) {
    if (!state.notes.length && !state.referenceBuffer) return;
    if (!restartLoop) stopPlayback();
    stopAllVoices();
    clearPlaybackTimers();
    const range = playbackRange();
    state.isPlaying = true;
    state.playFrom = range.start;
    state.playTo = Math.max(range.end, range.start + 0.1);
    state.playStartAudioTime = getAudio().currentTime;
    state.playheadTime = range.start;
    startReferencePlayback(range, state.playStartAudioTime, !!(state.loopPlayback && state.selectedRange));
    state.notes.forEach(note => {
        const noteStart = note.start;
        const noteEnd = note.start + note.duration;
        if (noteEnd <= range.start || noteStart >= range.end) return;
        const clippedStart = Math.max(noteStart, range.start);
        const clippedEnd = Math.min(noteEnd, range.end);
        schedulePlaybackNote(note, clippedStart - range.start, Math.max(0.04, clippedEnd - clippedStart));
    });
    state.playTimerIds.push(setTimeout(() => {
        if (state.loopPlayback && state.selectedRange) startPlayback(true);
        else stopPlayback();
    }, ((state.playTo - state.playFrom) * 1000) + 80));
    animatePlayhead();
    updateHeader();
    drawReference();
    status('tocando...');
}

function togglePlayback() {
    getAudio();
    if (state.isPlaying) stopPlayback();
    else startPlayback();
}

function cancelCountIn() {
    state.isCountIn = false;
    state.pendingRecord = null;
    clearCountInTimers();
    clearMetronome();
    updateHeader();
    status('count-in cancelado');
}

function finishRecording(message) {
    if (!state.isRecording) return;
    state.isRecording = false;
    Array.from(state.recordHeld.keys()).forEach(endRecordNote);
    state.recordHeld.clear();
    state.recordLimit = null;
    clearPlaybackTimers();
    clearMetronome();
    stopReferencePlayback();
    sortNotes();
    updateHeader();
    drawRoll();
    saveState();
    status(message || 'gravacao parada');
}

function beginRecordingSession(config) {
    const ctx = getAudio();
    pushUndo(config.replaceSelection ? 'punch record' : 'record');
    if (config.replaceSelection) eraseRange(config.range.start, config.range.end);
    else state.notes = [];
    state.recordHeld.clear();
    state.recordOffset = config.range.start;
    state.recordLimit = config.replaceSelection ? config.range.end : null;
    state.recordStart = ctx.currentTime;
    state.isRecording = true;
    state.isCountIn = false;
    state.pendingRecord = null;
    state.playheadTime = config.range.start;
    const beatCount = state.recordLimit !== null
        ? Math.max(1, Math.ceil((state.recordLimit - state.recordOffset) / beatDuration()))
        : 256;
    scheduleMetronome(ctx.currentTime, beatCount, Math.round(config.range.start / beatDuration()));
    startReferencePlayback(config.range, ctx.currentTime, false);
    if (state.recordLimit !== null) {
        state.playTimerIds.push(setTimeout(() => {
            if (state.isRecording) finishRecording('gravacao da regiao concluida');
        }, Math.max(60, (state.recordLimit - state.recordOffset) * 1000)));
    }
    updateHeader();
    drawRoll();
    saveState();
    status(config.replaceSelection ? 'gravando selecao...' : 'gravando...');
}

function armRecording() {
    getAudio();
    stopPlayback();
    stopAllVoices();
    stopReferencePlayback();
    const range = playbackRange();
    const config = { range, replaceSelection: !!state.selectedRange };
    state.pendingRecord = config;
    state.isCountIn = true;
    state.countInEnd = getAudio().currentTime + (state.countInBeats * beatDuration());
    clearCountInTimers();
    scheduleMetronome(getAudio().currentTime, state.countInBeats, Math.round(range.start / beatDuration()));
    for (let i = 0; i < state.countInBeats; i++) {
        const remaining = state.countInBeats - i;
        countInTimerIds.push(setTimeout(() => {
            $('midi-edit-info').textContent = `count-in ${remaining}`;
            status(`prepare: ${remaining}`);
        }, i * beatDuration() * 1000));
    }
    countInTimerIds.push(setTimeout(() => {
        $('midi-edit-info').textContent = 'gravando';
        beginRecordingSession(config);
    }, state.countInBeats * beatDuration() * 1000));
    updateHeader();
    drawRoll();
}

function toggleRecording() {
    if (state.isCountIn) {
        cancelCountIn();
        return;
    }
    if (state.isRecording) {
        finishRecording('gravacao parada');
        return;
    }
    armRecording();
}

function changeOctave(delta) {
    state.octave = Math.max(1, Math.min(7, state.octave + delta));
    $('midi-octave').value = String(state.octave);
    refreshPiano();
    saveState();
}

function scaleDegreeMidi(degree) {
    const intervals = scaleIntervals();
    const octaveOffset = Math.floor(degree / intervals.length);
    const interval = intervals[((degree % intervals.length) + intervals.length) % intervals.length];
    return (12 * (state.octave + 1)) + rootPc() + interval + (octaveOffset * 12);
}

function keyboardMapForCode(code) {
    if (state.keyboardMode === 'scale') return SCALE_LINE_KEY_MAP.find(item => item.code === code) || null;
    return CHROMATIC_KEY_MAP.find(item => item.code === code) || null;
}

function keyboardNote(map) {
    if (state.keyboardMode === 'scale') return scaleDegreeMidi(map.degree);
    return (12 * (state.octave + 1)) + map.semi;
}

function keyboardAssignments() {
    const map = state.keyboardMode === 'scale' ? SCALE_LINE_KEY_MAP : CHROMATIC_KEY_MAP;
    return map.map(item => ({ midi: keyboardNote(item), label: item.label }));
}

function setKeyboardMode(mode) {
    state.keyboardMode = mode === 'scale' ? 'scale' : 'chromatic';
    stopAllVoices();
    state.heldCodes.clear();
    refreshPiano();
    updateKeyboardHelp();
    renderKeyboardMap();
    saveState();
}

function buildPiano() {
    const piano = $('midi-piano');
    const startMidi = 48;
    const octaves = 3;
    const whiteSet = new Set([0, 2, 4, 5, 7, 9, 11]);
    const whites = [];
    piano.innerHTML = '';

    for (let midi = startMidi; midi < startMidi + octaves * 12; midi++) {
        if (whiteSet.has(midi % 12)) whites.push(midi);
    }
    const whiteWidth = 100 / whites.length;
    whites.forEach((midi, index) => {
        const key = document.createElement('div');
        key.className = 'piano-key white';
        key.dataset.midi = String(midi);
        key.style.left = `${index * whiteWidth}%`;
        key.style.width = `${whiteWidth}%`;
        piano.appendChild(key);
    });
    for (let midi = startMidi; midi < startMidi + octaves * 12; midi++) {
        if (whiteSet.has(midi % 12)) continue;
        const previousWhite = whites.findIndex(value => value > midi) - 1;
        const key = document.createElement('div');
        key.className = 'piano-key black';
        key.dataset.midi = String(midi);
        key.style.left = `${(previousWhite + 1) * whiteWidth - (whiteWidth * 0.35)}%`;
        key.style.width = `${whiteWidth * 0.7}%`;
        piano.appendChild(key);
    }
    piano.querySelectorAll('.piano-key').forEach(key => {
        key.addEventListener('pointerdown', event => {
            event.preventDefault();
            const midi = parseInt(key.dataset.midi, 10);
            key.dataset.playMidi = String(midi);
            key.setPointerCapture?.(event.pointerId);
            playMidi(midi, 'mouse');
        });
        const release = () => {
            const midi = parseInt(key.dataset.playMidi || key.dataset.midi, 10);
            releaseMidi(midi);
        };
        key.addEventListener('pointerup', release);
        key.addEventListener('pointercancel', release);
        key.addEventListener('pointerleave', event => {
            if (event.buttons) release();
        });
    });
    refreshPiano();
}

function refreshPiano() {
    const assignmentMap = new Map();
    keyboardAssignments().forEach(item => assignmentMap.set(item.midi, item.label));
    document.querySelectorAll('.piano-key').forEach(key => {
        const midi = parseInt(key.dataset.midi, 10);
        key.classList.toggle('in-scale', isScaleMidi(midi));
        key.classList.toggle('root', (midi % 12) === rootPc());
        const label = assignmentMap.get(midi);
        key.innerHTML = `<span class="piano-note">${midiName(midi)}</span>${label ? `<span class="piano-keyhint">${label}</span>` : ''}`;
    });
    renderKeyboardMap();
    updateHeader();
}

function timeToX(time) {
    return ROLL_LABEL_W + (((time - rollMetrics.viewStart) / rollMetrics.viewDuration) * rollMetrics.gridWidth);
}

function xToTime(x) {
    const gridX = Math.max(0, Math.min(rollMetrics.gridWidth, x - ROLL_LABEL_W));
    return Math.max(0, rollMetrics.viewStart + ((gridX / rollMetrics.gridWidth) * rollMetrics.viewDuration));
}

function yToMidi(y) {
    const rel = 1 - (y / rollMetrics.height);
    const midi = rollMetrics.minMidi + Math.floor(rel * rollMetrics.totalRange);
    return Math.max(rollMetrics.minMidi, Math.min(rollMetrics.maxMidi, midi));
}

function noteAtPoint(x, y) {
    for (let i = rollRects.length - 1; i >= 0; i--) {
        const rect = rollRects[i];
        if (x >= rect.x - 4 && x <= rect.x + rect.w + 4 && y >= rect.y - 3 && y <= rect.y + rect.h + 3) return rect;
    }
    return null;
}

function notesInRect(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    return rollRects
        .filter(rect => rect.x < right && (rect.x + rect.w) > left && rect.y < bottom && (rect.y + rect.h) > top)
        .map(rect => rect.id);
}

function createNoteAt(x, y) {
    pushUndo('create note');
    const note = normalizeNote({
        midi: yToMidi(y),
        start: snapTime(xToTime(x)),
        duration: gridStep(),
        velocity: 100,
    });
    state.notes.push(note);
    sortNotes();
    clampView();
    setSelectedNotes([note.id]);
    saveState();
}

function insertStepNote(midi) {
    pushUndo('step note');
    const note = normalizeNote({
        midi,
        start: state.stepCursor,
        duration: gridStep(),
        velocity: 100,
    });
    state.notes = state.notes.filter(existing => !(existing.start === note.start && existing.midi === note.midi));
    state.notes.push(note);
    sortNotes();
    clampView();
    state.selectedNoteIds = [note.id];
    state.stepCursor = state.selectedRange
        ? Math.min(state.selectedRange.end, state.stepCursor + gridStep())
        : state.stepCursor + gridStep();
    updateSelectionInfo();
    updateHeader();
    drawRoll();
    saveState();
    status(`step ${midiName(midi)}`);
}

function drawGhostReference(ctx, width, height, minMidi, totalRange, viewStart, viewEnd, viewDuration) {
    return;
}

function drawRoll() {
    const canvas = $('midi-roll');
    const width = Math.max(320, canvas.clientWidth || 320);
    const height = Math.max(240, canvas.clientHeight || 240);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    const minMidi = ROLL_MIN_MIDI;
    const maxMidi = ROLL_MAX_MIDI;
    const totalRange = maxMidi - minMidi + 1;
    clampView();
    const viewStart = state.viewStart;
    const viewDuration = state.viewDuration;
    const viewEnd = viewStart + viewDuration;
    const gridWidth = width - ROLL_LABEL_W;
    rollMetrics = { width, height, minMidi, maxMidi, totalRange, viewStart, viewDuration, viewEnd, gridWidth };
    rollRects = [];

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#0b141e';
    ctx.fillRect(0, 0, ROLL_LABEL_W, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(ROLL_LABEL_W + 0.5, 0);
    ctx.lineTo(ROLL_LABEL_W + 0.5, height);
    ctx.stroke();

    if (state.selectedRange) {
        const start = Math.max(viewStart, state.selectedRange.start);
        const end = Math.min(viewEnd, state.selectedRange.end);
        if (end > start) {
            const sx = ROLL_LABEL_W + (((start - viewStart) / viewDuration) * gridWidth);
            const sw = ((end - start) / viewDuration) * gridWidth;
            ctx.fillStyle = 'rgba(240,160,80,0.12)';
            ctx.fillRect(sx, 0, sw, height);
            ctx.strokeStyle = 'rgba(240,160,80,0.45)';
            ctx.strokeRect(sx + 0.5, 0.5, Math.max(1, sw - 1), height - 1);
        }
    }

    const rowHeight = height / totalRange;
    ctx.font = '10px Courier New';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let midi = maxMidi; midi >= minMidi; midi--) {
        const rowIndex = maxMidi - midi;
        const y = Math.round(rowIndex * rowHeight);
        const centerY = y + (rowHeight * 0.5);
        const isC = (midi % 12) === 0;
        const isHover = state.hoverMidi === midi;
        ctx.strokeStyle = isC ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        if (isHover) {
            ctx.fillStyle = 'rgba(142,215,255,0.12)';
            ctx.fillRect(0, y, width, Math.max(1, rowHeight));
        }
        ctx.fillStyle = isHover ? '#bde9ff' : (isC ? '#d8e2ee' : '#7f91a8');
        ctx.fillText(midiName(midi), 8, centerY);
    }

    const beatSec = beatDuration();
    const firstBeat = Math.floor(viewStart / beatSec);
    const lastBeat = Math.ceil(viewEnd / beatSec);
    for (let beat = firstBeat; beat <= lastBeat; beat++) {
        const time = beat * beatSec;
        const x = Math.round(ROLL_LABEL_W + (((time - viewStart) / viewDuration) * gridWidth));
        ctx.strokeStyle = beat % 4 === 0 ? 'rgba(74,144,217,0.35)' : 'rgba(74,144,217,0.14)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    drawGhostReference(ctx, gridWidth, height, minMidi, totalRange, viewStart, viewEnd, viewDuration);

    state.notes.forEach(note => {
        const noteStart = note.start;
        const noteEnd = note.start + note.duration;
        if (noteEnd <= viewStart || noteStart >= viewEnd) return;
        const drawStart = Math.max(viewStart, noteStart);
        const drawEnd = Math.min(viewEnd, noteEnd);
        const x = ROLL_LABEL_W + (((drawStart - viewStart) / viewDuration) * gridWidth);
        const w = Math.max(4, ((drawEnd - drawStart) / viewDuration) * gridWidth);
        const y = height - (((note.midi - minMidi + 1) / totalRange) * height);
        const h = Math.max(8, height / totalRange);
        rollRects.push({ id: note.id, x, y: y - h, w, h: h - 1 });
        const selected = state.selectedNoteIds.includes(note.id);
        ctx.fillStyle = selected ? '#ffd27f' : ((note.midi % 12) === rootPc() ? '#f0a050' : '#4a90d9');
        ctx.fillRect(x, y - h, w, h - 1);
        if (selected) {
            ctx.strokeStyle = '#fff3c4';
            ctx.strokeRect(x + 0.5, y - h + 0.5, Math.max(1, w - 1), Math.max(1, h - 2));
        }
    });

    if (state.isPlaying) {
        if (state.playheadTime >= viewStart && state.playheadTime <= viewEnd) {
            const px = ROLL_LABEL_W + (((state.playheadTime - viewStart) / viewDuration) * gridWidth);
            ctx.strokeStyle = 'rgba(112,216,112,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, height);
            ctx.stroke();
            ctx.lineWidth = 1;
        }
    } else if (state.selectedRange && state.selectedRange.start >= viewStart && state.selectedRange.start <= viewEnd) {
        const px = ROLL_LABEL_W + (((state.selectedRange.start - viewStart) / viewDuration) * gridWidth);
        ctx.strokeStyle = 'rgba(112,216,112,0.5)';
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
    }

    if (state.stepCursor >= viewStart && state.stepCursor <= viewEnd) {
        const cx = ROLL_LABEL_W + (((state.stepCursor - viewStart) / viewDuration) * gridWidth);
        ctx.strokeStyle = 'rgba(142,215,255,0.7)';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, height);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    if (rollPointer?.mode === 'marquee') {
        const left = Math.min(rollPointer.startX, rollPointer.currentX);
        const top = Math.min(rollPointer.startY, rollPointer.currentY);
        const w = Math.abs(rollPointer.currentX - rollPointer.startX);
        const h = Math.abs(rollPointer.currentY - rollPointer.startY);
        ctx.fillStyle = 'rgba(142,215,255,0.10)';
        ctx.fillRect(left, top, w, h);
        ctx.strokeStyle = 'rgba(142,215,255,0.8)';
        ctx.strokeRect(left + 0.5, top + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
    }
}

function initRollInteractions() {
    const canvas = $('midi-roll');
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('wheel', event => {
        if (!rollMetrics) return;
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const anchor = xToTime(event.clientX - rect.left);
        if (event.shiftKey) {
            panView((event.deltaY / 120) * gridStep() * 4);
            return;
        }
        zoomView(event.deltaY < 0 ? 0.9 : 1.1, anchor);
    }, { passive: false });
    canvas.addEventListener('dblclick', event => {
        if (!rollMetrics) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        if (x < ROLL_LABEL_W) return;
        createNoteAt(x, event.clientY - rect.top);
    });
    canvas.addEventListener('pointerdown', event => {
        if (!rollMetrics) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (x < ROLL_LABEL_W) {
            state.hoverMidi = yToMidi(y);
            drawRoll();
            return;
        }
        const hit = noteAtPoint(x, y);
        canvas.setPointerCapture?.(event.pointerId);
        if (event.shiftKey) {
            rollPointer = { mode: 'range', startX: x, currentX: x };
            setSelectedRange(xToTime(x), xToTime(x));
            return;
        }
        if (hit) {
            const note = getNoteById(hit.id);
            state.selectedRange = null;
            if (event.ctrlKey || event.metaKey) {
                const next = state.selectedNoteIds.includes(note.id)
                    ? state.selectedNoteIds.filter(id => id !== note.id)
                    : [...state.selectedNoteIds, note.id];
                setSelectedNotes(next);
                return;
            }
            const movingIds = state.selectedNoteIds.includes(note.id) ? state.selectedNoteIds.slice() : [note.id];
            state.selectedNoteIds = movingIds;
            const leftEdge = x < hit.x + 8;
            const rightEdge = x > hit.x + hit.w - 8;
            rollPointer = {
                mode: leftEdge ? 'resize-left' : (rightEdge ? 'resize-right' : 'move'),
                noteId: note.id,
                noteIds: movingIds,
                startX: x,
                startY: y,
                originStart: note.start,
                originDuration: note.duration,
                originMidi: note.midi,
                origins: movingIds.map(id => {
                    const n = getNoteById(id);
                    return { id, start: n.start, midi: n.midi, duration: n.duration };
                }),
                metrics: { ...rollMetrics },
            };
            if (rollPointer.mode === 'move') pushUndo(movingIds.length > 1 ? 'move notes' : 'move note');
            if (rollPointer.mode === 'resize-left' || rollPointer.mode === 'resize-right') pushUndo('resize note');
            updateSelectionInfo();
            updateHeader();
            drawRoll();
            return;
        }
        state.selectedNoteIds = [];
        if (event.ctrlKey || event.metaKey) {
            rollPointer = { mode: 'marquee', startX: x, startY: y, currentX: x, currentY: y };
            drawRoll();
        } else {
            state.selectedRange = null;
            state.stepCursor = snapTime(xToTime(x));
            updateSelectionInfo();
            updateHeader();
            drawRoll();
        }
    });
    canvas.addEventListener('pointermove', event => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (rollMetrics) {
            const hoverMidi = yToMidi(y);
            if (state.hoverMidi !== hoverMidi) {
                state.hoverMidi = hoverMidi;
                if (!rollPointer) drawRoll();
            }
        }
        if (!rollPointer || !rollMetrics) return;
        if (rollPointer.mode === 'range') {
            rollPointer.currentX = x;
            setSelectedRange(xToTime(rollPointer.startX), xToTime(x));
            return;
        }
        if (rollPointer.mode === 'marquee') {
            rollPointer.currentX = x;
            rollPointer.currentY = y;
            state.selectedNoteIds = notesInRect(rollPointer.startX, rollPointer.startY, x, y);
            updateSelectionInfo();
            updateHeader();
            drawRoll();
            return;
        }
        const note = getNoteById(rollPointer.noteId);
        if (!note) return;
        const currentTime = Math.max(0, rollPointer.metrics.viewStart + ((x / rollPointer.metrics.width) * rollPointer.metrics.viewDuration));
        const startTime = Math.max(0, rollPointer.metrics.viewStart + ((rollPointer.startX / rollPointer.metrics.width) * rollPointer.metrics.viewDuration));
        if (rollPointer.mode === 'move') {
            const dt = currentTime - startTime;
            const dy = yToMidi(y) - yToMidi(rollPointer.startY);
            rollPointer.origins.forEach(origin => {
                const n = getNoteById(origin.id);
                if (!n) return;
                n.start = Math.max(0, snapTime(origin.start + dt));
                n.midi = Math.max(ROLL_MIN_MIDI, Math.min(ROLL_MAX_MIDI, origin.midi + dy));
            });
            $('midi-edit-info').textContent = `${midiName(Math.max(ROLL_MIN_MIDI, Math.min(ROLL_MAX_MIDI, rollPointer.originMidi + dy)))} · ${snapTime(rollPointer.originStart + dt).toFixed(2)}s`;
        } else if (rollPointer.mode === 'resize-right') {
            const dt = currentTime - startTime;
            note.duration = Math.max(gridStep(), snapTime(rollPointer.originDuration + dt));
            $('midi-edit-info').textContent = `${midiName(note.midi)} · len ${note.duration.toFixed(2)}s`;
        } else if (rollPointer.mode === 'resize-left') {
            const originalEnd = rollPointer.originStart + rollPointer.originDuration;
            const newStart = Math.max(0, snapTime(rollPointer.originStart + (currentTime - startTime)));
            note.start = Math.min(originalEnd - gridStep(), newStart);
            note.duration = Math.max(gridStep(), snapTime(originalEnd - note.start));
            $('midi-edit-info').textContent = `${midiName(note.midi)} · ${note.start.toFixed(2)}s`;
        }
        sortNotes();
        drawRoll();
    });
    const finish = () => {
        if (!rollPointer) return;
        if (['move', 'resize-left', 'resize-right', 'marquee'].includes(rollPointer.mode)) saveState();
        rollPointer = null;
        updateHeader();
        $('midi-edit-info').textContent = 'pronto';
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('pointerleave', () => {
        state.hoverMidi = null;
        if (!rollPointer) drawRoll();
    });
}

function midiVarLen(value) {
    let buffer = value & 0x7f;
    const out = [];
    while ((value >>= 7)) {
        buffer <<= 8;
        buffer |= ((value & 0x7f) | 0x80);
    }
    while (true) {
        out.push(buffer & 0xff);
        if (buffer & 0x80) buffer >>= 8;
        else break;
    }
    return out;
}

function encodeTrack(events) {
    const bytes = [];
    let lastTick = 0;
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    events.forEach(event => {
        bytes.push(...midiVarLen(Math.max(0, event.tick - lastTick)), ...event.data);
        lastTick = event.tick;
    });
    bytes.push(0x00, 0xff, 0x2f, 0x00);
    return new Uint8Array(bytes);
}

function buildMidiFile() {
    if (!state.notes.length) throw new Error('Sem notas gravadas.');
    const ppq = 480;
    const mpqn = Math.round(60000000 / state.bpm);
    const events = [{
        tick: 0,
        order: 0,
        data: [0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff],
    }];
    state.notes.forEach(note => {
        const startTick = Math.max(0, Math.round((note.start * state.bpm / 60) * ppq));
        const endTick = Math.max(startTick + 1, Math.round(((note.start + note.duration) * state.bpm / 60) * ppq));
        events.push({ tick: startTick, order: 1, data: [0x90, note.midi, note.velocity || 100] });
        events.push({ tick: endTick, order: 2, data: [0x80, note.midi, 0] });
    });
    const track = encodeTrack(events);
    const header = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        (ppq >> 8) & 0xff, ppq & 0xff,
        0x4d, 0x54, 0x72, 0x6b,
        (track.length >> 24) & 0xff,
        (track.length >> 16) & 0xff,
        (track.length >> 8) & 0xff,
        track.length & 0xff,
    ]);
    return new Blob([header, track], { type: 'audio/midi' });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

function buildMonoData(buffer, maxSeconds) {
    const channels = buffer.numberOfChannels;
    const maxLength = Math.min(buffer.length, Math.floor(buffer.sampleRate * (maxSeconds || buffer.duration)));
    const mono = new Float32Array(maxLength);
    for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < maxLength; i++) mono[i] += data[i];
    }
    if (channels > 1) {
        const inv = 1 / channels;
        for (let i = 0; i < maxLength; i++) mono[i] *= inv;
    }
    return mono;
}

function autoCorrelatePitch(samples, sampleRate) {
    let rms = 0;
    for (let i = 0; i < samples.length; i++) rms += samples[i] * samples[i];
    rms = Math.sqrt(rms / samples.length);
    if (rms < 0.01) return null;
    let bestLag = -1;
    let best = 0;
    const minLag = Math.max(2, Math.floor(sampleRate / 1200));
    const maxLag = Math.min(samples.length - 1, Math.floor(sampleRate / 50));
    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = 0; i < samples.length - lag; i++) corr += samples[i] * samples[i + lag];
        if (corr > best) {
            best = corr;
            bestLag = lag;
        }
    }
    if (bestLag < 0) return null;
    const norm = best / samples.length;
    if (norm < 0.02) return null;
    return sampleRate / bestLag;
}

function detectReferenceBpm(buffer) {
    const sr = buffer.sampleRate;
    const data = buildMonoData(buffer, 45);
    const hopSize = 512;
    const winSize = 1024;
    const nFrames = Math.max(0, Math.floor((data.length - winSize) / hopSize));
    if (nFrames < 10) return null;
    const energy = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
        const off = i * hopSize;
        let e = 0;
        for (let j = 0; j < winSize; j++) e += data[off + j] * data[off + j];
        energy[i] = e / winSize;
    }
    const onset = new Float32Array(nFrames);
    for (let i = 1; i < nFrames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
    const hopSec = hopSize / sr;
    const lagMin = Math.max(2, Math.round(60 / (240 * hopSec)));
    const lagMax = Math.round(60 / (50 * hopSec));
    let bestLag = lagMin;
    let bestCorr = 0;
    const corr = new Float32Array(lagMax + 1);
    for (let lag = lagMin; lag <= lagMax; lag++) {
        let sum = 0;
        for (let i = 0; i < nFrames - lag; i++) sum += onset[i] * onset[i + lag];
        corr[lag] = sum;
        if (sum > bestCorr) {
            bestCorr = sum;
            bestLag = lag;
        }
    }
    let refinedLag = bestLag;
    if (bestLag > lagMin && bestLag < lagMax) {
        const y1 = corr[bestLag - 1];
        const y2 = corr[bestLag];
        const y3 = corr[bestLag + 1];
        const d = y1 - (2 * y2) + y3;
        if (Math.abs(d) > 1e-12) refinedLag = bestLag + (0.5 * (y1 - y3) / d);
    }
    let bpm = 60 / (refinedLag * hopSec);
    while (bpm < 80) bpm *= 2;
    while (bpm > 220) bpm /= 2;
    return bpm;
}

function computeReferencePeaks(buffer, bins) {
    const mono = buildMonoData(buffer, buffer.duration);
    const size = Math.max(128, bins || 1200);
    const block = Math.max(1, Math.floor(mono.length / size));
    const peaks = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        let max = 0;
        const start = i * block;
        const end = Math.min(mono.length, start + block);
        for (let j = start; j < end; j++) {
            const v = Math.abs(mono[j]);
            if (v > max) max = v;
        }
        peaks[i] = max;
    }
    return peaks;
}

function referenceTimeToX(time) {
    const viewStart = referenceMetrics.viewStart;
    const viewEnd = referenceMetrics.viewEnd ?? referenceMetrics.duration;
    const viewDur = Math.max(0.001, viewEnd - viewStart);
    return ((time - viewStart) / viewDur) * referenceMetrics.width;
}

function referenceXToTime(x) {
    const viewStart = referenceMetrics.viewStart;
    const viewEnd = referenceMetrics.viewEnd ?? referenceMetrics.duration;
    return Math.max(0, Math.min(referenceMetrics.duration, viewStart + ((x / referenceMetrics.width) * (viewEnd - viewStart))));
}

function drawReference() {
    const canvas = $('midi-reference');
    if (!canvas) return;
    const width = Math.max(320, canvas.clientWidth || 320);
    const height = Math.max(80, canvas.clientHeight || 80);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#09111a';
    ctx.fillRect(0, 0, width, height);

    const clip = getActiveReferenceClip();
    if (!clip || !clip.audioBuffer || !clip.peaks) {
        ctx.fillStyle = '#6f8097';
        ctx.font = '12px Courier New';
        ctx.fillText('importe uma referencia para recortar trechos aqui', 12, 22);
        referenceMetrics = null;
        return;
    }

    referenceMetrics = {
        width,
        height,
        duration: clip.duration,
        viewStart: clip.viewStart || 0,
        viewEnd: clip.viewEnd,
    };
    const viewStart = referenceMetrics.viewStart;
    const viewEnd = referenceMetrics.viewEnd ?? referenceMetrics.duration;
    const viewDur = Math.max(0.001, viewEnd - viewStart);
    const mid = height / 2;
    const peaks = clip.peaks;

    for (let x = 0; x < width; x++) {
        const t0 = viewStart + (x / width) * viewDur;
        const t1 = viewStart + ((x + 1) / width) * viewDur;
        const p0 = Math.max(0, Math.floor((t0 / clip.duration) * peaks.length));
        const p1 = Math.min(peaks.length - 1, Math.ceil((t1 / clip.duration) * peaks.length));
        let amp = 0;
        for (let p = p0; p <= p1; p++) amp = Math.max(amp, peaks[p]);
        ctx.fillStyle = '#d39b53';
        ctx.fillRect(x, mid - (amp * height * 0.42), 1, Math.max(1, amp * height * 0.84));
    }

    const bpm = state.referenceBpm || state.bpm;
    if (bpm) {
        const beat = 60 / bpm;
        for (let t = 0; t <= clip.duration; t += beat) {
            if (t < viewStart || t > viewEnd) continue;
            const x = referenceTimeToX(t);
            ctx.strokeStyle = Math.round(t / beat) % 4 === 0 ? 'rgba(74,144,217,0.35)' : 'rgba(74,144,217,0.12)';
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, height);
            ctx.stroke();
        }
    }

    if (state.referenceSelection) {
        const x1 = referenceTimeToX(state.referenceSelection.start);
        const x2 = referenceTimeToX(state.referenceSelection.end);
        ctx.fillStyle = 'rgba(240,160,80,0.14)';
        ctx.fillRect(x1, 0, Math.max(1, x2 - x1), height);
        ctx.strokeStyle = 'rgba(240,160,80,0.55)';
        ctx.strokeRect(x1 + 0.5, 0.5, Math.max(1, x2 - x1 - 1), height - 1);
        const handleW = 6;
        ctx.fillStyle = '#f0a050';
        ctx.fillRect(x1 - 1, 0, 2, height);
        ctx.fillRect(x2 - 1, 0, 2, height);
        ctx.beginPath();
        ctx.moveTo(x1, 0); ctx.lineTo(x1 + handleW, 0); ctx.lineTo(x1, handleW); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x1, height); ctx.lineTo(x1 + handleW, height); ctx.lineTo(x1, height - handleW); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x2, 0); ctx.lineTo(x2 - handleW, 0); ctx.lineTo(x2, handleW); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x2, height); ctx.lineTo(x2 - handleW, height); ctx.lineTo(x2, height - handleW); ctx.closePath(); ctx.fill();
    }

    if (state.referenceSource && state.isPlaying && state.playTo > state.playFrom) {
        const rel = state.playheadTime;
        if (rel >= viewStart && rel <= viewEnd) {
            const x = referenceTimeToX(rel);
            ctx.strokeStyle = 'rgba(112,216,112,0.85)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
    }

    if (referencePointer) {
        const x1 = Math.min(referencePointer.startX, referencePointer.currentX);
        const x2 = Math.max(referencePointer.startX, referencePointer.currentX);
        ctx.fillStyle = 'rgba(142,215,255,0.10)';
        ctx.fillRect(x1, 0, Math.max(1, x2 - x1), height);
        ctx.strokeStyle = 'rgba(142,215,255,0.8)';
        ctx.strokeRect(x1 + 0.5, 0.5, Math.max(1, x2 - x1 - 1), height - 1);
    }

    ctx.fillStyle = '#9bb6d1';
    ctx.font = '11px Courier New';
    ctx.fillText(`slice ${referenceSelectionLabel()} · note ${state.referenceSliceNote || '--'} · wheel = zoom · right drag = pan`, 10, 14);
}

function drawReferenceOverview() {
    const canvas = $('midi-ref-overview');
    if (!canvas) return;
    const width = Math.max(320, canvas.clientWidth || 320);
    const height = Math.max(24, canvas.clientHeight || 24);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#060b11';
    ctx.fillRect(0, 0, width, height);
    const clip = getActiveReferenceClip();
    if (!clip || !clip.peaks) {
        overviewMetrics = null;
        return;
    }
    overviewMetrics = { width, height, duration: clip.duration };
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
        const p0 = Math.floor((x / width) * clip.peaks.length);
        const p1 = Math.min(clip.peaks.length - 1, Math.ceil(((x + 1) / width) * clip.peaks.length));
        let amp = 0;
        for (let p = p0; p <= p1; p++) amp = Math.max(amp, clip.peaks[p]);
        ctx.fillStyle = '#556b57';
        ctx.fillRect(x, mid - (amp * height * 0.42), 1, Math.max(1, amp * height * 0.84));
    }
    if (state.referenceSelection) {
        const sx = Math.round((state.referenceSelection.start / clip.duration) * width);
        const ex = Math.round((state.referenceSelection.end / clip.duration) * width);
        ctx.fillStyle = 'rgba(240,160,80,0.18)';
        ctx.fillRect(sx, 0, Math.max(1, ex - sx), height);
        ctx.strokeStyle = 'rgba(240,160,80,0.55)';
        ctx.strokeRect(sx + 0.5, 0.5, Math.max(1, ex - sx - 1), height - 1);
    }
    if (clip.viewEnd !== null) {
        const vx = Math.round((clip.viewStart / clip.duration) * width);
        const vex = Math.round((clip.viewEnd / clip.duration) * width);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(vx, 0, Math.max(1, vex - vx), height);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(vx + 0.5, 0.5, Math.max(1, vex - vx - 1), height - 1);
    }
}

function playReferenceOnly(range) {
    const clip = getActiveReferenceClip();
    if (!clip || !clip.audioBuffer) return;
    stopPlayback();
    stopAllVoices();
    const ctx = getAudio();
    const start = range?.start ?? 0;
    const end = range?.end ?? clip.duration;
    state.isPlaying = true;
    state.playFrom = start;
    state.playTo = end;
    state.playStartAudioTime = ctx.currentTime;
    state.playheadTime = start;
    startReferencePlayback({ start, end }, ctx.currentTime, false);
    animatePlayhead();
    clearPlaybackTimers();
    state.playTimerIds.push(setTimeout(() => stopPlayback(), Math.max(60, (end - start) * 1000 + 80)));
    updateHeader();
    drawRoll();
    drawReference();
    status('tocando referencia...');
}

function detectSelectedSliceNote() {
    const clip = getActiveReferenceClip();
    if (!clip || !clip.audioBuffer || !state.referenceSelection) {
        status('selecione um trecho da referencia');
        return;
    }
    const sr = clip.audioBuffer.sampleRate;
    const mono = buildMonoData(clip.audioBuffer, clip.audioBuffer.duration);
    const startSample = Math.max(0, Math.floor(state.referenceSelection.start * sr));
    const endSample = Math.min(mono.length, Math.ceil(state.referenceSelection.end * sr));
    const slice = mono.subarray(startSample, endSample);
    if (slice.length < 512) {
        status('trecho muito curto');
        return;
    }
    const freq = autoCorrelatePitch(slice, sr);
    if (!freq) {
        state.referenceSliceNote = '';
        updateHeader();
        drawReference();
        status('nao consegui detectar a nota');
        return;
    }
    const midi = Math.round(frequencyToMidi(freq));
    state.referenceSliceNote = midiName(midi);
    updateHeader();
    drawReference();
    saveState();
    status(`slice ${state.referenceSliceNote}`);
}

function applyReferenceSliceToLoop() {
    if (!state.referenceSelection) {
        status('selecione um slice primeiro');
        return;
    }
    state.selectedRange = {
        start: snapTime(state.referenceSelection.start),
        end: Math.max(snapTime(state.referenceSelection.start) + gridStep(), snapTime(state.referenceSelection.end)),
    };
    state.selectedNoteIds = [];
    state.stepCursor = state.selectedRange.start;
    updateSelectionInfo();
    updateHeader();
    drawRoll();
    saveState();
    status('slice copiado para loop/punch');
}

function initReferenceInteractions() {
    const canvas = $('midi-reference');
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
        const clip = getActiveReferenceClip();
        if (!referenceMetrics || !clip) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        if (event.button === 2) {
            const currentEnd = clip.viewEnd ?? clip.duration;
            referencePointer = {
                mode: 'pan',
                startX: x,
                currentX: x,
                viewStart: clip.viewStart,
                viewEnd: currentEnd,
            };
            canvas.setPointerCapture?.(event.pointerId);
            return;
        }
        const sx = state.referenceSelection ? referenceTimeToX(state.referenceSelection.start) : 0;
        const ex = state.referenceSelection ? referenceTimeToX(state.referenceSelection.end) : 0;
        canvas.setPointerCapture?.(event.pointerId);
        if (state.referenceSelection && Math.abs(x - sx) <= 8) {
            referencePointer = { mode: 'left', startX: x, currentX: x };
        } else if (state.referenceSelection && Math.abs(x - ex) <= 8) {
            referencePointer = { mode: 'right', startX: x, currentX: x };
        } else if (state.referenceSelection && x > sx && x < ex) {
            referencePointer = {
                mode: 'move',
                startX: x,
                currentX: x,
                selStart: state.referenceSelection.start,
                selEnd: state.referenceSelection.end,
            };
        } else {
            referencePointer = { mode: 'new', startX: x, currentX: x };
        }
    });
    canvas.addEventListener('pointermove', event => {
        if (!referencePointer || !referenceMetrics) return;
        const rect = canvas.getBoundingClientRect();
        referencePointer.currentX = event.clientX - rect.left;
        const clip = getActiveReferenceClip();
        if (!clip) return;
        if (referencePointer.mode === 'pan') {
            const startTime = referenceXToTime(referencePointer.startX);
            const currentTime = referenceXToTime(referencePointer.currentX);
            const dt = currentTime - startTime;
            const span = referencePointer.viewEnd - referencePointer.viewStart;
            let nextStart = Math.max(0, Math.min(clip.duration - span, referencePointer.viewStart - dt));
            clip.viewStart = nextStart;
            clip.viewEnd = nextStart + span;
        } else if (referencePointer.mode === 'move') {
            const dt = referenceXToTime(referencePointer.currentX) - referenceXToTime(referencePointer.startX);
            const span = referencePointer.selEnd - referencePointer.selStart;
            let start = Math.max(0, Math.min(clip.duration - span, referencePointer.selStart + dt));
            state.referenceSelection = { start, end: start + span };
        } else if (referencePointer.mode === 'left' && state.referenceSelection) {
            state.referenceSelection = {
                start: Math.max(0, Math.min(referenceXToTime(referencePointer.currentX), state.referenceSelection.end - 0.01)),
                end: state.referenceSelection.end,
            };
        } else if (referencePointer.mode === 'right' && state.referenceSelection) {
            state.referenceSelection = {
                start: state.referenceSelection.start,
                end: Math.min(clip.duration, Math.max(referenceXToTime(referencePointer.currentX), state.referenceSelection.start + 0.01)),
            };
        }
        drawReference();
        drawReferenceOverview();
    });
    const finish = () => {
        if (!referencePointer || !referenceMetrics) return;
        if (referencePointer.mode === 'new') {
            const a = referenceXToTime(Math.min(referencePointer.startX, referencePointer.currentX));
            const b = referenceXToTime(Math.max(referencePointer.startX, referencePointer.currentX));
            state.referenceSelection = (b - a) < 0.02 ? null : { start: a, end: b };
        }
        saveActiveReferenceClipState();
        referencePointer = null;
        state.referenceSliceNote = '';
        updateHeader();
        drawReference();
        drawReferenceOverview();
        saveState();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('wheel', event => {
        const clip = getActiveReferenceClip();
        if (!referenceMetrics || !clip) return;
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const anchor = referenceXToTime(event.clientX - rect.left);
        const currentEnd = clip.viewEnd ?? clip.duration;
        const currentDur = Math.max(0.05, currentEnd - clip.viewStart);
        const nextDur = Math.max(0.05, Math.min(clip.duration, currentDur * (event.deltaY < 0 ? 0.85 : 1.15)));
        if (nextDur >= clip.duration * 0.999) {
            clip.viewStart = 0;
            clip.viewEnd = null;
        } else {
            const ratio = (anchor - clip.viewStart) / currentDur;
            clip.viewStart = Math.max(0, Math.min(clip.duration - nextDur, anchor - (ratio * nextDur)));
            clip.viewEnd = clip.viewStart + nextDur;
        }
        drawReference();
        drawReferenceOverview();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
        const clip = getActiveReferenceClip();
        if (!clip) return;
        if (state.referenceSelection) {
            clip.viewStart = state.referenceSelection.start;
            clip.viewEnd = state.referenceSelection.end;
        } else {
            clip.viewStart = 0;
            clip.viewEnd = null;
        }
        drawReference();
        drawReferenceOverview();
    });

    const overview = $('midi-ref-overview');
    overview.addEventListener('pointerdown', event => {
        const clip = getActiveReferenceClip();
        if (!overviewMetrics || !clip) return;
        const rect = overview.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const center = (x / rect.width) * clip.duration;
        const span = clip.viewEnd === null ? clip.duration : (clip.viewEnd - clip.viewStart);
        if (span >= clip.duration * 0.999) return;
        clip.viewStart = Math.max(0, Math.min(clip.duration - span, center - (span / 2)));
        clip.viewEnd = clip.viewStart + span;
        drawReference();
        drawReferenceOverview();
    });
    overview.addEventListener('dblclick', () => {
        const clip = getActiveReferenceClip();
        if (!clip) return;
        clip.viewStart = 0;
        clip.viewEnd = null;
        drawReference();
        drawReferenceOverview();
    });
}

function detectReferenceKey(buffer) {
    const mono = buildMonoData(buffer, 40);
    const sr = buffer.sampleRate;
    const frameSize = 4096;
    const hop = 2048;
    const chroma = new Float32Array(12);
    for (let off = 0; off + frameSize <= mono.length; off += hop) {
        const slice = mono.subarray(off, off + frameSize);
        const freq = autoCorrelatePitch(slice, sr);
        if (!freq || freq < 50 || freq > 1400) continue;
        let energy = 0;
        for (let i = 0; i < slice.length; i++) energy += Math.abs(slice[i]);
        const midi = Math.round(frequencyToMidi(freq));
        chroma[((midi % 12) + 12) % 12] += energy;
    }
    let bestScore = -Infinity;
    let bestRoot = 0;
    let bestMode = 'major';
    for (let root = 0; root < 12; root++) {
        Object.entries(KEY_TEMPLATES).forEach(([mode, template]) => {
            let score = 0;
            for (let i = 0; i < 12; i++) score += chroma[(root + i) % 12] * template[i];
            if (score > bestScore) {
                bestScore = score;
                bestRoot = root;
                bestMode = mode;
            }
        });
    }
    return { root: NOTE_NAMES[bestRoot], scale: bestMode, label: `${NOTE_NAMES[bestRoot]} ${bestMode.toUpperCase()}` };
}

function detectReferenceNotes(buffer, bpm) {
    const mono = buildMonoData(buffer, Math.min(90, buffer.duration));
    const sr = buffer.sampleRate;
    const step = bpm ? (60 / bpm) / 4 : 0.125;
    const frameSize = Math.min(8192, Math.max(2048, Math.pow(2, Math.ceil(Math.log2(step * sr * 1.5)))));
    const events = [];
    let active = null;
    const maxTime = mono.length / sr;

    for (let start = 0; start < maxTime; start += step) {
        const center = start + (step * 0.5);
        const centerSample = Math.floor(center * sr);
        const from = Math.max(0, centerSample - Math.floor(frameSize / 2));
        const to = Math.min(mono.length, from + frameSize);
        if (to - from < 512) continue;
        const freq = autoCorrelatePitch(mono.subarray(from, to), sr);
        let midi = null;
        if (freq && freq >= 50 && freq <= 1800) {
            midi = Math.round(frequencyToMidi(freq));
            if (midi < ROLL_MIN_MIDI - 12 || midi > ROLL_MAX_MIDI + 12) midi = null;
        }
        if (midi === null) {
            if (active) {
                active.duration = Math.max(step, snapTime((start - active.start)) || step);
                events.push(normalizeNote(active));
                active = null;
            }
            continue;
        }
        const snappedStart = Math.max(0, Math.round(start / step) * step);
        if (active && Math.abs(active.midi - midi) <= 1 && Math.abs((active.start + active.duration) - snappedStart) < (step * 0.6)) {
            active.duration += step;
            active.midi = midi;
        } else {
            if (active) events.push(normalizeNote(active));
            active = { midi, start: snappedStart, duration: step, velocity: 40 };
        }
    }
    if (active) events.push(normalizeNote(active));
    return events.filter(note => note.duration >= step * 0.75);
}

async function pingServer() {
    try {
        const response = await fetch(`${SERVER}/ping`, { signal: AbortSignal.timeout(2000) });
        state.serverOnline = response.ok;
    } catch (_) {
        state.serverOnline = false;
    }
    updateHeader();
}

async function importReferenceFromYoutube() {
    const url = $('midi-ref-url').value.trim();
    if (!url) return;
    if (!state.serverOnline) {
        status('servidor offline - abra iniciar_sampler.bat');
        return;
    }
    const btn = $('btn-ref-import');
    btn.disabled = true;
    btn.textContent = '...';
    status('baixando audio do YouTube...');
    try {
        const res = await fetch(`${SERVER}/download?url=${encodeURIComponent(url)}`);
        if (!res.ok) {
            const data = await res.json().catch(() => ({ error: 'erro ao baixar' }));
            throw new Error(data.error || 'erro ao baixar');
        }
        const arrayBuffer = await res.arrayBuffer();
        const ctx = getAudio();
        const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const detectedBpm = detectReferenceBpm(buffer);
        state.referenceUrl = url;
        const name = url.replace(/^https?:\/\//, '').slice(0, 42);
        state.referenceName = name;
        state.referenceDuration = buffer.duration;
        state.referenceBpm = detectedBpm ? Math.round(detectedBpm * 10) / 10 : null;
        state.referenceKey = '';
        state.referenceClips = [createReferenceClip('Original', buffer)];
        state.activeReferenceClip = 0;
        state.referenceBuffer = buffer;
        state.referencePeaks = state.referenceClips[0].peaks;
        state.referenceSelection = { start: 0, end: buffer.duration };
        state.referenceSliceNote = '';
        if (state.referenceBpm) {
            state.bpm = Math.max(40, Math.min(300, Math.round(state.referenceBpm)));
            $('midi-bpm').value = String(state.bpm);
        }
        refreshPiano();
        updateKeyboardHelp();
        fitViewToContent();
        renderReferenceTabs();
        loadReferenceClip(0);
        drawReference();
        drawReferenceOverview();
        drawRoll();
        updateHeader();
        saveState();
        status('referencia importada');
    } catch (error) {
        status(`erro: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'IMPORT REF';
    }
}

function clearReference() {
    stopReferencePlayback();
    state.referenceBuffer = null;
    state.referenceUrl = '';
    state.referenceName = '';
    state.referenceDuration = 0;
    state.referenceBpm = null;
    state.referenceKey = '';
    state.referencePeaks = null;
    state.referenceSelection = null;
    state.referenceSliceNote = '';
    state.referenceClips = [];
    state.activeReferenceClip = -1;
    updateHeader();
    drawRoll();
    drawReference();
    drawReferenceOverview();
    renderReferenceTabs();
    saveState();
    status('referencia limpa');
}

function onKeyDown(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'a') {
        const clip = getActiveReferenceClip();
        if (clip) {
            event.preventDefault();
            state.referenceSelection = { start: 0, end: clip.duration };
            clip.viewStart = 0;
            clip.viewEnd = null;
            state.referenceSliceNote = '';
            saveActiveReferenceClipState();
            updateHeader();
            drawReference();
            drawReferenceOverview();
            saveState();
            return;
        }
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        undoEdit();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'c') {
        event.preventDefault();
        copySelectedNotes();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'v') {
        event.preventDefault();
        pasteClipboardNotes();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault();
        duplicateSelectionBlock();
        return;
    }
    if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
        return;
    }
    if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault();
        deleteSelectedNote();
        return;
    }
    if (event.code === 'KeyZ') {
        event.preventDefault();
        changeOctave(-1);
        return;
    }
    if (event.code === 'KeyX') {
        event.preventDefault();
        changeOctave(1);
        return;
    }
    if (event.code === 'Comma') {
        event.preventDefault();
        advanceStepCursor(-1);
        return;
    }
    if (event.code === 'Period') {
        event.preventDefault();
        advanceStepCursor(1);
        return;
    }
    const map = keyboardMapForCode(event.code);
    if (!map) return;
    if (event.repeat || state.heldCodes.has(event.code)) return;
    event.preventDefault();
    const midi = keyboardNote(map);
    if (state.stepInput) {
        previewShortMidi(midi);
        insertStepNote(midi);
        return;
    }
    state.heldCodes.set(event.code, midi);
    playMidi(midi, 'kbd');
}

function onKeyUp(event) {
    const midi = state.heldCodes.get(event.code);
    if (midi === undefined) return;
    event.preventDefault();
    state.heldCodes.delete(event.code);
    releaseMidi(midi);
}

function initControls() {
    NOTE_NAMES.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        $('midi-root').appendChild(option);
    });
    Object.entries(SCALE_DEFS).forEach(([key, value]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = value.name;
        $('midi-scale').appendChild(option);
    });

    $('midi-root').value = state.root;
    $('midi-scale').value = state.scale;
    $('midi-octave').value = String(state.octave);
    $('midi-bpm').value = String(state.bpm);
    $('midi-count-in').value = String(state.countInBeats);
    $('midi-ref-url').value = state.referenceUrl;
    updateKeyboardHelp();

    $('midi-root').addEventListener('change', event => {
        state.root = event.target.value;
        refreshPiano();
        drawRoll();
        updateKeyboardHelp();
        saveState();
    });
    $('midi-scale').addEventListener('change', event => {
        state.scale = event.target.value;
        refreshPiano();
        drawRoll();
        updateKeyboardHelp();
        saveState();
    });
    $('midi-octave').addEventListener('change', event => {
        state.octave = Math.max(1, Math.min(7, parseInt(event.target.value, 10) || 4));
        event.target.value = String(state.octave);
        refreshPiano();
        saveState();
    });
    $('midi-bpm').addEventListener('change', event => {
        state.bpm = Math.max(40, Math.min(300, parseInt(event.target.value, 10) || 174));
        event.target.value = String(state.bpm);
        updateHeader();
        drawRoll();
        saveState();
    });
    $('midi-count-in').addEventListener('change', event => {
        state.countInBeats = [1, 2, 4, 8].includes(Number(event.target.value)) ? Number(event.target.value) : 4;
        updateHeader();
        saveState();
    });
    $('btn-mode-chromatic').addEventListener('click', () => setKeyboardMode('chromatic'));
    $('btn-mode-scale').addEventListener('click', () => setKeyboardMode('scale'));
    $('btn-snap-8').addEventListener('click', () => { state.snap = 8; updateHeader(); drawRoll(); saveState(); });
    $('btn-snap-16').addEventListener('click', () => { state.snap = 16; updateHeader(); drawRoll(); saveState(); });
    $('btn-snap-32').addEventListener('click', () => { state.snap = 32; updateHeader(); drawRoll(); saveState(); });
    $('btn-view-minus').addEventListener('click', () => zoomView(1.25));
    $('btn-view-plus').addEventListener('click', () => zoomView(0.8));
    $('btn-view-fit').addEventListener('click', () => {
        fitViewToContent();
        updateHeader();
        drawRoll();
        saveState();
    });
    $('btn-midi-loop').addEventListener('click', () => {
        state.loopPlayback = !state.loopPlayback;
        updateHeader();
        saveState();
    });
    $('btn-step-input').addEventListener('click', () => {
        state.stepInput = !state.stepInput;
        updateHeader();
        saveState();
    });
    $('btn-metronome').addEventListener('click', () => {
        state.metronomeOn = !state.metronomeOn;
        updateHeader();
        saveState();
    });
    $('btn-ref-monitor').addEventListener('click', () => {
        state.referenceEnabled = !state.referenceEnabled;
        if (!state.referenceEnabled) stopReferencePlayback();
        updateHeader();
        saveState();
    });
    $('btn-quantize').addEventListener('click', quantizeTarget);
    $('btn-transpose-down').addEventListener('click', () => transposeTarget(-12));
    $('btn-transpose-up').addEventListener('click', () => transposeTarget(12));
    $('btn-dup-down').addEventListener('click', () => duplicateTarget(-12));
    $('btn-dup-up').addEventListener('click', () => duplicateTarget(12));
    $('btn-copy').addEventListener('click', copySelectedNotes);
    $('btn-paste').addEventListener('click', pasteClipboardNotes);
    $('btn-duplicate-block').addEventListener('click', duplicateSelectionBlock);
    $('btn-delete-selected').addEventListener('click', deleteSelectedNote);
    $('btn-midi-play').addEventListener('click', togglePlayback);
    $('btn-midi-record').addEventListener('click', toggleRecording);
    $('btn-ref-import').addEventListener('click', importReferenceFromYoutube);
    $('btn-ref-clear').addEventListener('click', clearReference);
    $('btn-ref-play').addEventListener('click', () => {
        const clip = getActiveReferenceClip();
        playReferenceOnly({ start: 0, end: clip ? clip.duration : 0 });
    });
    $('btn-ref-slice').addEventListener('click', () => {
        if (!state.referenceSelection) {
            status('selecione um slice primeiro');
            return;
        }
        playReferenceOnly(state.referenceSelection);
    });
    $('btn-ref-detect-note').addEventListener('click', detectSelectedSliceNote);
    $('btn-ref-use-slice').addEventListener('click', applyReferenceSliceToLoop);
    $('btn-midi-clear').addEventListener('click', () => {
        stopPlayback();
        cancelCountIn();
        pushUndo('clear');
        state.notes = [];
        state.isRecording = false;
        state.recordHeld.clear();
        state.selectedNoteIds = [];
        state.selectedRange = null;
        state.stepCursor = 0;
        stopAllVoices();
        updateHeader();
        updateSelectionInfo();
        drawRoll();
        drawReference();
        status('take limpo');
        saveState();
    });
    $('btn-midi-export').addEventListener('click', () => {
        try {
            downloadBlob(buildMidiFile(), 'midi-room-take.mid');
            status('midi exportado');
        } catch (error) {
            alert(`Erro: ${error.message}`);
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    loadState();
    clampView();
    initControls();
    buildPiano();
    updateLiveNote(null);
    updateHeader();
    updateSelectionInfo();
    renderReferenceTabs();
    drawRoll();
    drawReference();
    drawReferenceOverview();
    initRollInteractions();
    initReferenceInteractions();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', () => {
        drawRoll();
        drawReference();
        drawReferenceOverview();
    });
    pingServer();
    serverTimerId = window.setInterval(pingServer, 5000);
    window.addEventListener('blur', () => {
        stopPlayback();
        stopAllVoices();
        state.heldCodes.clear();
        if (state.isCountIn) cancelCountIn();
        if (state.isRecording) finishRecording('gravacao parada');
    });
    window.addEventListener('beforeunload', () => {
        clearInterval(serverTimerId);
        clearMetronome();
        stopReferencePlayback();
    });
});
