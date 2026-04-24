// ── CONSTANTS ─────────────────────────────────────────────────────
const WIN          = 32768;  // ~0.74 s @ 44100 Hz  — long window for chord context
const HOP          = 8192;   // hop size
const SMOOTH_R     = 3;      // smoothing radius (frames each side)
const MIN_CHORD_S  = 0.5;    // minimum chord duration (seconds)

// piano roll note detection (separate, shorter windows for time resolution)
const WIN_NOTE  = 4096;   // ~93 ms @ 44100 Hz
const HOP_NOTE  = 512;    // ~11.6 ms — fine time resolution
const MIDI_LO   = 36;     // C2  (practical bass/sub-bass floor)
const MIDI_HI   = 84;     // C6  (above this is mostly harmonics)
const PR_KEY_W  = 36;     // px for piano keys on left of roll

const CHR_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHR_COLORS = ['#c04848','#c06848','#c09038','#a09838','#60a840','#38a860',
                    '#38a898','#3880c0','#3860c8','#6040c8','#9040c8','#c040a0'];

// keyboard: C3 (midi 48) → B4 (midi 71) = 2 octaves
const KB_START = 48;
const KB_END   = 71;
const SEMI_IS_BLACK  = [false,true,false,true,false,false,true,false,true,false,true,false];
const SEMI_WHITE_IDX = [0,-1,1,-1,2,3,-1,4,-1,5,-1,6];
const BLACK_X_OFF    = {1:0.65, 3:1.65, 6:3.65, 8:4.65, 10:5.65};

// ── STATE ─────────────────────────────────────────────────────────
let audioBuf         = null;
let audioCtx         = null;
let masterGain       = null;
let srcNode          = null;
let playStart        = 0;
let playOffset       = 0;
let playing          = false;
let rafId            = null;
let wfPeaks          = null;
let result           = null;
let keyRects         = [];
let tuningCorrection = 0;   // cents applied to srcNode.detune (0 = original)
let scaleRoot        = -1;  // -1 = auto from result.key, 0-11 = manual root
let scaleMode        = 'auto'; // 'auto' or a key from SCALES

// piano roll viewport
let prViewX0 = 0;        // visible start time (s)
let prViewX1 = null;     // visible end time (null = full duration)
let prViewY0 = MIDI_LO;  // visible bottom MIDI
let prViewY1 = MIDI_HI;  // visible top MIDI

