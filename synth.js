'use strict';

// ─── AUDIO CONTEXT ───────────────────────────────────────────────────────────
let ac          = null;
let masterGain  = null;
let analyserNode= null;

function getAC() {
    if (!ac || ac.state === 'closed') {
        ac = new AudioContext();
        analyserNode = ac.createAnalyser();
        analyserNode.fftSize = 1024;
        masterGain = ac.createGain();
        masterGain.gain.value = parseFloat(document.getElementById('sy-vol').value || 0.7);
        masterGain.connect(analyserNode);
        analyserNode.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentCat      = 'BASS';
let currentMode     = 'note';
let octaveBase      = 3;
let activeNodes     = [];
let loopTimer       = null;
let isPlaying       = false;
let heldKeyNodes    = {};
let wfAnimId        = null;
let currentPresetIdx= 0;

const macroValues = {
    timbre:   0.5,
    attack:   0.1,
    length:   0.4,
    body:     0.5,
    texture:  0.0,
    space:    0.3,
    movement: 0.0,
};

// ─── MACRO DEFINITIONS ───────────────────────────────────────────────────────
const MACRO_DEFS = [
    { key: 'timbre',   label: 'TIMBRE',    lo: 'ESCURO',   hi: 'BRILHANTE' },
    { key: 'attack',   label: 'ATAQUE',    lo: 'SUAVE',    hi: 'DURO'      },
    { key: 'length',   label: 'DURAÇÃO',   lo: 'CURTO',    hi: 'LONGO'     },
    { key: 'body',     label: 'CORPO',     lo: 'FINO',     hi: 'GORDO'     },
    { key: 'texture',  label: 'TEXTURA',   lo: 'LIMPO',    hi: 'SUJO'      },
    { key: 'space',    label: 'ESPAÇO',    lo: 'SECO',     hi: 'REVERB'    },
    { key: 'movement', label: 'MOVIMENTO', lo: 'ESTÁTICO', hi: 'WOBBLE'    },
];

// ─── PRESETS ─────────────────────────────────────────────────────────────────
const PRESETS = {
    BASS: [
        { name: '808 SUB',      desc: 'grave e puro',        macros: { timbre:0.15, attack:0.05, length:0.7,  body:0.9, texture:0.0, space:0.0,  movement:0.0 } },
        { name: 'REESE',        desc: 'modulado e gordo',    macros: { timbre:0.4,  attack:0.1,  length:0.8,  body:0.8, texture:0.3, space:0.1,  movement:0.6 } },
        { name: 'GROWL',        desc: 'agressivo e sujo',    macros: { timbre:0.6,  attack:0.2,  length:0.5,  body:0.7, texture:0.8, space:0.05, movement:0.4 } },
        { name: 'ACID',         desc: 'brilhante e ácido',   macros: { timbre:0.8,  attack:0.05, length:0.3,  body:0.5, texture:0.5, space:0.1,  movement:0.5 } },
        { name: 'DUB SUB',      desc: 'profundo e suave',    macros: { timbre:0.1,  attack:0.3,  length:0.9,  body:1.0, texture:0.0, space:0.4,  movement:0.1 } },
        { name: 'BRUXARIA',     desc: 'dark wobble pesado',  macros: { timbre:0.3,  attack:0.05, length:0.65, body:0.95,texture:0.7, space:0.2,  movement:0.75} },
        { name: '808 DARK',     desc: 'sub sombrio e gordo', macros: { timbre:0.08, attack:0.02, length:0.8,  body:1.0, texture:0.25,space:0.1,  movement:0.0 } },
        { name: 'REESE PESADO', desc: 'reese com saturação', macros: { timbre:0.35, attack:0.08, length:0.75, body:0.85,texture:0.6, space:0.15, movement:0.65} },
    ],
    PLUCK: [
        { name: 'VIOLÃO',       desc: 'natural e claro',     macros: { timbre:0.65, attack:0.0,  length:0.45, body:0.4, texture:0.05,space:0.2,  movement:0.0 } },
        { name: 'MALLET',       desc: 'percussivo e doce',   macros: { timbre:0.5,  attack:0.0,  length:0.35, body:0.6, texture:0.0, space:0.3,  movement:0.0 } },
        { name: 'HARP',         desc: 'brilhante e longo',   macros: { timbre:0.75, attack:0.0,  length:0.7,  body:0.3, texture:0.0, space:0.5,  movement:0.0 } },
        { name: 'KOTO',         desc: 'percussivo e étnico', macros: { timbre:0.6,  attack:0.0,  length:0.4,  body:0.5, texture:0.1, space:0.25, movement:0.15} },
        { name: 'BRIGHT PLUCK', desc: 'rápido e brilhante',  macros: { timbre:0.9,  attack:0.0,  length:0.25, body:0.3, texture:0.2, space:0.15, movement:0.0 } },
        { name: 'PLUCK DARK',   desc: 'pluck sujo e curto',  macros: { timbre:0.4,  attack:0.0,  length:0.3,  body:0.7, texture:0.65,space:0.1,  movement:0.0 } },
    ],
    LEAD: [
        { name: 'SAW LEAD',     desc: 'clássico e afiado',   macros: { timbre:0.7,  attack:0.05, length:0.6,  body:0.5, texture:0.1, space:0.2,  movement:0.0 } },
        { name: 'SQUARE LEAD',  desc: 'oco e retro',         macros: { timbre:0.55, attack:0.05, length:0.6,  body:0.6, texture:0.1, space:0.2,  movement:0.0 } },
        { name: 'SUPERSAW',     desc: 'grosso e épico',      macros: { timbre:0.65, attack:0.1,  length:0.7,  body:0.9, texture:0.05,space:0.4,  movement:0.1 } },
        { name: 'SCREAMER',     desc: 'gritante e saturado', macros: { timbre:0.85, attack:0.03, length:0.5,  body:0.6, texture:0.9, space:0.1,  movement:0.0 } },
        { name: 'WOBBLE LEAD',  desc: 'oscilante e vivo',    macros: { timbre:0.6,  attack:0.1,  length:0.7,  body:0.5, texture:0.2, space:0.25, movement:0.9 } },
        { name: 'STAB FUNK',    desc: 'stab curto e sujo',   macros: { timbre:0.7,  attack:0.0,  length:0.1,  body:0.65,texture:0.85,space:0.1,  movement:0.0 } },
        { name: 'MELODIA BRUX', desc: 'lead sombrio e sujo', macros: { timbre:0.45, attack:0.05, length:0.55, body:0.7, texture:0.75,space:0.2,  movement:0.5 } },
    ],
    PAD: [
        { name: 'STRINGS',      desc: 'suave e orquestral',  macros: { timbre:0.5,  attack:0.5,  length:0.9,  body:0.7, texture:0.0, space:0.7,  movement:0.1 } },
        { name: 'ATMOSPHERE',   desc: 'etéreo e largo',      macros: { timbre:0.35, attack:0.6,  length:1.0,  body:0.6, texture:0.0, space:0.9,  movement:0.2 } },
        { name: 'DARK PAD',     desc: 'sombrio e tenso',     macros: { timbre:0.2,  attack:0.4,  length:0.9,  body:0.8, texture:0.3, space:0.6,  movement:0.3 } },
        { name: 'ANALOG PAD',   desc: 'quente e vintage',    macros: { timbre:0.45, attack:0.35, length:0.85, body:0.7, texture:0.1, space:0.5,  movement:0.15} },
        { name: 'SHIMMER',      desc: 'brilhante e aéreo',   macros: { timbre:0.8,  attack:0.5,  length:0.95, body:0.4, texture:0.0, space:0.85, movement:0.4 } },
        { name: 'ASSOMBRO',     desc: 'etéreo e perturbador',macros: { timbre:0.2,  attack:0.55, length:0.95, body:0.7, texture:0.25,space:0.85, movement:0.45} },
        { name: 'NÉVOA DARK',   desc: 'sombrio e movimento', macros: { timbre:0.15, attack:0.6,  length:1.0,  body:0.8, texture:0.1, space:0.9,  movement:0.35} },
    ],
    KEYS: [
        { name: 'PIANO',        desc: 'acústico e claro',    macros: { timbre:0.65, attack:0.0,  length:0.55, body:0.5, texture:0.0, space:0.3,  movement:0.0 } },
        { name: 'E.PIANO',      desc: 'elétrico e quente',   macros: { timbre:0.55, attack:0.02, length:0.5,  body:0.6, texture:0.15,space:0.2,  movement:0.05} },
        { name: 'VIBRAPHONE',   desc: 'metálico e doce',     macros: { timbre:0.7,  attack:0.0,  length:0.65, body:0.4, texture:0.0, space:0.45, movement:0.2 } },
        { name: 'ORGAN',        desc: 'cheio e sustentado',  macros: { timbre:0.6,  attack:0.0,  length:1.0,  body:0.8, texture:0.05,space:0.15, movement:0.0 } },
        { name: 'CLAVINET',     desc: 'percussivo e funk',   macros: { timbre:0.75, attack:0.0,  length:0.3,  body:0.5, texture:0.35,space:0.1,  movement:0.0 } },
    ],
    FX: [
        { name: 'RISER',        desc: 'sobe e cresce',       macros: { timbre:0.7,  attack:0.9,  length:0.9,  body:0.5, texture:0.1, space:0.5,  movement:0.3 } },
        { name: 'NOISE SWEEP',  desc: 'ruído filtrado',      macros: { timbre:0.5,  attack:0.4,  length:0.7,  body:0.3, texture:0.0, space:0.4,  movement:0.5 } },
        { name: 'STAB',         desc: 'impacto rápido',      macros: { timbre:0.8,  attack:0.0,  length:0.1,  body:0.7, texture:0.4, space:0.2,  movement:0.0 } },
        { name: 'SCI-FI',       desc: 'futurista e estranho',macros: { timbre:0.6,  attack:0.2,  length:0.6,  body:0.5, texture:0.2, space:0.6,  movement:0.8 } },
        { name: 'IMPACT',       desc: 'pancada e boom',      macros: { timbre:0.2,  attack:0.0,  length:0.5,  body:1.0, texture:0.6, space:0.3,  movement:0.0 } },
        { name: 'SUSTO',        desc: 'impacto e terror',    macros: { timbre:0.3,  attack:0.0,  length:0.4,  body:0.9, texture:0.8, space:0.4,  movement:0.2 } },
        { name: 'SIRENE',       desc: 'sobe e desce wobble', macros: { timbre:0.65, attack:0.3,  length:0.7,  body:0.5, texture:0.3, space:0.5,  movement:0.95} },
        { name: 'PORTAL',       desc: 'transição sombria',   macros: { timbre:0.5,  attack:0.5,  length:0.9,  body:0.6, texture:0.15,space:0.75, movement:0.8 } },
    ],
};

// ─── REVERB BUFFER ───────────────────────────────────────────────────────────
let _reverbBuf = null;
function buildReverb(ctx) {
    const sr = ctx.sampleRate, len = Math.floor(sr * 2.5);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 1.5);
    }
    return buf;
}

