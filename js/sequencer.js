import { state } from './state.js';
import { getCtx, scheduleCell } from './audio.js';

const LOOKAHEAD = 0.12;   // seconds to schedule ahead
const TICK_MS   = 25;     // scheduler poll interval ms

let playing = false;
let currentStep = 0;
let nextStepTime = 0;
let timerId = null;
let onStepCb = null; // callback(stepIndex)

function stepDuration() {
    return 60 / (state.bpm * state.lpb);
}

function tick() {
    const ac = getCtx();
    while (nextStepTime < ac.currentTime + LOOKAHEAD) {
        scheduleStep(currentStep, nextStepTime);
        if (onStepCb) onStepCb(currentStep);
        nextStepTime += stepDuration();
        currentStep = (currentStep + 1) % state.numSteps;
    }
    timerId = setTimeout(tick, TICK_MS);
}

function scheduleStep(step, audioTime) {
    const dur = stepDuration();
    for (let t = 0; t < state.numTracks; t++) {
        const cell = state.pattern[step]?.[t];
        scheduleCell(cell, dur, audioTime);
    }
}

export function play(onStep) {
    if (playing) return;
    onStepCb = onStep ?? null;
    playing = true;
    currentStep = 0;
    nextStepTime = getCtx().currentTime + 0.05;
    tick();
}

export function stop() {
    if (!playing) return;
    playing = false;
    clearTimeout(timerId);
    timerId = null;
    currentStep = 0;
    if (onStepCb) onStepCb(-1);
}

export function isPlaying() { return playing; }
export function getCurrentStep() { return currentStep; }
