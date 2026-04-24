import { state, NOTE_NAMES, BASE_OCTAVE, noteToSliceIndex } from './state.js';
import { previewSlice } from './audio.js';

// QWERTY -> note index (0=C ... 11=B) mapping
// Lower row (Z row): octave BASE_OCTAVE, upper row (Q row): BASE_OCTAVE+1
const QWERTY_LOWER = {
    'z':0,'s':1,'x':2,'d':3,'c':4,'v':5,'g':6,'b':7,'h':8,'n':9,'j':10,'m':11,
};
const QWERTY_UPPER = {
    'q':0,'2':1,'w':2,'3':3,'e':4,'r':5,'5':6,'t':7,'6':8,'y':9,'7':10,'u':11,
};

let sel = { step: 0, track: 0, col: 0 }; // col: 0=note, 1=vol, 2=fx
let onCellChange = null;

export function init(onChange) {
    onCellChange = onChange;
    document.addEventListener('keydown', onKeyDown);
}

export function buildTable() {
    const head = document.getElementById('tracker-head');
    const body = document.getElementById('tracker-body');
    head.innerHTML = '';
    body.innerHTML = '';

    // Header row 1: track names
    const hr1 = document.createElement('tr');
    hr1.appendChild(thEl('', 'step-col', 2)); // step number + separator
    for (let t = 0; t < state.numTracks; t++) {
        const th = thEl(`TRACK ${t + 1}`, '', 3);
        th.style.textAlign = 'center';
        hr1.appendChild(th);
        if (t < state.numTracks - 1) hr1.appendChild(thEl('', 'track-sep'));
    }
    head.appendChild(hr1);

    // Header row 2: sub-column names
    const hr2 = document.createElement('tr');
    hr2.appendChild(thEl('', '', 1));
    hr2.appendChild(thEl('', 'track-sep', 1));
    for (let t = 0; t < state.numTracks; t++) {
        hr2.appendChild(thEl('NOTE', 'th-note'));
        hr2.appendChild(thEl('VOL', 'th-vol'));
        hr2.appendChild(thEl('FX', 'th-fx'));
        if (t < state.numTracks - 1) hr2.appendChild(thEl('', 'track-sep'));
    }
    head.appendChild(hr2);

    // Body rows
    for (let s = 0; s < state.numSteps; s++) {
        const tr = document.createElement('tr');
        tr.dataset.step = s;

        if (s % state.lpb === 0) tr.classList.add('row-beat');

        // Step number
        const stepTd = document.createElement('td');
        stepTd.className = 'step-num';
        stepTd.textContent = s.toString(16).padStart(2, '0').toUpperCase();
        tr.appendChild(stepTd);

        const sep0 = document.createElement('td');
        sep0.className = 'track-sep';
        tr.appendChild(sep0);

        for (let t = 0; t < state.numTracks; t++) {
            tr.appendChild(makeCell(s, t, 0));
            tr.appendChild(makeCell(s, t, 1));
            tr.appendChild(makeCell(s, t, 2));
            if (t < state.numTracks - 1) {
                const sep = document.createElement('td');
                sep.className = 'track-sep';
                tr.appendChild(sep);
            }
        }
        body.appendChild(tr);
    }
    refreshSelection();
}

function makeCell(step, track, col) {
    const td = document.createElement('td');
    td.dataset.step  = step;
    td.dataset.track = track;
    td.dataset.col   = col;
    td.classList.add(col === 0 ? 'cell-note' : col === 1 ? 'cell-vol' : 'cell-fx');
    td.addEventListener('mousedown', () => {
        sel = { step, track, col };
        refreshSelection();
        // preview note cells
        if (col === 0) {
            const cell = state.pattern[step][track];
            if (cell.note) {
                const si = noteToSliceIndex(cell.note);
                if (si >= 0) previewSlice(si);
            }
        }
    });
    updateCellText(td, step, track, col);
    return td;
}

export function updateCellText(tdOrCoords, step, track, col) {
    let td;
    if (tdOrCoords instanceof HTMLElement) {
        td = tdOrCoords;
    } else {
        td = getCellTd(step, track, col);
    }
    if (!td) return;

    const cell = state.pattern[step]?.[track];
    if (!cell) return;

    let text = '';
    let empty = false;

    if (col === 0) {
        text  = cell.note ?? '---';
        empty = !cell.note;
    } else if (col === 1) {
        if (!cell.note) {
            text = '--';
            empty = true;
        } else {
            text = (cell.vol ?? 0xff).toString(16).toUpperCase().padStart(2, '0');
        }
    } else {
        text  = fxString(cell.fx);
        empty = !cell.fx;
    }

    td.textContent = text;
    td.classList.toggle('cell-empty', empty);
}

function fxString(fx) {
    if (!fx) return '---';
    if (fx.type === 'B') return 'B--';
    if (fx.type === 'R') return `R${fx.value.toString().padStart(2, '0')}`;
    if (fx.type === 'P') {
        const v = fx.value;
        if (v < 0) return `P-${Math.abs(v).toString().padStart(1, '0')}`;
        return `P${v.toString().padStart(2, '0')}`;
    }
    return '---';
}

function getCellTd(step, track, col) {
    return document.querySelector(
        `#tracker-body td[data-step="${step}"][data-track="${track}"][data-col="${col}"]`
    );
}