function getReverbBuf() {
    if (!_reverbBuf) _reverbBuf = buildReverb(getAC());
    return _reverbBuf;
}

// ─── DISTORTION CURVE ────────────────────────────────────────────────────────
function makeDistCurve(amount) {
    const n = 256, curve = new Float32Array(n), k = amount * 300;
    for (let i = 0; i < n; i++) {
        const x = (i*2)/n - 1;
        curve[i] = k ? ((Math.PI+k)*x)/(Math.PI+k*Math.abs(x)) : x;
    }
    return curve;
}

// ─── SYNTHESIS ───────────────────────────────────────────────────────────────
// dest: AudioNode to connect the voice output to
function buildVoice(ctx, midi, mv, cat, startTime, stopTime, dest) {
    const freq     = 440 * Math.pow(2, (midi-69)/12);
    const { timbre, attack, length, body, texture, space, movement } = mv;

    const atkT  = 0.003 + attack * 0.8;
    const decT  = 0.05  + length * 0.4;
    const susLv = 0.3   + length * 0.5;
    const relT  = 0.05  + length * 1.5;

    let baseCutoff = 80 + timbre*timbre*18000;
    if (cat==='BASS')  baseCutoff = 60  + timbre*timbre*4000;
    if (cat==='PAD')   baseCutoff = 200 + timbre*timbre*8000;
    if (cat==='KEYS')  baseCutoff = 300 + timbre*timbre*12000;

    const nodes = [];

    // envelope gain
    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, startTime);
    voiceGain.gain.linearRampToValueAtTime(0.8, startTime + atkT);
    voiceGain.gain.linearRampToValueAtTime(susLv*0.8, startTime + atkT + decT);
    if (stopTime !== null) {
        voiceGain.gain.setValueAtTime(susLv*0.8, stopTime);
        voiceGain.gain.linearRampToValueAtTime(0.0001, stopTime + relT);
    }

    // filter
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = Math.min(baseCutoff, ctx.sampleRate/2-1);
    filt.Q.value = 1 + timbre*8;

    // LFO
    if (movement > 0.01) {
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.5 + movement*6;
        const lg = ctx.createGain();
        lg.gain.value = movement*movement*baseCutoff*0.8;
        lfo.connect(lg); lg.connect(filt.frequency);
        lfo.start(startTime);
        nodes.push(lfo);
    }

    // distortion
    let distNode = null;
    if (texture > 0.02) {
        distNode = ctx.createWaveShaper();
        distNode.curve = makeDistCurve(texture);
        distNode.oversample = '4x';
    }

    // reverb
    let convNode=null, dryGain=null, wetGain=null;
    if (space > 0.02) {
        convNode = ctx.createConvolver();
        convNode.buffer = buildReverb(ctx);
        dryGain = ctx.createGain(); dryGain.gain.value = 1 - space*0.5;
        wetGain = ctx.createGain(); wetGain.gain.value = space*0.6;
    }

    // oscillator helper
    function makeOsc(type, detuneCents, gainVal) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type; o.frequency.value = freq; o.detune.value = detuneCents;
        g.gain.value = gainVal;
        o.connect(g); o.start(startTime);
        if (stopTime !== null) o.stop(stopTime + relT + 0.1);
        nodes.push(o);
        return g;
    }

    const oMix = ctx.createGain();

    if (cat === 'BASS') {
        makeOsc('sine',    0,    0.7+body*0.3).connect(oMix);
        makeOsc('sawtooth',0,    body*0.4).connect(oMix);
        makeOsc('sine',   -1200, body*0.6).connect(oMix);
    } else if (cat === 'PLUCK') {
        makeOsc('sawtooth', 0, 0.5).connect(oMix);
        makeOsc('square',   7, body*0.3).connect(oMix);
        filt.frequency.setValueAtTime(baseCutoff*2, startTime);
        filt.frequency.exponentialRampToValueAtTime(baseCutoff*0.3, startTime+0.05+length*0.3);
    } else if (cat === 'LEAD') {
        makeOsc('sawtooth', 0,                  0.5).connect(oMix);
        makeOsc('sawtooth', body>0.5 ?  7 : 0,  0.4*body).connect(oMix);
        makeOsc('sawtooth', body>0.5 ? -7 : 0,  0.3*body).connect(oMix);
    } else if (cat === 'PAD') {
        makeOsc('sawtooth', 0,              0.35).connect(oMix);
        makeOsc('sawtooth', 5+body*10,      0.3).connect(oMix);
        makeOsc('sawtooth', -(5+body*10),   0.3).connect(oMix);
        makeOsc('square',   0,              body*0.2).connect(oMix);
    } else if (cat === 'KEYS') {
        makeOsc('triangle', 0,  0.6).connect(oMix);
        makeOsc('square',   12, body*0.2).connect(oMix);
        makeOsc('sawtooth', 0,  body*0.15).connect(oMix);
    } else { // FX
        makeOsc('sawtooth', 0, 0.4).connect(oMix);
        const fx = ctx.createOscillator();
        fx.type = 'sawtooth';
        fx.frequency.value = freq*(1+movement*3);
        if (movement > 0.3) fx.frequency.linearRampToValueAtTime(freq*(2+movement*4), startTime+relT);
        const fg = ctx.createGain(); fg.gain.value = 0.3+body*0.4;
        fx.connect(fg); fg.connect(oMix);
        fx.start(startTime);
        if (stopTime !== null) fx.stop(stopTime+relT+0.1);
        nodes.push(fx);
    }

    // chain: oMix → [dist] → filt → [reverb] → voiceGain → dest
    let chain = oMix;
    if (distNode) { chain.connect(distNode); chain = distNode; }
    chain.connect(filt);

    if (convNode) {
        filt.connect(dryGain);  dryGain.connect(voiceGain);
        filt.connect(convNode); convNode.connect(wetGain); wetGain.connect(voiceGain);
    } else {
        filt.connect(voiceGain);
    }

    voiceGain.connect(dest);
    return { nodes, voiceGain, relT };
}