// ── AUDIO CONTEXT ─────────────────────────────────────────────────
function getCtx() {
    if (!audioCtx) {
        audioCtx   = new AudioContext();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.9;
        masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// ── FILE LOADING ──────────────────────────────────────────────────
async function loadFile(file) {
    const ac = getCtx();
    document.getElementById('az-filename').textContent = file.name;
    setStatus('decodificando...');
    const ab = await file.arrayBuffer();
    audioBuf = await ac.decodeAudioData(ab);
    wfPeaks  = buildPeaks(audioBuf, 2000);
    result           = null;
    tuningCorrection = 0;
    prViewX0 = 0; prViewX1 = null; prViewY0 = MIDI_LO; prViewY1 = MIDI_HI;
    enableControls(true);
    shrinkDropzone(file.name);
    drawWaveform(0);
    updateTimeDisplay(0);
    drawKeyboard([]);
    document.getElementById('az-kb-wrap').style.display = 'flex';
    setStatus('');
    runAnalysis();
}

function shrinkDropzone(name) {
    const dz = document.getElementById('az-dropzone');
    dz.classList.add('loaded');
    dz.querySelector('.az-drop-text').innerHTML = `<span>${name}</span>`;
}

function enableControls(on) {
    ['az-btn-play','az-btn-stop','az-btn-analyze','az-btn-export'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !on;
    });
}

// ── PLAYBACK ──────────────────────────────────────────────────────
function play(fromOffset) {
    const ac = getCtx();
    if (playing) stopPlayback();
    if (fromOffset === undefined) fromOffset = playOffset;
    fromOffset = Math.max(0, Math.min(fromOffset, audioBuf.duration));

    srcNode = ac.createBufferSource();
    srcNode.buffer = audioBuf;
    srcNode.detune.value = tuningCorrection;
    srcNode.connect(masterGain);
    srcNode.start(0, fromOffset);
    srcNode.onended = () => { if (playing) stopPlayback(); };

    playStart  = ac.currentTime - fromOffset;
    playOffset = fromOffset;
    playing    = true;
    const btn  = document.getElementById('az-btn-play');
    btn.textContent = '■ STOP'; btn.classList.add('active');
    startRaf();
}

function stopPlayback() {
    if (srcNode) { try { srcNode.stop(); } catch(_) {} srcNode = null; }
    playOffset = playing ? currentTime() : playOffset;
    playing    = false;
    const btn  = document.getElementById('az-btn-play');
    btn.textContent = '▶ PLAY'; btn.classList.remove('active');
    stopRaf();
    const t = playOffset;
    drawWaveform(t); updateTimeDisplay(t); drawKeyboard(pcsAtTime(t));
    if (result && result.notes) drawPianoRoll(result.notes, result.duration, t);
}

function currentTime() {
    if (!audioBuf) return 0;
    if (!playing)  return Math.min(playOffset, audioBuf.duration);
    return Math.min(audioCtx.currentTime - playStart, audioBuf.duration);
}

function seekTo(t) {
    playOffset = t;
    if (playing) play(t);
    else {
        drawWaveform(t); updateTimeDisplay(t); drawKeyboard(pcsAtTime(t));
        if (result && result.notes) drawPianoRoll(result.notes, result.duration, t);
    }
}

// ── RAF LOOP ──────────────────────────────────────────────────────
function startRaf() {
    if (rafId) return;
    function tick() {
        const t = currentTime();
        drawWaveform(t);
        updateTimeDisplay(t);
        drawKeyboard(pcsAtTime(t));
        if (result && result.notes) drawPianoRoll(result.notes, result.duration, t);
        if (playing) rafId = requestAnimationFrame(tick);
        else rafId = null;
    }
    rafId = requestAnimationFrame(tick);
}
function stopRaf() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

// ── TIME DISPLAY ──────────────────────────────────────────────────
function fmt(s) {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toFixed(1).padStart(4,'0')}`;
}
function updateTimeDisplay(t) {
    const dur = audioBuf ? audioBuf.duration : 0;
    document.getElementById('az-time').textContent = `${fmt(t)} / ${fmt(dur)}`;
}

// ── WAVEFORM ──────────────────────────────────────────────────────
function buildPeaks(buf, bins) {
    const data = buf.getChannelData(0), total = data.length;
    const size = Math.ceil(total / bins);
    const mins = new Float32Array(bins), maxs = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
        let mn = Infinity, mx = -Infinity;
        for (let i = b*size, e = Math.min(i+size,total); i < e; i++) {
            if (data[i] < mn) mn = data[i];
            if (data[i] > mx) mx = data[i];
        }
        mins[b] = mn === Infinity ? 0 : mn;
        maxs[b] = mx === -Infinity ? 0 : mx;
    }
    return { mins, maxs, bins };
}

function drawWaveform(playheadT) {
    const canvas = document.getElementById('az-waveform');
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, W, H);
    if (!wfPeaks) return;
    const { mins, maxs, bins } = wfPeaks, mid = H / 2;

    // chord color strip at bottom (14px)
    if (result && audioBuf) {
        const stripH = 14, dur = audioBuf.duration;
        for (const { start, end, chord } of result.chords) {
            if (chord.root < 0) continue;
            ctx.fillStyle = CHR_COLORS[chord.root] + '99';
            ctx.fillRect(start/dur*W, H-stripH, (end-start)/dur*W, stripH);
        }
    }

    // waveform bars
    ctx.strokeStyle = '#3878c8'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let b = 0; b < bins; b++) {
        const x = b / bins * W;
        ctx.moveTo(x, mid - maxs[b]*mid*0.9);
        ctx.lineTo(x, mid - mins[b]*mid*0.9);
    }
    ctx.stroke();

    // center line
    ctx.strokeStyle = '#1a2a3a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,mid); ctx.lineTo(W,mid); ctx.stroke();

    // playhead
    if (audioBuf && playheadT !== undefined) {
        const px = playheadT / audioBuf.duration * W;
        ctx.strokeStyle = '#e8e040'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,H); ctx.stroke();
    }
}

// ── FFT ───────────────────────────────────────────────────────────
function fft(re, im) {
    const n = re.length;
    for (let i=1,j=0; i<n; i++) {
        let bit = n>>1;
        for (; j&bit; bit>>=1) j^=bit;
        j^=bit;
        if (i<j) {
            let t=re[i]; re[i]=re[j]; re[j]=t;
            t=im[i]; im[i]=im[j]; im[j]=t;
        }
    }
    for (let len=2; len<=n; len<<=1) {
        const ang=-2*Math.PI/len, half=len>>1;
        const wRe=Math.cos(ang), wIm=Math.sin(ang);
        for (let i=0; i<n; i+=len) {
            let cRe=1, cIm=0;
            for (let j=0; j<half; j++) {
                const uRe=re[i+j], uIm=im[i+j];
                const vRe=re[i+j+half]*cRe-im[i+j+half]*cIm;
                const vIm=re[i+j+half]*cIm+im[i+j+half]*cRe;
                re[i+j]=uRe+vRe; im[i+j]=uIm+vIm;
                re[i+j+half]=uRe-vRe; im[i+j+half]=uIm-vIm;
                const nc=cRe*wRe-cIm*wIm;
                cIm=cRe*wIm+cIm*wRe; cRe=nc;
            }
        }
    }
}

// Chroma for CHORD detection: weight peaks at ~500 Hz, fades above 2000 Hz
// This suppresses high melody notes that bias individual windows
function chromaFromFFT(re, im, sr) {
    const n = re.length, out = new Float32Array(12);
    for (let k=1; k<n>>1; k++) {
        const freq = k * sr / n;
        if (freq < 60 || freq > 3500) continue;
        const mag2 = re[k]*re[k] + im[k]*im[k];
        const w = freq < 500 ? freq/500 : freq > 2000 ? 2000/freq : 1.0;
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        out[((midi%12)+12)%12] += mag2 * w;
    }
    return out;
}

// Chroma for KEY detection: unweighted, full range — same as the original
// algorithm so the tonality result is stable across different runs
function chromaForKey(re, im, sr) {
    const n = re.length, out = new Float32Array(12);
    for (let k=1; k<n>>1; k++) {
        const freq = k * sr / n;
        if (freq < 27.5 || freq > 4200) continue;
        const mag2 = re[k]*re[k] + im[k]*im[k];
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        out[((midi%12)+12)%12] += mag2;
    }
    return out;
}

// ── CHORD TEMPLATES ───────────────────────────────────────────────
const CHORD_TMPLS = (() => {
    const t = [];
    for (let r=0; r<12; r++) {
        for (const [suf, offs] of [
            ['',    [0,4,7]],    ['m',   [0,3,7]],
            ['7',   [0,4,7,10]],['m7',  [0,3,7,10]],
            ['maj7',[0,4,7,11]],['sus4',[0,5,7]],
            ['sus2',[0,2,7]],   ['dim', [0,3,6]],
            ['aug', [0,4,8]],
        ]) {
            const vec = new Float32Array(12);
            offs.forEach(o => { vec[(r+o)%12]=1; });
            t.push({ name: CHR_NAMES[r]+suf, root: r, vec, n: offs.length });
        }
    }
    return t;
})();

function bestChord(chroma) {
    const sum = chroma.reduce((a,b)=>a+b, 0);
    if (sum < 1e-12) return { name:'—', root:-1, conf:0 };
    const c = chroma.map(v=>v/sum);
    let best = { name:'—', root:-1, conf:0 };
    for (const { name, root, vec, n } of CHORD_TMPLS) {
        let dot = 0;
        for (let i=0; i<12; i++) dot += c[i]*vec[i]/n;
        if (dot > best.conf) best = { name, root, conf: dot };
    }
    return best;
}

function chordToPCs(chord) {
    if (!chord || chord.root < 0) return [];
    const t = CHORD_TMPLS.find(t => t.name === chord.name);
    return t ? Array.from(t.vec).map((v,i)=>v>0?i:-1).filter(i=>i>=0) : [];
}

// ── SCALES ────────────────────────────────────────────────────────
const SCALES = {
    major:            [0,2,4,5,7,9,11],
    minor:            [0,2,3,5,7,8,10],
    dorian:           [0,2,3,5,7,9,10],
    mixolydian:       [0,2,4,5,7,9,10],
    pentatonic_major: [0,2,4,7,9],
    pentatonic_minor: [0,3,5,7,10],
    blues:            [0,3,5,6,7,10],
};

function getActiveScalePCs() {
    const root = scaleRoot >= 0 ? scaleRoot : (result && result.key ? result.key.root : -1);
    const mode = scaleMode !== 'auto' ? scaleMode
               : (result && result.key ? result.key.mode : null);
    if (root < 0 || !mode || !SCALES[mode]) return null;
    return SCALES[mode].map(i => (root + i) % 12);
}

// ── KEY DETECTION (Krumhansl-Schmuckler) ─────────────────────────
const KS_MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KS_MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

function detectKey(total) {
    const sum = total.reduce((a,b)=>a+b, 0);
    if (sum < 1e-12) return null;
    const c = total.map(v=>v/sum);
    const mn = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
    const cM = mn(c);
    const cS = Math.sqrt(c.reduce((a,v)=>a+(v-cM)**2,0)/12);
    if (cS < 1e-12) return null;
    const mM=mn(KS_MAJOR), mN=mn(KS_MINOR);
    const sM=Math.sqrt(KS_MAJOR.reduce((a,v)=>a+(v-mM)**2,0)/12);
    const sN=Math.sqrt(KS_MINOR.reduce((a,v)=>a+(v-mN)**2,0)/12);
    let best = { score:-Infinity, root:0, mode:'major' };
    for (let root=0; root<12; root++) {
        for (const [mode,prof,m,s] of [['major',KS_MAJOR,mM,sM],['minor',KS_MINOR,mN,sN]]) {
            let r = 0;
            for (let i=0; i<12; i++) r += (c[i]-cM)*(prof[(i-root+12)%12]-m);
            r /= (12*cS*s+1e-12);
            if (r > best.score) best = { score:r, root, mode };
        }
    }
    return best;
}

// ── TUNING DETECTION ──────────────────────────────────────────────
function detectTuning(buf) {
    const data = buf.getChannelData(0);
    const sr   = buf.sampleRate;
    const WN   = 2048;
    const nFrames = 40;
    const hop  = Math.max(WN, Math.floor(data.length / nFrames));
    // Melodic range 150–900 Hz
    const minLag = Math.floor(sr / 900);
    const maxLag = Math.floor(sr / 150);
    const winLen = WN - maxLag;
    if (winLen < 64) return null;

    const offsets = [];
    for (let off=0; off+WN<=data.length; off+=hop) {
        let rms = 0;
        for (let i=0; i<WN; i++) rms += data[off+i]**2;
        rms = Math.sqrt(rms/WN);
        if (rms < 0.015) continue;

        let bestLag=-1, bestCorr=-Infinity;
        for (let tau=minLag; tau<=maxLag; tau++) {
            let c=0;
            for (let i=0; i<winLen; i++) c += data[off+i]*data[off+i+tau];
            if (c>bestCorr) { bestCorr=c; bestLag=tau; }
        }
        if (bestLag<0 || bestCorr < rms*rms*winLen*0.05) continue;

        const freq = sr / bestLag;
        const midi = 69 + 12*Math.log2(freq/440);
        const nearest = Math.round(midi);
        const nearestFreq = 440*Math.pow(2,(nearest-69)/12);
        const cents = 1200*Math.log2(freq/nearestFreq);
        if (Math.abs(cents) < 48) offsets.push(cents);
    }
    if (offsets.length < 4) return null;
    offsets.sort((a,b)=>a-b);
    const med = offsets[Math.floor(offsets.length/2)];
    const a4hz = 440 * Math.pow(2, med/1200);
    return { cents: Math.round(med), a4hz: a4hz.toFixed(1), n: offsets.length };
}

// ── CHORD SMOOTHING ───────────────────────────────────────────────
function smoothFrames(frames, r) {
    return frames.map((f, i) => {
        const win = frames.slice(Math.max(0,i-r), i+r+1);
        const cnt = {};
        win.forEach(w => { cnt[w.chord.name] = (cnt[w.chord.name]||0) + 1; });
        const best = Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0][0];
        const src  = win.find(w => w.chord.name === best);
        return { ...f, chord: src.chord };
    });
}

function mergeChords(regions, minDur) {
    // Collapse identical consecutive chords
    const out = [];
    for (const c of regions) {
        if (out.length && out[out.length-1].chord.name === c.chord.name)
            out[out.length-1].end = c.end;
        else out.push({...c});
    }
    // Absorb short chords into longer neighbor (3 passes)
    for (let pass=0; pass<3; pass++) {
        for (let i=0; i<out.length; i++) {
            if (out[i].end - out[i].start >= minDur || out.length <= 1) continue;
            if (i === 0) { out[1].start = out[0].start; out.splice(0,1); i--; }
            else if (i === out.length-1) { out[i-1].end = out[i].end; out.splice(i,1); i--; }
            else {
                const lD = out[i-1].end-out[i-1].start, rD = out[i+1].end-out[i+1].start;
                if (lD >= rD) out[i-1].end = out[i].end; else out[i+1].start = out[i].start;
                out.splice(i,1); i--;
            }
        }
    }
    // Final collapse
    const final = [];
    for (const c of out) {
        if (final.length && final[final.length-1].chord.name === c.chord.name)
            final[final.length-1].end = c.end;
        else final.push({...c});
    }
    return final;
}

// ── ANALYSIS ──────────────────────────────────────────────────────
function runAnalysis() {
    if (!audioBuf) return;
    document.getElementById('az-analyzing').style.display = 'block';
    document.getElementById('az-results').innerHTML = '';
    setTimeout(() => {
        try {
            result = analyze(audioBuf);
            result.notes = analyzeNotes(audioBuf);
            renderResults(result);
            updateScaleSelectors();
            const t = currentTime();
            drawWaveform(t);
            drawKeyboard(pcsAtTime(t));
            const prWrap = document.getElementById('az-pr-wrap');
            prWrap.style.display = 'flex';
            drawPianoRoll(result.notes, result.duration, t);
        } catch(e) {
            console.error('analysis error:', e);
            setStatus('erro na análise');
        }
        document.getElementById('az-analyzing').style.display = 'none';
    }, 20);
}

function analyze(buf) {
    const data   = buf.getChannelData(0);
    const sr     = buf.sampleRate;
    const cap    = Math.min(data.length, sr*120);
    const totalChord = new Float32Array(12);  // weighted  → chord detection
    const totalKey   = new Float32Array(12);  // unweighted → key detection
    const rawFrames  = [];
    const re     = new Float32Array(WIN);
    const im     = new Float32Array(WIN);
    const hann   = Float32Array.from({length:WIN}, (_,i)=>0.5*(1-Math.cos(2*Math.PI*i/(WIN-1))));

    for (let off=0; off+WIN<=cap; off+=HOP) {
        for (let i=0; i<WIN; i++) { re[i]=data[off+i]*hann[i]; im[i]=0; }
        fft(re, im);
        const ch    = chromaFromFFT(re, im, sr);
        const chKey = chromaForKey(re, im, sr);
        for (let i=0; i<12; i++) { totalChord[i] += ch[i]; totalKey[i] += chKey[i]; }
        rawFrames.push({ time:(off+WIN/2)/sr, chord:bestChord(ch) });
    }

    const smoothed = smoothFrames(rawFrames, SMOOTH_R);
    // alias for harmonic calculation — use unweighted total
    const total = totalKey;
    const dur = data.length / sr;
    const dt  = HOP / sr;

    const regions = [];
    for (const { time, chord } of smoothed) {
        if (regions.length && regions[regions.length-1].chord.name === chord.name)
            regions[regions.length-1].end = Math.min(dur, time+dt/2);
        else
            regions.push({ start:Math.max(0,time-dt/2), end:Math.min(dur,time+dt/2), chord });
    }

    const chords = mergeChords(regions, MIN_CHORD_S);
    const key    = detectKey(totalKey);      // unweighted chroma
    const tuning = detectTuning(buf);

    const cMax = Math.max(...totalKey), cMin = Math.min(...totalKey);
    const harmonic = cMax > 0 ? (cMax-cMin)/cMax : 0;

    const tally = {};
    for (const { start, end, chord } of chords) {
        if (chord.root < 0) continue;
        tally[chord.name] = (tally[chord.name]||0) + (end-start);
    }
    const tallySorted = Object.entries(tally)
        .map(([name,secs]) => ({ name, pct:Math.round(secs/dur*100) }))
        .sort((a,b)=>b.pct-a.pct).slice(0,10);

    return { key, chords, total, harmonic, duration:dur, tallySorted, tuning };
}

// ── CHORD AT PLAYHEAD ─────────────────────────────────────────────
function pcsAtTime(t) {
    if (!result) return [];
    const c = result.chords.find(c => t >= c.start && t < c.end);
    return c ? chordToPCs(c.chord) : [];
}

// ── KEYBOARD ─────────────────────────────────────────────────────
function buildKeyRects(W, H) {
    const wW = W / 14, bW = wW*0.62, bH = H*0.60;
    const keys = [];
    let wi = 0;
    // white keys
    for (let midi=KB_START; midi<=KB_END; midi++) {
        const semi = (midi-KB_START)%12;
        if (!SEMI_IS_BLACK[semi]) {
            keys.push({ midi, pc:midi%12, x:wi*wW, y:0, w:wW-1, h:H, isBlack:false });
            wi++;
        }
    }
    // black keys (on top)
    for (let midi=KB_START; midi<=KB_END; midi++) {
        const semi = (midi-KB_START)%12;
        if (SEMI_IS_BLACK[semi]) {
            const oct = Math.floor((midi-KB_START)/12);
            const x   = (oct*7 + BLACK_X_OFF[semi]) * wW - bW/2;
            keys.push({ midi, pc:midi%12, x, y:0, w:bW, h:bH, isBlack:true });
        }
    }
    return keys;
}

function drawKeyboard(activePCs=[]) {
    const canvas = document.getElementById('az-kb');
    if (!canvas) return;
    const W = canvas.offsetWidth || 600;
    const H = canvas.offsetHeight || 110;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, W, H);
    keyRects = buildKeyRects(W, H);

    // ── white keys ──
    for (const k of keyRects) {
        if (k.isBlack) continue;
        const active = activePCs.includes(k.pc);

        // body
        ctx.fillStyle = active ? CHR_COLORS[k.pc] + 'bb' : '#ece8e0';
        ctx.fillRect(k.x, k.y, k.w, k.h);

        // pitch-class color stripe at top (always present, brighter when active)
        ctx.fillStyle = active ? CHR_COLORS[k.pc] : CHR_COLORS[k.pc] + '40';
        ctx.fillRect(k.x + 1, k.y + 1, k.w - 2, 6);

        // border
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
        ctx.strokeRect(k.x, k.y, k.w, k.h);

        // note label (note name + octave)
        const noteOct = CHR_NAMES[k.pc] + (Math.floor(k.midi / 12) - 1);
        const fs = Math.max(10, Math.floor(k.w * 0.38));
        ctx.fillStyle = active ? '#fff' : '#1a1a1a';
        ctx.font = `bold ${fs}px Courier New`;
        ctx.textAlign = 'center';
        ctx.fillText(noteOct, k.x + k.w / 2, k.h - 7);
    }

    // ── black keys (drawn on top) ──
    for (const k of keyRects) {
        if (!k.isBlack) continue;
        const active = activePCs.includes(k.pc);

        ctx.fillStyle = active ? CHR_COLORS[k.pc] + 'ee' : '#1e1e1e';
        ctx.fillRect(k.x, k.y, k.w, k.h);
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
        ctx.strokeRect(k.x, k.y, k.w, k.h);

        // always show note name, dim when inactive
        const fs = Math.max(7, Math.floor(k.w * 0.38));
        ctx.fillStyle = active ? '#fff' : '#666';
        ctx.font = `${fs}px Courier New`;
        ctx.textAlign = 'center';
        ctx.fillText(CHR_NAMES[k.pc], k.x + k.w / 2, k.h - 5);
    }
}

function hitKey(x, y) {
    // black keys on top
    for (const k of keyRects) {
        if (k.isBlack && x>=k.x && x<=k.x+k.w && y>=k.y && y<=k.y+k.h) return k;
    }
    for (const k of keyRects) {
        if (!k.isBlack && x>=k.x && x<=k.x+k.w && y>=k.y && y<=k.y+k.h) return k;
    }
    return null;
}

function playMidiNote(midi) {
    const ac   = getCtx();
    const freq = 440 * Math.pow(2, (midi-69)/12);
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.35, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+1.2);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(ac.currentTime); osc.stop(ac.currentTime+1.2);
}

// ── RENDER RESULTS ────────────────────────────────────────────────
function pilRoot(name) {
    let ri=-1;
    for (let i=0; i<CHR_NAMES.length; i++) {
        if (name.startsWith(CHR_NAMES[i]) && CHR_NAMES[i].length>(ri>=0?CHR_NAMES[ri].length:0)) ri=i;
    }
    return ri;
}

function renderChordTimeline(chords, duration) {
    const tlH = chords.map(({ start, end, chord }) => {
        const l = (start/duration*100).toFixed(2);
        const w = Math.max(0.5,(end-start)/duration*100).toFixed(2);
        const col = chord.root>=0 ? CHR_COLORS[chord.root] : '#181818';
        return `<div class="az-chord-block"
            style="left:${l}%;width:${w}%;background:${col}"
            data-start="${start.toFixed(3)}"
            title="${chord.name}  ${start.toFixed(2)}s – ${end.toFixed(2)}s">
            <span>${chord.name}</span></div>`;
    }).join('');
    document.getElementById('az-chord-timeline').innerHTML = tlH;
    const n = chords.filter(c=>c.chord.root>=0).length;
    document.getElementById('az-chord-hint').textContent =
        `${duration.toFixed(2)}s total · ${n} acorde${n!==1?'s':''} detectado${n!==1?'s':''}`;
    document.getElementById('az-chord-timeline-wrap').style.display = 'flex';
}

function renderResults(r) {
    const { key, chords, total, harmonic, duration, tallySorted, tuning } = r;
    const keyName = key ? `${CHR_NAMES[key.root]} ${key.mode==='major'?'major':'minor'}` : '—';
    const confPct = key ? Math.round(Math.max(0,Math.min(1,key.score))*100) : 0;

    renderChordTimeline(chords, duration);

    // tuning
    let tuningH = '';
    if (tuning) {
        const c   = tuning.cents;
        const col = Math.abs(c) <= 8 ? '#50d050' : Math.abs(c) <= 20 ? '#e0c040' : '#e05050';
        const label = Math.abs(c) <= 8 ? 'afinado'
                    : c < 0 ? `${Math.abs(c)}¢ bemol` : `${c}¢ sustenido`;
        const pct = Math.round(50 + c * 0.9);
        const corrCents = -c;   // detune to apply for A440 correction
        tuningH = `
        <div class="az-section">
            <div class="az-section-label">AFINAÇÃO</div>
            <div class="az-tune-row">
                <span class="az-tune-val" style="color:${col}">A4 = ${tuning.a4hz} Hz</span>
                <span class="az-tune-val" style="color:${col};font-size:9px">${c>=0?'+':''}${c}¢ &nbsp;${label}</span>
            </div>
            <div class="az-tune-meter">
                <div class="az-tune-center"></div>
                <div class="az-tune-needle" style="left:${pct}%;background:${col}"></div>
                <span class="az-tune-l">−50¢</span><span class="az-tune-r">+50¢</span>
            </div>
            <div class="az-tune-btns">
                <button id="az-btn-tune-440" onclick="azSetTuning(${corrCents})" title="Corrigir pitch para A4 = 440 Hz">↑ A=440 Hz</button>
                <button id="az-btn-tune-orig" onclick="azSetTuning(0)" title="Reproduzir no pitch original">ORIGINAL</button>
            </div>
        </div>`;
    }

    // tally
    const pillsH = tallySorted.map(({ name, pct }) => {
        const ri = pilRoot(name);
        return `<div class="az-pill">
            <div class="az-pill-dot" style="background:${ri>=0?CHR_COLORS[ri]:'#555'}"></div>
            <span class="az-pill-name">${name}</span>
            <span class="az-pill-pct">${pct}%</span>
        </div>`;
    }).join('');

    // chroma
    const cMax = Math.max(...total);
    const chromaH = Array.from(total).map((v,i) => {
        const pct = cMax>0 ? Math.round(v/cMax*100) : 0;
        return `<div class="az-chr-col">
            <div class="az-chr-bar" style="height:${pct}%;background:${CHR_COLORS[i]}"></div>
            <div class="az-chr-lbl">${CHR_NAMES[i]}</div>
        </div>`;
    }).join('');

    const warnH = harmonic<0.2
        ? `<div class="az-warn">▲ percussivo — análise de tom incerta</div>` : '';

    document.getElementById('az-results').innerHTML = `
        <div id="az-key-row">
            <span id="az-key-name">${keyName}</span>
            <span id="az-key-conf">${harmonic>=0.2 ? confPct+'% conf.' : '—'}</span>
            ${warnH}
        </div>
        ${tuningH}
        <div class="az-section">
            <div class="az-section-label">ACORDES DOMINANTES</div>
            <div id="az-tally">${pillsH||'<span style="color:#333">—</span>'}</div>
        </div>
        <div class="az-section">
            <div class="az-section-label">CHROMA</div>
            <div id="az-chroma">${chromaH}</div>
        </div>
    `;
    // sync button active state after DOM is set
    if (tuning) window.azSetTuning(tuningCorrection);
}

// ── TUNING CORRECTION ─────────────────────────────────────────────
window.azSetTuning = function(cents) {
    tuningCorrection = cents;
    // update button active state
    const b440  = document.getElementById('az-btn-tune-440');
    const bOrig = document.getElementById('az-btn-tune-orig');
    if (b440)  b440.classList.toggle('active',  cents !== 0);
    if (bOrig) bOrig.classList.toggle('active', cents === 0);
    // if currently playing, restart with new detune (seamless pitch shift)
    if (playing && audioBuf) { const t = currentTime(); play(t); }
};

// ── PIANO ROLL VIEWPORT ───────────────────────────────────────────
function redrawPR() {
    const t = currentTime();
    if (result && result.notes) drawPianoRoll(result.notes, result.duration, t);
}

function resetPRView() {
    prViewX0 = 0; prViewX1 = null;
    prViewY0 = MIDI_LO; prViewY1 = MIDI_HI;
    redrawPR();
}

function zoomTimeAt(mouseRollX, rollW, delta) {
    if (!result) return;
    const dur  = result.duration;
    const vx1  = prViewX1 !== null ? prViewX1 : dur;
    const vDur = vx1 - prViewX0;
    const mouseT = prViewX0 + Math.max(0, mouseRollX) / rollW * vDur;
    const factor  = delta > 0 ? 1.3 : 1 / 1.3;
    const newVDur = Math.min(dur, Math.max(0.25, vDur * factor));
    const ratio   = Math.max(0, Math.min(1, mouseRollX / rollW));
    prViewX0 = Math.max(0, mouseT - ratio * newVDur);
    prViewX1 = Math.min(dur, prViewX0 + newVDur);
    if (prViewX0 <= 0.001 && prViewX1 >= dur - 0.001) prViewX1 = null;
}

function zoomPitchAt(mouseY, H, delta) {
    const totalRange = MIDI_HI - MIDI_LO + 1;
    const vRange  = prViewY1 - prViewY0 + 1;
    const factor  = delta > 0 ? 1.3 : 1 / 1.3;
    const newRange = Math.min(totalRange, Math.max(4, Math.round(vRange * factor)));
    const ratio   = Math.max(0, Math.min(1, 1 - mouseY / H));  // 0=bottom, 1=top
    const midMidi = prViewY0 + ratio * vRange;
    prViewY0 = Math.max(MIDI_LO, Math.round(midMidi - ratio * newRange));
    prViewY1 = Math.min(MIDI_HI, prViewY0 + newRange - 1);
    if (prViewY1 === MIDI_HI) prViewY0 = Math.max(MIDI_LO, MIDI_HI - newRange + 1);
}

// ── SCALE SELECTOR SYNC ───────────────────────────────────────────
function updateScaleSelectors() {
    const rootSel = document.getElementById('az-scale-root');
    const modeSel = document.getElementById('az-scale-mode');
    if (rootSel) rootSel.value = String(scaleRoot);
    if (modeSel) modeSel.value = scaleMode;
}

// ── WAV EXPORT ────────────────────────────────────────────────────
function encodeWAV(buf) {
    const nCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
    const blockAlign = nCh * 2, dataSize = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const v  = new DataView(ab);
    const ws = (off, s) => { for (let i=0; i<s.length; i++) v.setUint8(off+i, s.charCodeAt(i)); };
    ws(0,'RIFF'); v.setUint32(4, 36+dataSize, true);
    ws(8,'WAVE'); ws(12,'fmt ');
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,nCh,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*blockAlign,true);
    v.setUint16(32,blockAlign,true); v.setUint16(34,16,true);
    ws(36,'data'); v.setUint32(40,dataSize,true);
    let off = 44;
    for (let i=0; i<len; i++) for (let ch=0; ch<nCh; ch++) {
        const s = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i]));
        v.setInt16(off, s < 0 ? s*0x8000 : s*0x7FFF, true); off += 2;
    }
    return ab;
}

async function exportTuned() {
    if (!audioBuf) return;
    const btn = document.getElementById('az-btn-export');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ exportando...'; }
    try {
        const nCh = audioBuf.numberOfChannels;
        const offCtx = new OfflineAudioContext(nCh, audioBuf.length, audioBuf.sampleRate);
        const src = offCtx.createBufferSource();
        src.buffer = audioBuf;
        src.detune.value = tuningCorrection;
        src.connect(offCtx.destination);
        src.start(0);
        const rendered = await offCtx.startRendering();
        const blob = new Blob([encodeWAV(rendered)], { type: 'audio/wav' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const base = (document.getElementById('az-filename').textContent || 'sample').replace(/\.[^.]+$/, '');
        const suf  = tuningCorrection ? `_${tuningCorrection>0?'+':''}${tuningCorrection}c` : '';
        a.href = url; a.download = `${base}${suf}.wav`; a.click();
        URL.revokeObjectURL(url);
    } catch(e) { console.error('export error:', e); setStatus('erro ao exportar'); }
    if (btn) { btn.disabled = false; btn.textContent = '↓ EXPORTAR WAV'; }
}

// ── NOTE DETECTION (piano roll) ───────────────────────────────────

function analyzeNotes(buf) {
    const data = buf.getChannelData(0);
    const sr   = buf.sampleRate;
    const cap  = Math.min(data.length, sr * 120);

    const re   = new Float32Array(WIN_NOTE);
    const im   = new Float32Array(WIN_NOTE);
    const hann = Float32Array.from({length:WIN_NOTE}, (_,i) => 0.5*(1-Math.cos(2*Math.PI*i/(WIN_NOTE-1))));

    const kLo = Math.max(1, Math.floor(MIDI_LO_FREQ(sr) * WIN_NOTE / sr));
    const kHi = Math.min((WIN_NOTE>>1)-1, Math.ceil(7000 * WIN_NOTE / sr));

    const active = {};   // midi -> start time
    const events = [];

    for (let off = 0; off + WIN_NOTE <= cap; off += HOP_NOTE) {
        for (let i=0; i<WIN_NOTE; i++) { re[i]=data[off+i]*hann[i]; im[i]=0; }
        fft(re, im);

        const half = WIN_NOTE >> 1;
        const mag  = new Float32Array(half);
        for (let k=1; k<half; k++) mag[k] = Math.sqrt(re[k]*re[k]+im[k]*im[k]);

        // adaptive noise floor
        let sum=0, cnt=0;
        for (let k=kLo; k<=kHi; k++) { sum+=mag[k]; cnt++; }
        const floor = cnt > 0 ? sum/cnt : 0;
        const thresh = floor * 8;

        const time = (off + WIN_NOTE/2) / sr;
        const now  = new Set();

        // collect local maxima above threshold
        const peaks = [];
        for (let k=kLo+1; k<kHi-1; k++) {
            if (mag[k]>mag[k-1] && mag[k]>mag[k+1] && mag[k]>thresh) {
                // parabolic interpolation for sub-bin accuracy
                const alpha=mag[k-1], beta=mag[k], gamma=mag[k+1];
                const d = alpha-2*beta+gamma < -1e-10 ? 0.5*(alpha-gamma)/(alpha-2*beta+gamma) : 0;
                const kf  = k + d;
                const freq = kf * sr / WIN_NOTE;
                if (freq < 25 || freq > 7000) continue;
                const midi = 69 + 12*Math.log2(freq/440);
                if (midi < MIDI_LO-0.5 || midi > MIDI_HI+0.5) continue;
                peaks.push({ freq, midi, mag: beta });
            }
        }

        // sort strongest first, suppress harmonics
        peaks.sort((a,b) => b.mag-a.mag);
        const sel = [];
        for (const p of peaks) {
            let harm = false;
            for (const s of sel) {
                const r = p.freq / s.freq;
                for (let n=2; n<=10; n++) {
                    if (Math.abs(1200*Math.log2(r/n)) < 60) { harm=true; break; } // within 60 cents
                }
                if (harm) break;
            }
            if (!harm) { sel.push(p); if (sel.length>=5) break; }
        }

        for (const p of sel) now.add(Math.round(p.midi));

        // close inactive notes
        for (const [ms, st] of Object.entries(active)) {
            if (!now.has(parseInt(ms))) {
                const dur = time - st;
                if (dur >= 0.060) events.push({ midi:parseInt(ms), start:st, end:time });
                delete active[ms];
            }
        }
        // open new notes
        for (const m of now) {
            if (!(m in active)) active[m] = time;
        }
    }

    // flush remaining
    const endT = cap / sr;
    for (const [ms, st] of Object.entries(active)) {
        const dur = endT - st;
        if (dur >= 0.060) events.push({ midi:parseInt(ms), start:st, end:endT });
    }

    return events;
}

function MIDI_LO_FREQ(sr) {
    return 440 * Math.pow(2, (MIDI_LO - 69) / 12);
}

// ── PIANO ROLL DRAWING ────────────────────────────────────────────

function drawPianoRoll(notes, duration, playheadT) {
    const canvas = document.getElementById('az-pianoroll');
    if (!canvas) return;
    const W = canvas.offsetWidth || 800;
    const H = canvas.offsetHeight || 220;
    canvas.width = W; canvas.height = H;
    const ctx    = canvas.getContext('2d');
    const rollW  = W - PR_KEY_W;

    // ── viewport ──
    const vx0    = prViewX0;
    const vx1    = prViewX1 !== null ? prViewX1 : duration;
    const vy0    = prViewY0;
    const vy1    = prViewY1;
    const vDur   = Math.max(0.001, vx1 - vx0);
    const vRange = vy1 - vy0 + 1;
    const rowH   = H / vRange;
    const scalePCs = getActiveScalePCs();

    const toX = t    => PR_KEY_W + (t - vx0) / vDur * rollW;
    const toY = midi => H - (midi - vy0 + 1) * rowH;

    // background
    ctx.fillStyle = '#070707'; ctx.fillRect(0, 0, W, H);

    // ── row backgrounds ──
    for (let midi = vy0; midi <= vy1; midi++) {
        const semi  = midi % 12;
        const isBlk = SEMI_IS_BLACK[semi];
        const y     = toY(midi);

        let rowColor;
        if (scalePCs) {
            rowColor = scalePCs.includes(semi)
                ? (isBlk ? '#1a1a1a' : '#222222')
                : '#080808';
        } else {
            rowColor = isBlk ? '#0d0d0d' : null;
        }
        if (rowColor) { ctx.fillStyle = rowColor; ctx.fillRect(PR_KEY_W, y, rollW, rowH); }

        if (semi === 0) {
            ctx.strokeStyle = scalePCs ? '#2a2a2a' : '#1e1e1e'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PR_KEY_W, y + rowH); ctx.lineTo(W, y + rowH); ctx.stroke();
        }
    }

    // ── adaptive time grid ──
    const secInt = vDur < 2 ? 0.25 : vDur < 8 ? 0.5 : vDur < 30 ? 1 : vDur < 120 ? 5 : 10;
    ctx.strokeStyle = '#181818'; ctx.lineWidth = 1;
    const t0grid = Math.ceil(vx0 / secInt) * secInt;
    for (let t = t0grid; t <= vx1 + 0.001; t += secInt) {
        const x = toX(t);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        const lbl = t < 60 ? (t % 1 === 0 ? t + 's' : t.toFixed(2) + 's')
                            : `${Math.floor(t/60)}:${String(Math.round(t%60)).padStart(2,'0')}`;
        ctx.fillStyle = '#2a2a2a'; ctx.font = '8px Courier New'; ctx.textAlign = 'left';
        ctx.fillText(lbl, x + 2, H - 3);
    }

    // ── note bars ──
    for (const note of notes) {
        if (note.midi < vy0 || note.midi > vy1) continue;
        if (note.end < vx0 || note.start > vx1) continue;
        const xs  = toX(Math.max(note.start, vx0));
        const xe  = toX(Math.min(note.end, vx1));
        const nw  = Math.max(2, xe - xs);
        const y   = toY(note.midi);
        const rh  = Math.max(1.5, rowH - 0.5);
        const col = CHR_COLORS[note.midi % 12];
        ctx.fillStyle = col + 'bb'; ctx.fillRect(xs, y + 0.5, nw, rh);
        ctx.fillStyle = '#ffffff55'; ctx.fillRect(xs, y + 0.5, Math.min(2.5, nw), rh);
    }

    // ── piano key column ──
    for (let midi = vy0; midi <= vy1; midi++) {
        const semi  = midi % 12;
        const isBlk = SEMI_IS_BLACK[semi];
        const oct   = Math.floor(midi / 12) - 1;
        const y     = toY(midi);
        const rh    = Math.max(0.5, rowH - 0.5);

        ctx.fillStyle = isBlk ? '#141414' : '#cccac2';
        ctx.fillRect(0, y + 0.5, PR_KEY_W - 1, rh);

        const fs = Math.min(9, Math.max(5.5, rowH * 0.78));
        if (rowH >= 5.5) {
            ctx.fillStyle = semi === 0 ? '#e8e040' : (isBlk ? '#555' : '#666');
            ctx.font = `${semi === 0 ? 'bold ' : ''}${fs}px Courier New`;
            ctx.textAlign = 'left';
            ctx.fillText(`${CHR_NAMES[semi]}${oct}`, 2, y + rh * 0.82);
        } else if (semi === 0) {
            ctx.fillStyle = '#e8e040';
            ctx.font = `bold ${Math.max(5, rowH)}px Courier New`;
            ctx.textAlign = 'left';
            ctx.fillText(`C${oct}`, 2, y + rh * 0.82);
        }
    }

    // ── playhead ──
    if (playheadT !== undefined && playheadT >= vx0 && playheadT <= vx1 && duration > 0) {
        const px = toX(playheadT);
        ctx.strokeStyle = '#e8e040'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    }
}

// ── STATUS ────────────────────────────────────────────────────────
function setStatus(msg) { document.getElementById('az-status').textContent = msg; }

// ── INIT ──────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    const canvas    = document.getElementById('az-waveform');
    const dropzone  = document.getElementById('az-dropzone');
    const fileInput = document.getElementById('az-file-input');
    const btnPlay   = document.getElementById('az-btn-play');
    const btnStop   = document.getElementById('az-btn-stop');
    const btnAna    = document.getElementById('az-btn-analyze');
    const volSlider = document.getElementById('az-vol');
    const kbCanvas  = document.getElementById('az-kb');

    drawWaveform();
    drawKeyboard([]);

    // chord timeline click (permanent delegation — renderResults no longer attaches this)
    document.getElementById('az-chord-timeline').addEventListener('click', e => {
        const b = e.target.closest('.az-chord-block');
        if (b) seekTo(parseFloat(b.dataset.start));
    });

    // keyboard shortcuts
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        switch (e.key) {
            case ' ':
                e.preventDefault();
                if (!audioBuf) return;
                getCtx(); playing ? stopPlayback() : play();
                break;
            case 'Escape':
                e.preventDefault();
                stopPlayback(); playOffset = 0; seekTo(0);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (!audioBuf) return;
                seekTo(Math.max(0, currentTime() - (e.shiftKey ? 10 : 2)));
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (!audioBuf) return;
                seekTo(Math.min(audioBuf.duration, currentTime() + (e.shiftKey ? 10 : 2)));
                break;
            case 'r': case 'R':
                if (audioBuf) runAnalysis();
                break;
            case 'o': case 'O':
                document.getElementById('az-file-input').click();
                break;
        }
    });

    window.addEventListener('resize', () => {
        const t = currentTime();
        drawWaveform(t);
        drawKeyboard(pcsAtTime(t));
        if (result && result.notes) drawPianoRoll(result.notes, result.duration, t);
    });

    // drag & drop
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault(); dropzone.classList.remove('drag-over');
        const f = e.dataTransfer.files[0]; if (f) loadFile(f);
    });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

    // playback
    btnPlay.addEventListener('click', () => { getCtx(); playing ? stopPlayback() : play(); });
    btnStop.addEventListener('click', () => { stopPlayback(); playOffset=0; seekTo(0); });

    // waveform seek
    canvas.addEventListener('click', e => {
        if (!audioBuf) return;
        const x = e.clientX - canvas.getBoundingClientRect().left;
        seekTo(x / canvas.offsetWidth * audioBuf.duration);
    });

    // volume
    volSlider.addEventListener('input', e => {
        if (masterGain) masterGain.gain.value = parseInt(e.target.value)/100;
    });

    // re-analyze
    btnAna.addEventListener('click', runAnalysis);

    // export WAV
    document.getElementById('az-btn-export').addEventListener('click', exportTuned);

    // scale selectors
    ['az-scale-root', 'az-scale-mode'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            scaleRoot = parseInt(document.getElementById('az-scale-root').value);
            scaleMode = document.getElementById('az-scale-mode').value;
            const t = currentTime();
            if (result && result.notes) drawPianoRoll(result.notes, result.duration, t);
        });
    });

    // ── piano roll interactions: zoom, pan, seek ──
    (function() {
        const prCanvas = document.getElementById('az-pianoroll');
        let dragging = false, dragMoved = false;
        let dragX0 = 0, dragY0 = 0;
        let savedVx0, savedVx1, savedVy0, savedVy1;

        // scroll = horizontal zoom · ctrl/shift+scroll = vertical zoom
        prCanvas.addEventListener('wheel', e => {
            e.preventDefault();
            if (!result) return;
            const rect = prCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left - PR_KEY_W;
            const my = e.clientY - rect.top;
            if (e.ctrlKey || e.shiftKey) zoomPitchAt(my, prCanvas.offsetHeight, e.deltaY);
            else                          zoomTimeAt(mx, prCanvas.offsetWidth - PR_KEY_W, e.deltaY);
            redrawPR();
        }, { passive: false });

        // drag = pan
        prCanvas.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            dragging = true; dragMoved = false;
            dragX0 = e.clientX; dragY0 = e.clientY;
            savedVx0 = prViewX0; savedVx1 = prViewX1;
            savedVy0 = prViewY0; savedVy1 = prViewY1;
            e.preventDefault();
        });

        window.addEventListener('mousemove', e => {
            if (!dragging || !result) return;
            const dx = e.clientX - dragX0, dy = e.clientY - dragY0;
            if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
            if (!dragMoved) return;

            const dur  = result.duration;
            const rW   = prCanvas.offsetWidth - PR_KEY_W;
            const rH   = prCanvas.offsetHeight;
            const vx1s = savedVx1 !== null ? savedVx1 : dur;
            const vDur = vx1s - savedVx0;
            const vRng = savedVy1 - savedVy0 + 1;

            // horizontal pan
            const dtSec = -dx / rW * vDur;
            const nx0   = Math.max(0, Math.min(savedVx0 + dtSec, dur - vDur));
            prViewX0    = nx0;
            prViewX1    = Math.min(dur, nx0 + vDur);

            // vertical pan (drag up = higher pitches)
            const dMidi = -dy / rH * vRng;
            const ny0   = Math.round(Math.max(MIDI_LO, Math.min(savedVy0 + dMidi, MIDI_HI - vRng + 1)));
            prViewY0    = ny0;
            prViewY1    = Math.min(MIDI_HI, ny0 + vRng - 1);

            redrawPR();
        });

        window.addEventListener('mouseup', () => { dragging = false; });

        // click = seek (only when not dragging)
        prCanvas.addEventListener('click', e => {
            if (!audioBuf || !result || dragMoved) return;
            const rect = prCanvas.getBoundingClientRect();
            const x    = e.clientX - rect.left - PR_KEY_W;
            if (x < 0) return;
            const rW  = prCanvas.offsetWidth - PR_KEY_W;
            const vx1 = prViewX1 !== null ? prViewX1 : result.duration;
            seekTo(Math.max(0, prViewX0 + (x / rW) * (vx1 - prViewX0)));
        });

        // double-click = reset view
        prCanvas.addEventListener('dblclick', resetPRView);
    })();

    // keyboard: click to play note
    kbCanvas.addEventListener('click', e => {
        getCtx();
        const rect = kbCanvas.getBoundingClientRect();
        const k = hitKey(e.clientX-rect.left, e.clientY-rect.top);
        if (k) {
            playMidiNote(k.midi);
            // flash highlight
            const pcs = pcsAtTime(currentTime());
            const combined = [...new Set([...pcs, k.pc])];
            drawKeyboard(combined);
            setTimeout(() => drawKeyboard(pcsAtTime(currentTime())), 600);
        }
    });
});