function thEl(text, cls = '', colspan = 1) {
    const th = document.createElement('th');
    th.textContent = text;
    if (cls) th.className = cls;
    if (colspan > 1) th.colSpan = colspan;
    return th;
}

function refreshSelection() {
    document.querySelectorAll('.cell-selected').forEach(e => e.classList.remove('cell-selected'));
    const td = getCellTd(sel.step, sel.track, sel.col);
    if (td) {
        td.classList.add('cell-selected');
        td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

export function highlightPlayStep(step) {
    document.querySelectorAll('.row-playing').forEach(r => r.classList.remove('row-playing'));
    if (step < 0) return;
    const row = document.querySelector(`#tracker-body tr[data-step="${step}"]`);
    if (row) row.classList.add('row-playing');
}

// ── KEYBOARD INPUT ──────────────────────────────────────────────
function onKeyDown(e) {
    // Ignore if focused on a toolbar input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const key = e.key.toLowerCase();

    // Navigation
    if (key === 'arrowdown')  { e.preventDefault(); moveSel(1, 0, 0); return; }
    if (key === 'arrowup')    { e.preventDefault(); moveSel(-1, 0, 0); return; }
    if (key === 'arrowleft')  { e.preventDefault(); moveSel(0, 0, -1); return; }
    if (key === 'arrowright') { e.preventDefault(); moveSel(0, 0, 1); return; }
    if (key === 'tab')        { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1, 0); return; }

    // Delete / clear cell
    if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        clearCell();
        return;
    }

    const { step, track, col } = sel;

    if (col === 0) {
        // Note column: QWERTY piano or octave +/-
        let noteIdx = QWERTY_LOWER[key] ?? QWERTY_UPPER[key] ?? -1;
        if (noteIdx >= 0) {
            const oct  = QWERTY_UPPER[key] !== undefined ? BASE_OCTAVE + 1 : BASE_OCTAVE;
            const note = `${NOTE_NAMES[noteIdx]}${oct}`;
            setNote(step, track, note);
            moveSel(1, 0, 0);
            return;
        }
        // Octave shift for existing note
        if (key === 'f1' || key === 'f2') {
            e.preventDefault();
            shiftOctave(step, track, key === 'f2' ? 1 : -1);
            return;
        }
    }

    if (col === 1) {
        // Volume: 2 hex digit entry
        if (/^[0-9a-f]$/i.test(key)) {
            const cell = state.pattern[step]?.[track];
            if (!cell?.note) return;
            const cur = (cell.vol ?? 0xff).toString(16).padStart(2, '0');
            const next = (cur[1] + key).toUpperCase();
            cell.vol = parseInt(next, 16);
            refreshCell(step, track);
            return;
        }
    }

    if (col === 2) {
        // FX column
        handleFxKey(key, step, track);
        return;
    }
}

function handleFxKey(key, step, track) {
    const cell = state.pattern[step]?.[track];
    if (!cell) return;

    // Type complete command: R, B, P
    if (key === 'r') { cell.fx = { type: 'R', value: 3 }; refreshCell(step, track); return; }
    if (key === 'b') { cell.fx = { type: 'B', value: 0 }; refreshCell(step, track); return; }
    if (key === 'p') { cell.fx = { type: 'P', value: 0 }; refreshCell(step, track); return; }

    // Adjust FX value with +/-
    if (cell.fx && (key === '+' || key === '=')) {
        cell.fx.value = (cell.fx.value ?? 0) + 1;
        refreshCell(step, track); return;
    }
    if (cell.fx && key === '-') {
        cell.fx.value = (cell.fx.value ?? 0) - 1;
        refreshCell(step, track); return;
    }
    // Digit: set value directly
    if (cell.fx && /^\d$/.test(key)) {
        cell.fx.value = parseInt(key);
        refreshCell(step, track); return;
    }
}

function moveSel(dStep, dTrack, dCol) {
    let { step, track, col } = sel;
    col   = ((col + dCol) % 3 + 3) % 3;
    track = ((track + dTrack) % state.numTracks + state.numTracks) % state.numTracks;
    step  = ((step + dStep) % state.numSteps + state.numSteps) % state.numSteps;
    sel = { step, track, col };
    refreshSelection();
}

function setNote(step, track, note) {
    const cell = state.pattern[step][track];
    cell.note = note;
    if (!cell.vol) cell.vol = 0xff;
    refreshCell(step, track);
    const si = noteToSliceIndex(note);
    if (si >= 0) previewSlice(si);
}

function shiftOctave(step, track, delta) {
    const cell = state.pattern[step]?.[track];
    if (!cell?.note) return;
    const oct = parseInt(cell.note[2]) + delta;
    if (oct < 0 || oct > 9) return;
    cell.note = cell.note.substring(0, 2) + oct;
    refreshCell(step, track);
}

function clearCell() {
    const { step, track, col } = sel;
    const cell = state.pattern[step]?.[track];
    if (!cell) return;
    if (col === 0) { cell.note = null; cell.fx = null; }
    if (col === 1) { cell.vol = 0xff; }
    if (col === 2) { cell.fx = null; }
    refreshCell(step, track);
}

function refreshCell(step, track) {
    for (let c = 0; c < 3; c++) updateCellText(null, step, track, c);
    if (onCellChange) onCellChange(step, track);
}

export function getSelection() { return { ...sel }; }