// ─── PLAY HELPERS ────────────────────────────────────────────────────────────
const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const WHITE_SEMIS = [0,2,4,5,7,9,11];

function midiForNote(semis) { return 12*(octaveBase+1)+semis; }
function midiName(midi)      { return NOTE_NAMES[midi%12] + Math.floor(midi/12-1); }

function stopAll() {
    clearInterval(loopTimer); loopTimer = null;
    isPlaying = false;
    for (const info of activeNodes) {
        try {
            for (const n of info.nodes) n.stop(0);
            info.voiceGain.gain.cancelScheduledValues(0);
            info.voiceGain.gain.setValueAtTime(0, 0);
        } catch(e) {}
    }
    activeNodes = [];
    updatePlayBtn();
    setStatus('pronto');
}

function playNote(midi, duration) {
    const ctx = getAC();
    const t0  = ctx.currentTime + 0.01;
    const info = buildVoice(ctx, midi, {...macroValues}, currentCat, t0, t0+duration, masterGain);
    activeNodes.push(info);
    const ms = (duration + info.relT + 0.2) * 1000;
    setTimeout(() => {
        const idx = activeNodes.indexOf(info);
        if (idx>=0) activeNodes.splice(idx,1);
        if (activeNodes.length===0) { isPlaying=false; updatePlayBtn(); }
    }, ms);
    return info;
}

