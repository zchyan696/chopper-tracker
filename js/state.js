// NOTE_NAMES[i] gives 2-char name for chromatic index 0-11
export const NOTE_NAMES = ['C-','C#','D-','D#','E-','F-','F#','G-','G#','A-','A#','B-'];

export const BASE_OCTAVE = 4; // C-4 = slice 0

export function noteToSliceIndex(note) {
    if (!note || note === '---') return -1;
    const name = note.substring(0, 2);
    const oct  = parseInt(note[2]);
    if (isNaN(oct)) return -1;
    const idx  = NOTE_NAMES.indexOf(name);
    if (idx < 0) return -1;
    return (oct - BASE_OCTAVE) * 12 + idx;
}

export function sliceIndexToNote(i) {
    const oct  = Math.floor(i / 12) + BASE_OCTAVE;
    const name = NOTE_NAMES[((i % 12) + 12) % 12];
    return `${name}${oct}`;
}

export function makeCell() {
    return { note: null, vol: 0xff, fx: null };
}

export function makeStep(numTracks) {
    return Array.from({ length: numTracks }, makeCell);
}

export function makePattern(numSteps, numTracks) {
    return Array.from({ length: numSteps }, () => makeStep(numTracks));
}

export const state = {
    bpm: 174,
    lpb: 4,
    numSteps: 32,
    numTracks: 4,
    pattern: null,
    slices: [],       // [{ start, end, note }]  (sample frame indices)
    audioBuffer: null,
};

state.pattern = makePattern(state.numSteps, state.numTracks);