// ─── PLAY MODES ──────────────────────────────────────────────────────────────
const CHORD_MAJOR = [0,4,7], CHORD_MINOR = [0,3,7];
const SCALE_MAJOR = [0,2,4,5,7,9,11,12];

function playModeNote() {
    stopAll(); isPlaying=true; updatePlayBtn();
    const midi = midiForNote(0);
    setStatus('♪ '+midiName(midi));
    playNote(midi, 1.2+macroValues.length*2);
}

function playModeChord() {
    stopAll(); isPlaying=true; updatePlayBtn();
    const semis = macroValues.timbre < 0.5 ? CHORD_MINOR : CHORD_MAJOR;
    const ctx = getAC(), t0 = ctx.currentTime+0.01;
    const dur = 1.5+macroValues.length*2;
    const names = [];
    for (const s of semis) {
        const midi = midiForNote(s); names.push(midiName(midi));
        const info = buildVoice(ctx, midi, {...macroValues}, currentCat, t0, t0+dur, masterGain);
        activeNodes.push(info);
    }
    setStatus('♪ '+names.join(' '));
    setTimeout(()=>{ isPlaying=false; updatePlayBtn(); activeNodes=[]; }, (dur+2.5)*1000);
}

function playModeScale() {
    stopAll(); isPlaying=true; updatePlayBtn();
    const noteDur = 0.25+macroValues.length*0.3;
    const gap     = noteDur*0.9;
    SCALE_MAJOR.forEach((s,i)=>{
        const midi = midiForNote(s);
        setTimeout(()=>{
            if (!isPlaying) return;
            setStatus('♪ '+midiName(midi));
            playNote(midi, noteDur);
        }, i*gap*1000);
    });
    setTimeout(()=>{ isPlaying=false; updatePlayBtn(); }, (SCALE_MAJOR.length*gap+noteDur+2)*1000);
}

function playModeLoop() {
    stopAll(); isPlaying=true; updatePlayBtn(); showLoopCanvas(true);
    const patterns = {
        BASS:  [0,null,0,null,7,null,5,null],
        PLUCK: [0,4,7,4,0,4,7,12],
        LEAD:  [0,7,12,7,0,5,7,5],
        PAD:   [0,null,null,null,0,null,null,null],
        KEYS:  [0,4,7,12,7,4,0,4],
        FX:    [0,null,12,null,7,null,0,null],
    };
    const pattern = patterns[currentCat];
    const step = (60/120)/2;
    let idx = 0;
    function tick() {
        if (!isPlaying) return;
        const semi = pattern[idx%pattern.length];
        if (semi !== null) { const midi=midiForNote(semi); setStatus('♪ '+midiName(midi)); playNote(midi, step*0.8); }
        drawLoopStep(idx%pattern.length, pattern.length);
        idx++;
    }
    tick();
    loopTimer = setInterval(tick, step*1000);
}

function togglePlay() {
    if (isPlaying) { stopAll(); return; }
    if (currentMode==='note')  playModeNote();
    else if (currentMode==='chord') playModeChord();
    else if (currentMode==='scale') playModeScale();
    else if (currentMode==='loop')  playModeLoop();
}

// ─── PIANO KEYBOARD ──────────────────────────────────────────────────────────
function drawKeyboard(activeSet) {
    const canvas = document.getElementById('sy-kb');
    const W = canvas.offsetWidth, H = canvas.offsetHeight||90;
    canvas.width=W; canvas.height=H;
    const ctx = canvas.getContext('2d');
    const octaves=3, startOct=octaveBase-1;
    const numWhite=octaves*7, wkW=W/numWhite, wkH=H, bkW=wkW*0.6, bkH=wkH*0.62;

    ctx.clearRect(0,0,W,H);

    // white keys
    for (let o=0;o<octaves;o++) {
        for (let wi=0;wi<7;wi++) {
            const semi=WHITE_SEMIS[wi], midi=(startOct+o+1)*12+semi;
            const x=(o*7+wi)*wkW;
            const active=activeSet && activeSet.has(midi);
            ctx.fillStyle = active ? '#a0c8f0' : '#ece8e0';
            ctx.fillRect(x+0.5, 0, wkW-1, wkH-1);
            ctx.strokeStyle='#555'; ctx.strokeRect(x+0.5,0,wkW-1,wkH-1);
            ctx.fillStyle = active ? '#fff' : '#333';
            ctx.font = `${Math.max(8,wkW*0.38)}px 'Courier New'`;
            ctx.textAlign='center';
            ctx.fillText(semi===0 ? NOTE_NAMES[semi]+(startOct+o+1) : NOTE_NAMES[semi], x+wkW/2, wkH-5);
        }
    }

    // black keys
    for (let o=0;o<octaves;o++) {
        for (let wi=0;wi<7;wi++) {
            if (![0,1,3,4,5].includes(wi)) continue;
            const semi=WHITE_SEMIS[wi]+1, midi=(startOct+o+1)*12+semi;
            const x=(o*7+wi)*wkW+wkW-bkW/2;
            const active=activeSet && activeSet.has(midi);
            ctx.fillStyle = active ? '#6aacf0' : '#1a1a1a';
            ctx.fillRect(x,0,bkW,bkH);
            ctx.strokeStyle='#000'; ctx.strokeRect(x,0,bkW,bkH);
            ctx.fillStyle = active ? '#fff' : '#666';
            ctx.font = `${Math.max(7,bkW*0.45)}px 'Courier New'`;
            ctx.textAlign='center';
            ctx.fillText(NOTE_NAMES[semi], x+bkW/2, bkH-4);
        }
    }
}

function midiFromClick(canvas, e) {
    const rect=canvas.getBoundingClientRect(), cx=e.clientX-rect.left, cy=e.clientY-rect.top;
    const W=rect.width, H=rect.height, octaves=3, startOct=octaveBase-1;
    const wkW=W/(octaves*7), bkW=wkW*0.6, bkH=H*0.62;
    if (cy < bkH) {
        for (let o=0;o<octaves;o++) {
            for (let wi=0;wi<7;wi++) {
                if (![0,1,3,4,5].includes(wi)) continue;
                const bx=(o*7+wi)*wkW+wkW-bkW/2;
                if (cx>=bx && cx<=bx+bkW) return (startOct+o+1)*12+WHITE_SEMIS[wi]+1;
            }
        }
    }
    const wt=Math.floor(cx/wkW), o=Math.floor(wt/7), wi=wt%7;
    return (startOct+o+1)*12+WHITE_SEMIS[wi];
}

function initKBEvents() {
    const canvas = document.getElementById('sy-kb');

    canvas.addEventListener('mousedown', e => {
        const midi = midiFromClick(canvas, e);
        if (currentMode==='keys') {
            if (heldKeyNodes[midi]) return;
            const ctx=getAC(), t0=ctx.currentTime+0.01;
            const info=buildVoice(ctx,midi,{...macroValues},currentCat,t0,null,masterGain);
            activeNodes.push(info); heldKeyNodes[midi]=info;
        } else {
            stopAll();
            playNote(midi, 0.8+macroValues.length*1.5);
        }
        drawKeyboard(new Set([midi,...Object.keys(heldKeyNodes).map(Number)]));
        setStatus('♪ '+midiName(midi)); showNoteIndicator(midiName(midi));
    });

    window.addEventListener('mouseup', ()=>{
        if (currentMode!=='keys') return;
        const now = getAC().currentTime;
        for (const midi of Object.keys(heldKeyNodes)) {
            const info=heldKeyNodes[midi], relT=info.relT||0.3;
            info.voiceGain.gain.cancelScheduledValues(now);
            info.voiceGain.gain.setValueAtTime(info.voiceGain.gain.value, now);
            info.voiceGain.gain.linearRampToValueAtTime(0.0001, now+relT);
            setTimeout(()=>{ try{ for(const n of info.nodes) n.stop(0); }catch(e){} const i=activeNodes.indexOf(info);if(i>=0)activeNodes.splice(i,1); }, (relT+0.1)*1000);
            delete heldKeyNodes[midi];
        }
        drawKeyboard(new Set());
    });
}

// ─── QWERTY → NOTES ──────────────────────────────────────────────────────────
const KEY_MAP = { a:0,w:1,s:2,e:3,d:4,f:5,t:6,g:7,y:8,h:9,u:10,j:11,k:12 };
const heldQ   = {};

document.addEventListener('keydown', e=>{
    if (e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
    const k=e.key.toLowerCase();
    if (k===' ')                     { e.preventDefault(); togglePlay(); return; }
    if (k==='e' && !e.ctrlKey)       { exportWAV(); return; }
    if (k===']')                     { cyclePreset(1);  return; }
    if (k==='[')                     { cyclePreset(-1); return; }
    if (e.ctrlKey&&e.key==='ArrowUp')  { e.preventDefault(); changeOctave(1);  return; }
    if (e.ctrlKey&&e.key==='ArrowDown'){ e.preventDefault(); changeOctave(-1); return; }
    if (KEY_MAP[k]===undefined || heldQ[k]) return;
    heldQ[k]=true;
    const midi=midiForNote(KEY_MAP[k]);
    setStatus('♪ '+midiName(midi)); showNoteIndicator(midiName(midi));
    if (currentMode==='keys') {
        if (heldKeyNodes[midi]) return;
        const ctx=getAC(), t0=ctx.currentTime+0.01;
        const info=buildVoice(ctx,midi,{...macroValues},currentCat,t0,null,masterGain);
        activeNodes.push(info); heldKeyNodes[midi]=info;
        drawKeyboard(new Set(Object.keys(heldKeyNodes).map(Number)));
    } else {
        stopAll(); playNote(midi, 0.8+macroValues.length*1.5);
        drawKeyboard(new Set([midi])); setTimeout(()=>drawKeyboard(new Set()),300);
    }
});

document.addEventListener('keyup', e=>{
    const k=e.key.toLowerCase();
    if (KEY_MAP[k]===undefined) return;
    delete heldQ[k];
    if (currentMode!=='keys') return;
    const midi=midiForNote(KEY_MAP[k]), info=heldKeyNodes[midi];
    if (!info) return;
    const now=getAC().currentTime, relT=info.relT||0.3;
    info.voiceGain.gain.cancelScheduledValues(now);
    info.voiceGain.gain.setValueAtTime(info.voiceGain.gain.value,now);
    info.voiceGain.gain.linearRampToValueAtTime(0.0001, now+relT);
    setTimeout(()=>{ try{for(const n of info.nodes)n.stop(0);}catch(e){} const i=activeNodes.indexOf(info);if(i>=0)activeNodes.splice(i,1); }, (relT+0.1)*1000);
    delete heldKeyNodes[midi];
    drawKeyboard(new Set(Object.keys(heldKeyNodes).map(Number)));
});

// ─── WAVEFORM PREVIEW (static, based on macros) ──────────────────────────────
function computeWavePreview(samples) {
    const { timbre, body, texture, movement } = macroValues;
    const out = new Float32Array(samples);
    const cycles = 3;
    // simple LP filter state
    let lpPrev = 0;
    const lpAlpha = 0.05 + timbre * 0.9; // high timbre = less smoothing

    for (let i = 0; i < samples; i++) {
        const t = (i / samples) * cycles * Math.PI * 2;
        let s = 0;

        if (currentCat === 'BASS') {
            const saw = ((t % (Math.PI*2)) / (Math.PI*2)) * 2 - 1;
            s = Math.sin(t) * (0.6+body*0.3) + saw*body*0.35 + Math.sin(t/2)*body*0.25;
        } else if (currentCat === 'PLUCK') {
            const saw = ((t % (Math.PI*2)) / (Math.PI*2)) * 2 - 1;
            const env = Math.exp(-(i/samples)*5);
            s = (saw*0.5 + Math.sin(t)*0.3) * env;
        } else if (currentCat === 'LEAD') {
            const saw1 = ((t % (Math.PI*2)) / (Math.PI*2)) * 2 - 1;
            const saw2 = (((t+body*0.5) % (Math.PI*2)) / (Math.PI*2)) * 2 - 1;
            s = saw1*0.5 + saw2*body*0.35;
        } else if (currentCat === 'PAD') {
            const saw1 = ((t % (Math.PI*2)) / (Math.PI*2)) * 2 - 1;
            const saw2 = (((t*1.004) % (Math.PI*2)) / (Math.PI*2)) * 2 - 1;
            s = (saw1 + saw2*body) * 0.35;
        } else if (currentCat === 'KEYS') {
            const ph = (t % (Math.PI*2)) / (Math.PI*2);
            const tri = ph < 0.5 ? ph*4-1 : 3-ph*4;
            const sq  = ph < 0.5 ? 1 : -1;
            s = tri*0.6 + sq*body*0.15;
        } else { // FX
            const saw = ((t % (Math.PI*2)) / (Math.PI*2)) * 2 - 1;
            s = saw*0.4 + Math.sin(t*(1+movement*4))*0.35;
        }

        // low-pass filter approximation
        lpPrev = lpPrev + lpAlpha * (s - lpPrev);
        s = lpPrev;

        // distortion
        if (texture > 0.02) {
            const k = texture * 300;
            s = ((Math.PI+k)*s) / (Math.PI+k*Math.abs(s));
        }

        out[i] = Math.max(-1, Math.min(1, s));
    }
    return out;
}

// ─── WAVEFORM ANIMATION ──────────────────────────────────────────────────────
function startWaveformAnim() {
    const canvas=document.getElementById('sy-waveform');
    const ctx=canvas.getContext('2d');
    function draw() {
        const W=canvas.offsetWidth||400, H=80;
        canvas.width=W; canvas.height=H;
        ctx.fillStyle='#080808'; ctx.fillRect(0,0,W,H);

        // grid lines
        ctx.strokeStyle='#141414'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,H*0.25); ctx.lineTo(W,H*0.25); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,H*0.75); ctx.lineTo(W,H*0.75); ctx.stroke();

        // live oscilloscope when playing
        if (analyserNode && isPlaying) {
            const buf=new Uint8Array(analyserNode.frequencyBinCount);
            analyserNode.getByteTimeDomainData(buf);
            const hasSignal = buf.some(v=>v!==128);
            if (hasSignal) {
                ctx.strokeStyle='#4a90d9'; ctx.lineWidth=1.5; ctx.beginPath();
                for (let i=0;i<buf.length;i++) {
                    const x=i/buf.length*W, y=((buf[i]/128)-1)*(H/2)+H/2;
                    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
                }
                ctx.stroke();
                wfAnimId=requestAnimationFrame(draw);
                return;
            }
        }

        // static preview based on current macros
        const preview = computeWavePreview(W);
        ctx.strokeStyle='#2a5080'; ctx.lineWidth=1; ctx.beginPath();
        for (let i=0;i<W;i++) {
            const y = (1-preview[i])*(H/2);
            i===0?ctx.moveTo(i,y):ctx.lineTo(i,y);
        }
        ctx.stroke();
        // filled area
        ctx.fillStyle='rgba(30,60,100,0.18)';
        ctx.beginPath(); ctx.moveTo(0,H/2);
        for (let i=0;i<W;i++) { const y=(1-preview[i])*(H/2); ctx.lineTo(i,y); }
        ctx.lineTo(W,H/2); ctx.closePath(); ctx.fill();
        // bright line on top
        ctx.strokeStyle='#3a7abf'; ctx.lineWidth=1.5; ctx.beginPath();
        for (let i=0;i<W;i++) {
            const y=(1-preview[i])*(H/2);
            i===0?ctx.moveTo(i,y):ctx.lineTo(i,y);
        }
        ctx.stroke();

        wfAnimId=requestAnimationFrame(draw);
    }
    if (wfAnimId) cancelAnimationFrame(wfAnimId);
    draw();
}

// ─── LOOP CANVAS ─────────────────────────────────────────────────────────────
function showLoopCanvas(show) {
    document.getElementById('sy-loop-wrap').style.display = show ? 'flex' : 'none';
}

function drawLoopStep(activeStep, total) {
    const canvas=document.getElementById('sy-loop-canvas');
    const W=canvas.offsetWidth||400, H=40;
    canvas.width=W; canvas.height=H;
    const ctx=canvas.getContext('2d'), sw=W/total;
    ctx.fillStyle='#080808'; ctx.fillRect(0,0,W,H);
    for (let i=0;i<total;i++) {
        ctx.fillStyle = i===activeStep ? '#4a90d9' : '#1c1c1c';
        ctx.fillRect(i*sw+2,4,sw-4,H-8);
        ctx.strokeStyle='#2a2a2a'; ctx.strokeRect(i*sw+2,4,sw-4,H-8);
    }
    document.getElementById('sy-loop-info').textContent='● LOOP · 120 BPM · passo '+(activeStep+1)+'/'+total;
}

// ─── EXPORT WAV ──────────────────────────────────────────────────────────────
async function exportWAV() {
    setStatus('renderizando...');
    const sr=44100, dur=2+macroValues.length*3;
    const offCtx=new OfflineAudioContext(2, Math.ceil(sr*dur), sr);
    const info=buildVoice(offCtx, midiForNote(0), {...macroValues}, currentCat, 0.01, 0.01+dur*0.6, offCtx.destination);
    let rendered;
    try { rendered=await offCtx.startRendering(); }
    catch(e) { setStatus('erro: '+e.message); return; }
    const wav=encodeWAV(rendered);
    const blob=new Blob([wav],{type:'audio/wav'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const name = currentPresetIdx>=0 ? PRESETS[currentCat][currentPresetIdx].name.replace(/\s+/g,'_') : currentCat;
    a.download=`synth_${name}.wav`; a.href=url; a.click();
    URL.revokeObjectURL(url);
    setStatus('exportado: '+a.download);
}

function encodeWAV(buf) {
    const nCh=buf.numberOfChannels, sr=buf.sampleRate, len=buf.length;
    const blockAlign=nCh*2, dataSize=len*blockAlign;
    const ab=new ArrayBuffer(44+dataSize), v=new DataView(ab);
    const wr=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };
    wr(0,'RIFF'); v.setUint32(4,36+dataSize,true); wr(8,'WAVE'); wr(12,'fmt ');
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,nCh,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*blockAlign,true);
    v.setUint16(32,blockAlign,true); v.setUint16(34,16,true);
    wr(36,'data'); v.setUint32(40,dataSize,true);
    const chs=[]; for(let c=0;c<nCh;c++) chs.push(buf.getChannelData(c));
    let off=44;
    for(let i=0;i<len;i++) for(let c=0;c<nCh;c++) {
        const s=Math.max(-1,Math.min(1,chs[c][i]));
        v.setInt16(off, s<0?s*32768:s*32767, true); off+=2;
    }
    return ab;
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function setStatus(msg) { const el=document.getElementById('sy-status'); if(el) el.textContent=msg; }
function showNoteIndicator(name) {
    const el=document.getElementById('sy-note-indicator');
    if(!el) return; el.textContent=name; clearTimeout(el._t); el._t=setTimeout(()=>el.textContent='',1500);
}
function updatePlayBtn() {
    const btn=document.getElementById('sy-btn-play');
    if(!btn) return; btn.textContent=isPlaying?'■ PARAR':'▶ TOCAR'; btn.classList.toggle('playing',isPlaying);
}
function changeOctave(delta) {
    octaveBase=Math.max(1,Math.min(7,octaveBase+delta));
    document.getElementById('sy-oct-display').textContent='C'+octaveBase;
    drawKeyboard(new Set());
}
function cyclePreset(dir) {
    const all = [...(PRESETS[currentCat]||[]), ...(loadCustomPresets()[currentCat]||[])];
    if (!all.length) return;
    const base = currentPresetIdx < 0 ? 0 : currentPresetIdx;
    currentPresetIdx = (base + dir + all.length) % all.length;
    applyPreset(all[currentPresetIdx]); renderPresets();
}
function applyPreset(preset) {
    Object.assign(macroValues, preset.macros); renderMacros(); setStatus('preset: '+preset.name);
}

// ─── RENDER UI ───────────────────────────────────────────────────────────────
function renderMacros() {
    const container=document.getElementById('sy-macros');
    container.innerHTML='';
    for (const def of MACRO_DEFS) {
        const val=macroValues[def.key], pct=Math.round(val*100);
        const div=document.createElement('div'); div.className='sy-macro';
        div.innerHTML=`
            <div class="sy-macro-header">
                <span class="sy-macro-name">${def.label}</span>
                <span class="sy-macro-val" id="mv-${def.key}">${pct}</span>
            </div>
            <input type="range" class="sy-slider" min="0" max="1" step="0.01" value="${val}" data-key="${def.key}">
            <div class="sy-macro-labels"><span>${def.lo}</span><span>${def.hi}</span></div>`;
        container.appendChild(div);
        div.querySelector('input').addEventListener('input', function() {
            macroValues[this.dataset.key]=parseFloat(this.value);
            document.getElementById('mv-'+this.dataset.key).textContent=Math.round(this.value*100);
            currentPresetIdx=-1;
        });
    }
}

// ─── CUSTOM PRESETS (localStorage) ───────────────────────────────────────────
const STORAGE_KEY = 'synth_custom_presets';

function loadCustomPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch(e) { return {}; }
}

function saveCustomPreset() {
    const input = document.getElementById('sy-preset-name');
    const name  = input.value.trim().toUpperCase();
    if (!name) { input.focus(); return; }
    const all = loadCustomPresets();
    if (!all[currentCat]) all[currentCat] = [];
    // overwrite if same name exists in this category
    const existing = all[currentCat].findIndex(p => p.name === name);
    const entry = { name, desc: 'custom', macros: { ...macroValues }, custom: true };
    if (existing >= 0) all[currentCat][existing] = entry;
    else all[currentCat].push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    input.value = '';
    setStatus('salvo: ' + name);
    renderPresets();
}

function deleteCustomPreset(name) {
    const all = loadCustomPresets();
    if (!all[currentCat]) return;
    all[currentCat] = all[currentCat].filter(p => p.name !== name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    if (currentPresetIdx >= PRESETS[currentCat].length) currentPresetIdx = -1;
    renderPresets();
}

function renderPresets() {
    const container = document.getElementById('sy-presets');
    container.innerHTML = '';

    const factory  = PRESETS[currentCat] || [];
    const customs  = (loadCustomPresets()[currentCat] || []);
    const allPresets = [...factory, ...customs];

    allPresets.forEach((p, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'sy-preset-custom';
        wrap.style.position = 'relative';

        const btn = document.createElement('button');
        btn.className = 'sy-preset';
        btn.style.width = '100%';
        if (i === currentPresetIdx) { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--text)'; }

        const tag = p.custom ? `<span class="sy-preset-tag">✦</span>` : '';
        btn.innerHTML = `<span>${p.name}${tag}</span><span class="sy-preset-desc">${p.desc}</span>`;
        btn.addEventListener('click', () => { currentPresetIdx = i; applyPreset(p); renderPresets(); });
        wrap.appendChild(btn);

        if (p.custom) {
            const del = document.createElement('button');
            del.className = 'sy-preset-del';
            del.textContent = '×';
            del.title = 'deletar preset';
            del.addEventListener('click', e => { e.stopPropagation(); deleteCustomPreset(p.name); });
            wrap.appendChild(del);
        }

        container.appendChild(wrap);
    });
}

function selectCat(cat) {
    currentCat=cat; currentPresetIdx=0;
    document.querySelectorAll('.sy-cat').forEach(b=>b.classList.toggle('active',b.dataset.cat===cat));
    applyPreset(PRESETS[cat][0]); renderPresets(); stopAll(); showLoopCanvas(false);
}

function selectMode(mode) {
    currentMode=mode;
    document.querySelectorAll('.sy-mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    stopAll(); showLoopCanvas(false);
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('.sy-cat').forEach(btn=>btn.addEventListener('click',()=>selectCat(btn.dataset.cat)));
    document.querySelectorAll('.sy-mode').forEach(btn=>btn.addEventListener('click',()=>selectMode(btn.dataset.mode)));
    document.getElementById('sy-vol').addEventListener('input', function() {
        if (masterGain) masterGain.gain.value=parseFloat(this.value);
    });
    renderMacros();
    renderPresets();
    drawKeyboard(new Set());
    initKBEvents();
    startWaveformAnim();
    setStatus('pronto · space=tocar · A-J=notas · [/]=preset');
});
