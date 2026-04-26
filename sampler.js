'use strict';

const SERVER = 'http://127.0.0.1:7270';

// ─── STATE ───────────────────────────────────────────────────────────────────
let audioBuf   = null;
let peaks      = null;
let duration   = 0;
let sampleRate = 44100;

let selStart   = 0;       // seconds
let selEnd     = null;    // null = not set yet (means full)

let viewStart  = 0;
let viewEnd    = null;    // null = full

let tuningCents = 0;
let detectedNote = null;  // { freq, midi, name, cents }

let ac         = null;
let srcNode    = null;
let gainNode   = null;
let isPlaying  = false;
let isLooping  = false;
let playStart  = 0;       // ac.currentTime when play started
let playOffset = 0;       // seconds into audio

let rafId      = null;

// Waveform drag state
let dragMode    = null; // 'new'|'left'|'right'|'move'|'pan'|'overview'
let dragStartX  = null;
let dragSelSnap = null;
let dragViewSnap = null;
let isPanning   = false;

// Seek cursor (play position marker on ruler)
let seekPos      = null;   // seconds; null = start of selection
let rulerDragging = false;

// ─── CLIPS (tab system) ──────────────────────────────────────────────────────
let clips = [];         // [{ name, audioBuf, peaks, selStart, selEnd, viewStart, viewEnd, seekPos, tuningCents, detectedNote }]
let activeClipIdx = -1;

// BPM / Grid
let bpm        = null;
let beatOffset = 0;
let gridSnap   = false;
let snapBeats  = 1;
let tapTimes   = [];

// ─── CLIPS ───────────────────────────────────────────────────────────────────

function saveClipState() {
    if (activeClipIdx < 0 || !clips[activeClipIdx]) return;
    const c = clips[activeClipIdx];
    c.audioBuf    = audioBuf;
    c.peaks       = peaks;
    c.selStart    = selStart;
    c.selEnd      = selEnd;
    c.viewStart   = viewStart;
    c.viewEnd     = viewEnd;
    c.seekPos     = seekPos;
    c.tuningCents = tuningCents;
    c.detectedNote = detectedNote;
}

function loadClipState(idx) {
    const c = clips[idx];
    if (!c) return;
    stopPlay();
    audioBuf     = c.audioBuf;
    peaks        = c.peaks;
    duration     = audioBuf.duration;
    sampleRate   = audioBuf.sampleRate;
    selStart     = c.selStart;
    selEnd       = c.selEnd;
    viewStart    = c.viewStart;
    viewEnd      = c.viewEnd;
    seekPos      = c.seekPos;
    tuningCents  = c.tuningCents;
    detectedNote = c.detectedNote;
    activeClipIdx = idx;

    document.getElementById('sm-tune-slider').value = tuningCents;
    document.getElementById('sm-tune-val').textContent = (tuningCents >= 0 ? '+' : '') + tuningCents + '¢';

    if (detectedNote) {
        const sign = detectedNote.cents >= 0 ? '+' : '';
        document.getElementById('sm-note-big').textContent    = detectedNote.name;
        document.getElementById('sm-note-freq').textContent   = detectedNote.freq.toFixed(2) + ' Hz';
        document.getElementById('sm-note-cents').textContent  = sign + detectedNote.cents + ' cents';
        document.getElementById('sm-pitch-bar').style.left    = Math.max(2, Math.min(98, 50 + detectedNote.cents)) + '%';
        document.getElementById('sm-btn-autotune').disabled   = false;
    } else {
        document.getElementById('sm-note-big').textContent    = '--';
        document.getElementById('sm-note-freq').textContent   = '-- Hz';
        document.getElementById('sm-note-cents').textContent  = '-- cents';
        document.getElementById('sm-pitch-bar').style.left    = '50%';
        document.getElementById('sm-btn-autotune').disabled   = true;
    }

    updateSelInfo();
    redraw();
}

function switchClip(idx) {
    if (idx === activeClipIdx) return;
    saveClipState();
    loadClipState(idx);
    renderTabs();
}

function deleteClip(idx) {
    if (idx <= 0 || idx >= clips.length) return;
    clips.splice(idx, 1);
    const newIdx = Math.min(activeClipIdx, clips.length - 1);
    activeClipIdx = -1; // force reload
    loadClipState(newIdx);
    renderTabs();
}

function createCutFromSelection() {
    if (!audioBuf) return;
    const ss = selStart ?? 0;
    const se = selEnd ?? duration;
    if (se - ss < 0.001) { setStatus('seleção muito curta para cortar'); return; }

    const ctx = getAC();
    const sr  = audioBuf.sampleRate;
    const s0  = Math.floor(ss * sr);
    const s1  = Math.ceil(se * sr);
    const len = Math.max(1, s1 - s0);
    const ch  = audioBuf.numberOfChannels;
    const newBuf = ctx.createBuffer(ch, len, sr);
    for (let c = 0; c < ch; c++)
        newBuf.getChannelData(c).set(audioBuf.getChannelData(c).subarray(s0, s1));

    const cutNum = clips.filter((_, i) => i > 0).length + 1;
    const newClip = {
        name:        'Corte ' + cutNum,
        audioBuf:    newBuf,
        peaks:       computePeaks(newBuf, 4000),
        selStart:    0,
        selEnd:      newBuf.duration,
        viewStart:   0,
        viewEnd:     null,
        seekPos:     null,
        tuningCents: 0,
        detectedNote: null
    };

    saveClipState();
    clips.push(newClip);
    activeClipIdx = clips.length - 1;
    loadClipState(activeClipIdx);
    renderTabs();
    setStatus('corte criado: ' + newClip.name + ' (' + fmtTime(newBuf.duration) + ')');
}

function renderTabs() {
    const bar = document.getElementById('sm-tabs');
    if (!bar) return;
    bar.innerHTML = '';

    clips.forEach((c, i) => {
        const tab = document.createElement('button');
        tab.className = 'sm-tab' + (i === activeClipIdx ? ' active' : '');
        tab.onclick = () => switchClip(i);

        const label = document.createTextNode(c.name);
        tab.appendChild(label);

        if (i > 0) {
            const x = document.createElement('span');
            x.className = 'sm-tab-x';
            x.textContent = '×';
            x.title = 'fechar';
            x.onclick = (e) => { e.stopPropagation(); deleteClip(i); };
            tab.appendChild(x);
        }

        bar.appendChild(tab);
    });

    const cutBtn = document.createElement('button');
    cutBtn.id = 'sm-btn-cut';
    cutBtn.textContent = '✂  CORTAR SELEÇÃO';
    cutBtn.disabled = !audioBuf;
    cutBtn.onclick = createCutFromSelection;
    bar.appendChild(cutBtn);
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    pingServer();
    setInterval(pingServer, 5000);

    const canvas = document.getElementById('sm-waveform');
    canvas.addEventListener('mousedown',  onWaveMouseDown);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove',  onWaveMouseMove);
    window.addEventListener('mouseup',    onWaveMouseUp);
    canvas.addEventListener('wheel',      onWaveWheel, { passive: false });
    canvas.addEventListener('dblclick',   () => { selStart = 0; selEnd = duration; updateSelInfo(); redraw(); });

    // Ruler: click/drag to set seek position
    const ruler = document.getElementById('sm-ruler');
    ruler.style.cursor = 'col-resize';
    ruler.addEventListener('mousedown', onRulerMouseDown);

    // overview interaction
    const ov = document.getElementById('sm-overview');
    ov.addEventListener('mousedown', onOverviewMouseDown);
    ov.addEventListener('dblclick',  onOverviewDblClick);
    ov.addEventListener('contextmenu', e => e.preventDefault());

    document.getElementById('sm-file-input').addEventListener('change', e => {
        if (e.target.files[0]) loadFile(e.target.files[0]);
    });

    const drop = document.getElementById('sm-drop');
    drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('over');
        const f = e.dataTransfer.files[0];
        if (f) loadFile(f);
    });

    document.getElementById('sm-vol').addEventListener('input', function() {
        if (gainNode) gainNode.gain.value = parseFloat(this.value);
    });

    document.getElementById('sm-url').addEventListener('keydown', e => {
        if (e.key === 'Enter') fetchYoutube();
    });

    // ── atalhos de teclado ───────────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT') return;

        if (e.code === 'Space') {
            e.preventDefault(); togglePlay(); return;
        }
        if (e.key === 'Escape') { stopPlay(); return; }
        if (e.key === 'l' || e.key === 'L') { toggleLoop(); return; }
        if (e.key === 'b' || e.key === 'B') { if (audioBuf) detectBPM(); return; }
        if (e.key === 'g' || e.key === 'G') { toggleSnap(); return; }

        // Ctrl+A = selecionar tudo
        if (e.ctrlKey && e.key === 'a') {
            e.preventDefault();
            if (audioBuf) { selStart = 0; selEnd = duration; updateSelInfo(); redraw(); }
            return;
        }

        // [ ] = nudge seleção ±10ms
        if (e.key === '[' && audioBuf) {
            const d = e.shiftKey ? 1 : 0.01;
            selStart = Math.max(0, (selStart??0) - d);
            selEnd   = Math.max(selStart + 0.001, (selEnd??duration) - d);
            updateSelInfo(); redraw(); return;
        }
        if (e.key === ']' && audioBuf) {
            const d = e.shiftKey ? 1 : 0.01;
            selEnd   = Math.min(duration, (selEnd??duration) + d);
            selStart = Math.min(selEnd - 0.001, (selStart??0) + d);
            updateSelInfo(); redraw(); return;
        }

        // , . = encolher/expandir seleção
        if (e.key === ',' && audioBuf && selEnd !== null) {
            selEnd = Math.max((selStart??0) + 0.001, selEnd - (e.shiftKey ? 1 : 0.01));
            updateSelInfo(); redraw(); return;
        }
        if (e.key === '.' && audioBuf && selEnd !== null) {
            selEnd = Math.min(duration, selEnd + (e.shiftKey ? 1 : 0.01));
            updateSelInfo(); redraw(); return;
        }

        // E = exportar
        if (e.key === 'e' && audioBuf) { exportWAV(); return; }
        if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey) { createCutFromSelection(); return; }
        if ((e.key === 'm' || e.key === 'M') && audioBuf)  { prepareForMidi(); return; }

        // + - = zoom
        if (e.key === '+' || e.key === '=') { zoom(0.5); return; }
        if (e.key === '-')                   { zoom(2);   return; }
        if (e.key === '0')                   { resetView(); return; }
    });

    redraw();
    startRAF();
});

// ─── SERVER PING ─────────────────────────────────────────────────────────────
async function pingServer() {
    try {
        const r = await fetch(SERVER + '/ping', { signal: AbortSignal.timeout(2000) });
        const ok = r.ok;
        document.getElementById('sm-srv-dot').className   = ok ? 'on' : 'off';
        document.getElementById('sm-srv-label').textContent = ok ? 'SERVIDOR ON' : 'SERVIDOR OFF';
        document.getElementById('sm-srv-info').style.display = ok ? 'none' : 'block';
    } catch {
        document.getElementById('sm-srv-dot').className   = 'off';
        document.getElementById('sm-srv-label').textContent = 'SERVIDOR OFF';
        document.getElementById('sm-srv-info').style.display = 'block';
    }
}

// ─── LOAD FILE ───────────────────────────────────────────────────────────────
function getAC() {
    if (!ac || ac.state === 'closed') {
        ac = new AudioContext();
        gainNode = ac.createGain();
        gainNode.gain.value = parseFloat(document.getElementById('sm-vol').value);
        gainNode.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
}

async function loadFile(file) {
    setStatus('carregando ' + file.name + '...');
    const ctx = getAC();
    const ab  = await file.arrayBuffer();
    audioBuf  = await ctx.decodeAudioData(ab);
    onAudioLoaded(file.name);
}

async function loadArrayBuffer(ab, name) {
    const ctx = getAC();
    audioBuf  = await ctx.decodeAudioData(ab);
    onAudioLoaded(name);
}

function onAudioLoaded(name) {
    stopPlay();
    duration   = audioBuf.duration;
    sampleRate = audioBuf.sampleRate;
    selStart   = 0;
    selEnd     = duration;
    viewStart  = 0;
    viewEnd    = null;
    seekPos    = null;
    detectedNote = null;
    tuningCents  = 0;

    peaks = computePeaks(audioBuf, 4000);

    // Initialize clips system with original audio
    clips = [{
        name: name,
        audioBuf,
        peaks,
        selStart: 0,
        selEnd: duration,
        viewStart: 0,
        viewEnd: null,
        seekPos: null,
        tuningCents: 0,
        detectedNote: null
    }];
    activeClipIdx = 0;
    renderTabs();

    document.getElementById('sm-filename').textContent = name;
    document.getElementById('sm-wave-info').textContent =
        (sampleRate / 1000).toFixed(1) + ' kHz · ' + (audioBuf.length > 0 ? '32' : '--') + ' bit float';

    const drop = document.getElementById('sm-drop');
    drop.classList.add('loaded');
    drop.querySelector('.sm-drop-text').textContent = name;

    enableControls(true);
    updateSelInfo();
    redraw();
    setStatus('pronto — ' + fmtTime(duration));
}

function computePeaks(buf, width) {
    const ch   = buf.numberOfChannels;
    const data = [];
    for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    const len  = buf.length;
    const step = Math.max(1, Math.floor(len / width));
    const out  = [];
    for (let i = 0; i < width; i++) {
        let mn = 1, mx = -1;
        const s = i * step, e = Math.min(s + step, len);
        for (let j = s; j < e; j++) {
            for (let c = 0; c < ch; c++) {
                const v = data[c][j];
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
        }
        out.push([mn, mx]);
    }
    return out;
}

// ─── YOUTUBE FETCH ───────────────────────────────────────────────────────────
async function fetchYoutube() {
    const url = document.getElementById('sm-url').value.trim();
    if (!url) return;

    const srv = document.getElementById('sm-srv-dot').className;
    if (srv !== 'on') {
        setStatus('servidor offline — abra iniciar_sampler.bat primeiro');
        return;
    }

    const btn = document.getElementById('sm-btn-fetch');
    btn.textContent = '...'; btn.classList.add('loading'); btn.disabled = true;
    showProgress(10);
    setStatus('baixando áudio do YouTube...');

    try {
        showProgress(30);
        const res = await fetch(`${SERVER}/download?url=${encodeURIComponent(url)}`);
        showProgress(70);

        if (!res.ok) {
            const j = await res.json().catch(() => ({ error: 'erro desconhecido' }));
            throw new Error(j.error || 'erro ao baixar');
        }

        showProgress(85);
        const ab = await res.arrayBuffer();
        showProgress(95);

        const name = url.replace(/.*[?&v=]([^&]+).*/,'yt_$1').slice(0,40) + '.webm';
        await loadArrayBuffer(ab.slice(0), name);
        document.getElementById('sm-url').value = '';
        showProgress(100);
        setTimeout(() => showProgress(0), 800);
    } catch(e) {
        setStatus('erro: ' + e.message);
        showProgress(0);
    } finally {
        btn.textContent = '↓'; btn.classList.remove('loading'); btn.disabled = false;
    }
}

function showProgress(pct) {
    const wrap = document.getElementById('sm-progress-wrap');
    const bar  = document.getElementById('sm-progress');
    wrap.style.display = pct > 0 ? 'block' : 'none';
    bar.style.width = pct + '%';
}

// ─── DRAW ────────────────────────────────────────────────────────────────────
const ORANGE   = '#e87020';
const SEL_FILL = 'rgba(232,112,32,0.13)';
const SEL_OUT  = 'rgba(0,0,0,0.55)';
const WAVE_IN  = '#4a8060';
const WAVE_OUT = '#1e3028';

function redraw() { drawRuler(); drawWaveform(); drawOverview(); }

// ── time ruler ──────────────────────────────────────────────────────────────
function drawRuler() {
    const canvas = document.getElementById('sm-ruler');
    if (!canvas) return;
    const W = canvas.offsetWidth || 800, H = 18;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);
    if (!audioBuf) return;

    const vS = viewStart, vE = viewEnd ?? duration, vDur = vE - vS;
    // pick grid interval
    const intervals = [0.01,0.05,0.1,0.25,0.5,1,2,5,10,30,60,120,300,600];
    const minPx = 60;
    const secPerPx = vDur / W;
    const interval = intervals.find(i => i / secPerPx >= minPx) ?? intervals[intervals.length-1];

    ctx.font = '9px Courier New'; ctx.fillStyle = '#444'; ctx.textAlign = 'left';
    const t0 = Math.ceil(vS / interval) * interval;
    for (let t = t0; t <= vE; t += interval) {
        const x = Math.round((t - vS) / vDur * W);
        ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, H-5); ctx.lineTo(x, H); ctx.stroke();
        ctx.fillStyle = '#555';
        ctx.fillText(fmtTime(t), x + 2, H - 5);
    }
    // beat markers in ruler
    if (bpm && audioBuf) {
        const beatPeriod = 60 / bpm;
        const beatPx = beatPeriod / secPerPx;
        if (beatPx >= 10) {
            const n0 = Math.ceil((vS - beatOffset) / beatPeriod);
            const n1 = Math.floor((vE - beatOffset) / beatPeriod);
            ctx.font = '8px Courier New'; ctx.textAlign = 'left';
            for (let n = n0; n <= n1; n++) {
                const bt = beatOffset + n * beatPeriod;
                const bx = Math.round((bt - vS) / vDur * W);
                const isMeasure = (((n % 4) + 4) % 4 === 0);
                ctx.strokeStyle = isMeasure ? 'rgba(232,112,32,0.55)' : 'rgba(255,255,255,0.15)';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, isMeasure ? H : 5); ctx.stroke();
                if (isMeasure && beatPx >= 22) {
                    ctx.fillStyle = 'rgba(232,112,32,0.7)';
                    ctx.fillText(String(Math.floor(n / 4) + 1), bx + 2, 8);
                }
            }
        }
    }

    // playhead / seek cursor on ruler
    if (audioBuf) {
        if (isPlaying) {
            // orange moving playhead while playing
            const pt = currentTime();
            if (pt >= vS && pt <= vE) {
                const px = Math.round((pt - vS) / vDur * W);
                ctx.fillStyle = ORANGE;
                ctx.fillRect(px - 0.5, 0, 1.5, H);
                ctx.beginPath(); ctx.moveTo(px-4,0); ctx.lineTo(px+4,0); ctx.lineTo(px,6); ctx.closePath(); ctx.fill();
            }
        } else {
            // white seek triangle (draggable) when stopped
            const sp = seekPos ?? selStart ?? 0;
            if (sp >= vS && sp <= vE) {
                const px = Math.round((sp - vS) / vDur * W);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(px - 0.5, 0, 1, H);
                ctx.beginPath(); ctx.moveTo(px-5,0); ctx.lineTo(px+5,0); ctx.lineTo(px,7); ctx.closePath(); ctx.fill();
            }
        }
    }
}

// ── main waveform ────────────────────────────────────────────────────────────
function drawWaveform() {
    const canvas = document.getElementById('sm-waveform');
    const W = canvas.offsetWidth || 800, H = 140;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, W, H);

    if (!audioBuf || !peaks) {
        ctx.fillStyle = '#1c1c1c'; ctx.font = '11px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('arraste um arquivo ou cole um link do YouTube', W/2, H/2);
        return;
    }

    const vS = viewStart, vE = viewEnd ?? duration, vDur = Math.max(0.001, vE - vS);
    const ss = selStart ?? 0, se = selEnd ?? duration;
    const sx = Math.round((ss - vS) / vDur * W);
    const ex = Math.round((se - vS) / vDur * W);

    // dim outside selection
    ctx.fillStyle = SEL_OUT;
    if (sx > 0) ctx.fillRect(0, 0, Math.max(0, sx), H);
    if (ex < W) ctx.fillRect(Math.min(W, ex), 0, W - ex, H);

    // center line
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

    // waveform bars
    for (let x = 0; x < W; x++) {
        const t0 = vS + (x / W) * vDur;
        const t1 = vS + ((x+1) / W) * vDur;
        const p0 = Math.max(0, Math.floor((t0 / duration) * peaks.length));
        const p1 = Math.min(peaks.length-1, Math.ceil((t1 / duration) * peaks.length));
        let mn = 0, mx = 0;
        for (let p = p0; p <= p1; p++) {
            if (peaks[p][0] < mn) mn = peaks[p][0];
            if (peaks[p][1] > mx) mx = peaks[p][1];
        }
        ctx.fillStyle = (x >= sx && x <= ex) ? WAVE_IN : WAVE_OUT;
        const yT = H/2 - mx * (H/2 - 2), yB = H/2 - mn * (H/2 - 2);
        ctx.fillRect(x, yT, 1, Math.max(1, yB - yT));
    }

    // selection tint
    ctx.fillStyle = SEL_FILL;
    ctx.fillRect(sx, 0, ex - sx, H);

    // beat grid
    if (bpm) {
        const beatPeriod = 60 / bpm;
        const beatPx = beatPeriod / vDur * W;
        if (snapBeats < 1 && beatPeriod * snapBeats / vDur * W >= 5)
            drawGridLines(ctx, W, H, vS, vE, vDur, beatPeriod * snapBeats, 'rgba(255,255,255,0.07)');
        if (beatPx >= 4)
            drawGridLines(ctx, W, H, vS, vE, vDur, beatPeriod, 'rgba(255,255,255,0.12)');
        drawGridLines(ctx, W, H, vS, vE, vDur, beatPeriod * 4, 'rgba(232,112,32,0.28)');
    }

    // handles
    drawHandle(ctx, sx, H, 'left');
    drawHandle(ctx, ex, H, 'right');

    // seek cursor line (white dashed, when stopped)
    if (!isPlaying && seekPos !== null) {
        const sp = seekPos;
        if (sp >= vS && sp <= vE) {
            const px = Math.round((sp - vS) / vDur * W);
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // playhead (orange, while playing)
    if (isPlaying) {
        const pt = currentTime();
        if (pt >= vS && pt <= vE) {
            const px = Math.round((pt - vS) / vDur * W);
            ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
        }
    }

    // pan hint when zoomed
    if (viewEnd !== null) {
        ctx.fillStyle = '#2a2a2a'; ctx.font = '9px Courier New'; ctx.textAlign = 'right';
        ctx.fillText('clique direito = pan · scroll = zoom · duplo clique = tudo', W-6, H-4);
    }
}

function drawHandle(ctx, x, H, side) {
    ctx.fillStyle = ORANGE;
    ctx.fillRect(x - 0.5, 0, 1.5, H);
    const w = 6;
    ctx.beginPath();
    if (side==='left')  { ctx.moveTo(x,0); ctx.lineTo(x+w*2,0); ctx.lineTo(x,w*2); }
    else                { ctx.moveTo(x,0); ctx.lineTo(x-w*2,0); ctx.lineTo(x,w*2); }
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    if (side==='left')  { ctx.moveTo(x,H); ctx.lineTo(x+w*2,H); ctx.lineTo(x,H-w*2); }
    else                { ctx.moveTo(x,H); ctx.lineTo(x-w*2,H); ctx.lineTo(x,H-w*2); }
    ctx.closePath(); ctx.fill();
}

// ── overview strip ───────────────────────────────────────────────────────────
function drawOverview() {
    const canvas = document.getElementById('sm-overview');
    if (!canvas) return;
    const W = canvas.offsetWidth || 800, H = 28;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
    if (!audioBuf || !peaks) return;

    // full waveform
    for (let x = 0; x < W; x++) {
        const p0 = Math.floor((x/W) * peaks.length);
        const p1 = Math.min(peaks.length-1, Math.ceil(((x+1)/W) * peaks.length));
        let mn=0, mx=0;
        for (let p=p0; p<=p1; p++) { if(peaks[p][0]<mn)mn=peaks[p][0]; if(peaks[p][1]>mx)mx=peaks[p][1]; }
        ctx.fillStyle = '#2a3a30';
        ctx.fillRect(x, H/2 - mx*(H/2-1), 1, Math.max(1, (mx-mn)*(H/2-1)));
    }

    // selection highlight
    const ss = selStart??0, se = selEnd??duration;
    const sx = Math.round(ss/duration*W), ex = Math.round(se/duration*W);
    ctx.fillStyle = 'rgba(232,112,32,0.2)';
    ctx.fillRect(sx, 0, ex-sx, H);
    ctx.strokeStyle = ORANGE; ctx.lineWidth = 1;
    ctx.strokeRect(sx+0.5, 0.5, ex-sx-1, H-1);

    // viewport box
    const vS = viewStart, vE = viewEnd ?? duration;
    if (viewEnd !== null) {
        const vx  = Math.round(vS/duration*W);
        const vex = Math.round(vE/duration*W);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(vx, 0, vex-vx, H);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
        ctx.strokeRect(vx+0.5, 0.5, vex-vx-1, H-1);
    }

    // hint
    ctx.fillStyle = '#282828'; ctx.font = '9px Courier New'; ctx.textAlign = 'right';
    ctx.fillText('duplo clique = zoom na região', W - 4, H - 3);
}

// ─── WAVEFORM INTERACTION ────────────────────────────────────────────────────
function timeToX(t, W, vStart, vEnd) {
    const vDur = Math.max(0.001, (vEnd ?? duration) - vStart);
    return Math.round((t - vStart) / vDur * W);
}
function xToTime(x, W) {
    const vS = viewStart, vE = viewEnd ?? duration;
    return vS + (x / W) * (vE - vS);
}
function clampTime(t) { return Math.max(0, Math.min(duration, t)); }

function getHandleX(which, W) {
    const t = which === 'left' ? (selStart ?? 0) : (selEnd ?? duration);
    return timeToX(t, W, viewStart, viewEnd ?? duration);
}

function showTooltip(t, ex, ey) {
    const tip = document.getElementById('sm-time-tooltip');
    tip.textContent = fmtTime(t);
    tip.style.display = 'block';
    tip.style.left = (ex + 12) + 'px';
    tip.style.top  = (ey - 20) + 'px';
}
function hideTooltip() { document.getElementById('sm-time-tooltip').style.display = 'none'; }

function onRulerMouseDown(e) {
    if (!audioBuf || e.button !== 0) return;
    e.preventDefault();
    rulerDragging = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    seekPos = clampTime(xToTime(x, rect.width));
    playOffset = seekPos;
    if (isPlaying) startPlay();
    else redraw();
}

function onWaveMouseDown(e) {
    if (!audioBuf) return;
    const canvas = document.getElementById('sm-waveform');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const W = rect.width;
    dragStartX = x;

    if (e.button === 2) {
        // right click = pan
        dragMode = 'pan';
        dragViewSnap = { start: viewStart, end: viewEnd ?? duration };
        canvas.style.cursor = 'grabbing';
        return;
    }

    const lx = getHandleX('left',  W);
    const rx = getHandleX('right', W);

    if (Math.abs(x - lx) <= 10) {
        dragMode = 'left';
    } else if (Math.abs(x - rx) <= 10) {
        dragMode = 'right';
    } else if (x > lx && x < rx) {
        dragMode = 'move';
        dragSelSnap = { start: selStart ?? 0, end: selEnd ?? duration };
    } else {
        dragMode = 'new';
        const t = snapToGrid(clampTime(xToTime(x, W)));
        selStart = t; selEnd = t;
        updateSelInfo(); redraw();
    }
}

function onWaveMouseMove(e) {
    if (!audioBuf) return;

    // Ruler drag: update seek position
    if (rulerDragging) {
        const ruler = document.getElementById('sm-ruler');
        const rect = ruler.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        seekPos = clampTime(xToTime(x, rect.width));
        playOffset = seekPos;
        if (isPlaying) startPlay();
        else redraw();
        return;
    }

    const canvas = document.getElementById('sm-waveform');
    const rect   = canvas.getBoundingClientRect();
    const x      = e.clientX - rect.left;
    const W      = rect.width;
    const t      = clampTime(xToTime(x, W));

    // update cursor style
    if (!dragMode) {
        const lx = getHandleX('left', W), rx = getHandleX('right', W);
        if (Math.abs(x-lx)<=10 || Math.abs(x-rx)<=10) canvas.style.cursor = 'ew-resize';
        else if (x > lx && x < rx) canvas.style.cursor = 'grab';
        else canvas.style.cursor = 'crosshair';
    }

    if (!dragMode) return;

    if (dragMode === 'pan') {
        const dx = xToTime(x, W) - xToTime(dragStartX, W);
        const vDur = dragViewSnap.end - dragViewSnap.start;
        viewStart = Math.max(0, dragViewSnap.start - dx);
        viewEnd   = Math.min(duration, viewStart + vDur);
        if (viewEnd >= duration) { viewEnd = duration; viewStart = duration - vDur; }
        redraw(); return;
    }

    const xC = Math.max(0, Math.min(W, x));
    const tc  = clampTime(xToTime(xC, W));
    const tcs = snapToGrid(tc);

    if (dragMode === 'new') {
        const anchor = snapToGrid(clampTime(xToTime(dragStartX, W)));
        selStart = Math.min(anchor, tcs);
        selEnd   = Math.max(anchor, tcs);
    } else if (dragMode === 'left') {
        selStart = Math.min(tcs, selEnd ?? duration);
    } else if (dragMode === 'right') {
        selEnd = Math.max(tcs, selStart ?? 0);
    } else if (dragMode === 'move') {
        const dx   = xToTime(xC, W) - xToTime(dragStartX, W);
        const span = dragSelSnap.end - dragSelSnap.start;
        const raw  = Math.max(0, Math.min(duration - span, dragSelSnap.start + dx));
        selStart = snapToGrid(raw);
        selEnd   = selStart + span;
    }

    showTooltip(dragMode === 'right' || dragMode === 'new' ? (selEnd??0) : (selStart??0), e.clientX, e.clientY);
    updateSelInfo(); redraw();
}

function onWaveMouseUp(e) {
    if (rulerDragging) { rulerDragging = false; return; }
    const canvas = document.getElementById('sm-waveform');
    canvas.style.cursor = 'crosshair';
    if (dragMode === 'new' && selStart !== null && selEnd !== null) {
        if (selEnd - selStart < 0.001) {
            if (gridSnap && bpm) selEnd = clampTime(selStart + (60 / bpm) * snapBeats);
            else { selStart = 0; selEnd = duration; }
        }
    }
    dragMode = null; dragSelSnap = null; dragViewSnap = null;
    hideTooltip();
    updateSelInfo(); redraw();
}

function onWaveWheel(e) {
    e.preventDefault();
    if (!audioBuf) return;
    const canvas = document.getElementById('sm-waveform');
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const W  = rect.width;

    if (e.shiftKey) {
        // shift+scroll = pan
        const vDur  = (viewEnd ?? duration) - viewStart;
        const shift = (e.deltaY > 0 ? 1 : -1) * vDur * 0.1;
        viewStart = Math.max(0, viewStart + shift);
        viewEnd   = Math.min(duration, viewStart + vDur);
        if (viewEnd >= duration * 0.999) { viewEnd = null; viewStart = Math.max(0, duration - vDur); }
    } else {
        // scroll = zoom centrado no cursor
        const tAtMouse = xToTime(mx, W);
        const factor = e.deltaY > 0 ? 1.25 : 1/1.25;
        const vS = viewStart, vE = viewEnd ?? duration;
        const lr = (tAtMouse - vS) / (vE - vS);
        const newDur = Math.min(duration, (vE - vS) * factor);
        viewStart = Math.max(0, tAtMouse - lr * newDur);
        viewEnd   = Math.min(duration, viewStart + newDur);
        if (viewEnd - viewStart >= duration * 0.999) { viewStart = 0; viewEnd = null; }
    }
    redraw();
}

function onOverviewMouseDown(e) {
    if (!audioBuf) return;
    e.preventDefault();
    const canvas = document.getElementById('sm-overview');
    const rect   = canvas.getBoundingClientRect();
    const W      = rect.width;
    const x0     = e.clientX - rect.left;
    const vS = viewStart, vE = viewEnd ?? duration;
    const vDur = vE - vS;

    const vx  = (vS / duration) * W;
    const vex = (vE / duration) * W;
    const inBox = viewEnd !== null && x0 >= vx - 4 && x0 <= vex + 4;

    if (!inBox) {
        const tClick = (x0 / W) * duration;
        viewStart = Math.max(0, tClick - vDur / 2);
        viewEnd   = Math.min(duration, viewStart + vDur);
        if (viewEnd - viewStart >= duration * 0.999) { viewStart = 0; viewEnd = null; }
        else if (viewEnd >= duration) { viewEnd = duration; viewStart = Math.max(0, duration - vDur); }
        redraw();
        return;
    }

    const snapStart = vS;
    dragMode = 'overview';

    function onMove(ev) {
        const cx = ev.clientX - rect.left;
        const dt = ((cx - x0) / W) * duration;
        viewStart = Math.max(0, snapStart + dt);
        viewEnd   = Math.min(duration, viewStart + vDur);
        if (viewEnd >= duration) { viewEnd = null; viewStart = Math.max(0, duration - vDur); }
        redraw();
    }
    function onUp() {
        dragMode = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup',   onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
}

function onOverviewDblClick(e) {
    if (!audioBuf) return;
    e.preventDefault();
    const canvas = document.getElementById('sm-overview');
    const rect   = canvas.getBoundingClientRect();
    const tClick = ((e.clientX - rect.left) / rect.width) * duration;

    // zoom to ~8 beats (if BPM known) or ~6 seconds around click point
    const windowSec = bpm ? Math.max(3, (60 / bpm) * 8) : 6;
    viewStart = Math.max(0, tClick - windowSec / 2);
    viewEnd   = Math.min(duration, viewStart + windowSec);
    if (viewEnd >= duration) { viewEnd = duration; viewStart = Math.max(0, duration - windowSec); }
    redraw();
}

function zoom(factor) {
    if (!audioBuf) return;
    const mid = ((viewStart + (viewEnd ?? duration)) / 2);
    const cur = (viewEnd ?? duration) - viewStart;
    const nd  = Math.min(duration, cur * factor);
    viewStart = Math.max(0, mid - nd/2);
    viewEnd   = Math.min(duration, mid + nd/2);
    if (viewEnd - viewStart >= duration * 0.999) { viewStart = 0; viewEnd = null; }
    redraw();
}

function resetView() {
    viewStart = 0; viewEnd = null; redraw();
}

function drawGridLines(ctx, W, H, vS, vE, vDur, interval, color) {
    const n0 = Math.ceil((vS - beatOffset) / interval);
    const n1 = Math.floor((vE - beatOffset) / interval);
    if (n1 < n0) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let n = n0; n <= n1; n++) {
        const x = Math.round((beatOffset + n * interval - vS) / vDur * W) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    ctx.stroke();
}

// ─── BPM / GRID ───────────────────────────────────────────────────────────────
async function detectBPM() {
    if (!audioBuf) return;
    const btn = document.getElementById('sm-btn-bpm');
    btn.textContent = '...'; btn.disabled = true;
    setStatus('analisando BPM...');
    await new Promise(r => setTimeout(r, 10));

    const sr = audioBuf.sampleRate;
    const maxLen = Math.min(audioBuf.length, sr * 45);
    const nCh = audioBuf.numberOfChannels;
    const data = new Float32Array(maxLen);
    for (let c = 0; c < nCh; c++) {
        const ch = audioBuf.getChannelData(c);
        for (let i = 0; i < maxLen; i++) data[i] += ch[i];
    }
    if (nCh > 1) { const inv = 1 / nCh; for (let i = 0; i < maxLen; i++) data[i] *= inv; }

    const hopSize = 512, winSize = 1024;
    const nFrames = Math.floor((maxLen - winSize) / hopSize);

    const energy = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
        const off = i * hopSize; let e = 0;
        for (let j = 0; j < winSize; j++) e += data[off + j] * data[off + j];
        energy[i] = e / winSize;
    }

    const onset = new Float32Array(nFrames);
    for (let i = 1; i < nFrames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);

    const hopSec = hopSize / sr;
    const lagMin = Math.max(2, Math.round(60 / (240 * hopSec)));
    const lagMax = Math.round(60 / (50 * hopSec));
    const corrArr = new Float32Array(lagMax + 1);
    let bestLag = lagMin, bestCorr = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
        let c = 0;
        const n = nFrames - lag;
        for (let i = 0; i < n; i++) c += onset[i] * onset[i + lag];
        corrArr[lag] = c;
        if (c > bestCorr) { bestCorr = c; bestLag = lag; }
    }

    // parabolic refinement
    let refinedLag = bestLag;
    if (bestLag > lagMin && bestLag < lagMax) {
        const y1 = corrArr[bestLag-1], y2 = corrArr[bestLag], y3 = corrArr[bestLag+1];
        const d = y1 - 2*y2 + y3;
        if (Math.abs(d) > 1e-12) refinedLag = bestLag + 0.5*(y1 - y3) / d;
    }

    let detectedBPM = 60 / (refinedLag * hopSec);
    while (detectedBPM < 80)  detectedBPM *= 2;
    while (detectedBPM > 160) detectedBPM /= 2;

    // beat phase via comb filter
    const periodInt = Math.max(1, Math.round(60 / detectedBPM / hopSec));
    let bestOff = 0, bestPhase = -Infinity;
    for (let o = 0; o < periodInt; o++) {
        let s = 0;
        for (let k = 0; o + k * periodInt < nFrames; k++) s += onset[o + k * periodInt];
        if (s > bestPhase) { bestPhase = s; bestOff = o; }
    }

    setBPM(detectedBPM, bestOff * hopSec);
    btn.textContent = '⟳'; btn.disabled = false;
}

function setBPM(b, offset) {
    bpm = Math.round(b * 10) / 10;
    beatOffset = Math.max(0, offset ?? 0);
    document.getElementById('sm-bpm-val').textContent = bpm.toFixed(1);
    document.getElementById('sm-bpm-input').value = bpm.toFixed(1);
    setStatus('BPM: ' + bpm.toFixed(1));
    redraw();
}

function onBPMInput(el) {
    const v = parseFloat(el.value);
    if (v >= 40 && v <= 300) setBPM(v, beatOffset);
}

function toggleSnap() {
    gridSnap = !gridSnap;
    const btn = document.getElementById('sm-btn-snap');
    btn.textContent = gridSnap ? 'SNAP: ON' : 'SNAP: OFF';
    btn.classList.toggle('active', gridSnap);
}

function setSnapBeats(v) { snapBeats = v; redraw(); }

function snapToGrid(t) {
    if (!bpm || !gridSnap) return t;
    const interval = (60 / bpm) * snapBeats;
    return clampTime(beatOffset + Math.round((t - beatOffset) / interval) * interval);
}

function tapTempo() {
    const now = performance.now() / 1000;
    if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > 2) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 8) tapTimes.shift();
    if (tapTimes.length >= 2) {
        let sum = 0;
        for (let i = 1; i < tapTimes.length; i++) sum += tapTimes[i] - tapTimes[i - 1];
        setBPM(60 / (sum / (tapTimes.length - 1)), beatOffset);
    }
}

// ─── PLAYBACK ─────────────────────────────────────────────────────────────────
function togglePlay() {
    if (isPlaying) stopPlay();
    else           startPlay();
}

function startPlay() {
    if (!audioBuf) return;
    const ctx  = getAC();
    const ss   = selStart ?? 0;
    const se   = selEnd   ?? duration;

    // Start from seek cursor if set, clamped inside selection
    const from = (seekPos !== null)
        ? Math.min(Math.max(seekPos, ss), Math.max(ss, se - 0.001))
        : ss;
    const dur  = se - from;
    if (dur <= 0) return;

    stopPlay();
    srcNode = ctx.createBufferSource();
    srcNode.buffer = audioBuf;
    srcNode.detune.value = tuningCents;
    srcNode.loop         = isLooping;
    srcNode.loopStart    = ss;
    srcNode.loopEnd      = se;

    gainNode = ctx.createGain();
    gainNode.gain.value = parseFloat(document.getElementById('sm-vol').value);
    srcNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    srcNode.start(0, from, isLooping ? undefined : dur);
    srcNode.onended = () => { if (!isLooping) { isPlaying = false; updatePlayBtn(); } };

    isPlaying  = true;
    playStart  = ctx.currentTime;
    playOffset = from;
    updatePlayBtn();
}

function stopPlay() {
    if (srcNode) {
        try { srcNode.stop(0); } catch(e) {}
        srcNode = null;
    }
    isPlaying = false;
    updatePlayBtn();
}

function toggleLoop() {
    isLooping = !isLooping;
    document.getElementById('sm-btn-loop').classList.toggle('active', isLooping);
    if (isPlaying) startPlay();
}

function currentTime() {
    if (!ac || !isPlaying) return seekPos ?? playOffset;
    const elapsed = ac.currentTime - playStart;
    const ss = selStart ?? 0;
    const se = selEnd   ?? duration;
    const loopDur = se - ss;
    if (isLooping && loopDur > 0) {
        // Treat seekPos as a phase offset inside the loop
        const phase = (playOffset - ss + elapsed) % loopDur;
        return ss + phase;
    }
    return Math.min(se, playOffset + elapsed);
}

// ─── RAF LOOP ─────────────────────────────────────────────────────────────────
function startRAF() {
    function loop() {
        if (isPlaying) redraw();
        updateTimeDisplay();
        rafId = requestAnimationFrame(loop);
    }
    loop();
}

// ─── PITCH DETECTION ─────────────────────────────────────────────────────────
function detectPitch() {
    if (!audioBuf) return;
    const ss = selStart ?? 0;
    const se = selEnd   ?? duration;
    const s0 = Math.floor(ss * sampleRate);
    const s1 = Math.ceil(se  * sampleRate);
    const len = Math.min(s1 - s0, 32768);
    const region = audioBuf.getChannelData(0).subarray(s0, s0 + len);

    const result = autocorrPitch(region, sampleRate);
    detectedNote = result;

    if (!result) {
        document.getElementById('sm-note-big').textContent   = '--';
        document.getElementById('sm-note-freq').textContent  = '-- Hz';
        document.getElementById('sm-note-cents').textContent = 'não detectado';
        document.getElementById('sm-pitch-bar').style.left   = '50%';
        return;
    }

    const sign = result.cents >= 0 ? '+' : '';
    document.getElementById('sm-note-big').textContent   = result.name;
    document.getElementById('sm-note-freq').textContent  = result.freq.toFixed(2) + ' Hz';
    document.getElementById('sm-note-cents').textContent = sign + result.cents + ' cents';
    // pitch bar: 50% = in tune, range ±50 cents
    const pct = 50 + result.cents;
    document.getElementById('sm-pitch-bar').style.left = Math.max(2, Math.min(98, pct)) + '%';
    document.getElementById('sm-btn-autotune').disabled = false;
}

function autocorrPitch(data, sr) {
    const SIZE = Math.min(data.length, 8192);
    const buf  = data.subarray(0, SIZE);

    // RMS check — skip if near silence
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return null;

    const corr = new Float32Array(SIZE);
    for (let lag = 0; lag < SIZE; lag++) {
        let s = 0;
        for (let i = 0; i < SIZE - lag; i++) s += buf[i] * buf[i + lag];
        corr[lag] = s;
    }

    // find first trough then first peak after
    let dip = false, peakLag = -1;
    for (let i = 1; i < SIZE; i++) {
        if (!dip && corr[i] < corr[0] * 0.5) dip = true;
        if (dip && corr[i] > corr[i-1]) {
            while (i < SIZE - 1 && corr[i+1] > corr[i]) i++;
            peakLag = i; break;
        }
    }
    if (peakLag < 1) return null;

    // parabolic interpolation
    const y1 = corr[peakLag - 1];
    const y2 = corr[peakLag];
    const y3 = peakLag + 1 < SIZE ? corr[peakLag + 1] : y2;
    const delta = 0.5 * (y1 - y3) / (y1 - 2*y2 + y3 + 1e-10);
    const freq   = sr / (peakLag + delta);

    if (freq < 40 || freq > 4200) return null;

    const midi  = 69 + 12 * Math.log2(freq / 440);
    const mR    = Math.round(midi);
    const cents = Math.round((midi - mR) * 100);
    const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

    return { freq, midi: mR, name: NAMES[((mR % 12) + 12) % 12] + (Math.floor(mR/12) - 1), cents };
}

// ─── TUNING ──────────────────────────────────────────────────────────────────
function setTuning(cents) {
    tuningCents = cents;
    document.getElementById('sm-tune-slider').value   = cents;
    document.getElementById('sm-tune-val').textContent = (cents >= 0 ? '+' : '') + cents + '¢';
    if (isPlaying) startPlay();
}

function autoTune() {
    if (!detectedNote) return;
    setTuning(-detectedNote.cents);
}

// ─── EDIÇÕES (in-place on audioBuf copy) ─────────────────────────────────────
function getSelSamples() {
    const s0 = Math.floor((selStart ?? 0) * sampleRate);
    const s1 = Math.ceil((selEnd   ?? duration) * sampleRate);
    return [Math.max(0, s0), Math.min(audioBuf.length, s1)];
}

function editNormalize() {
    if (!audioBuf) return;
    const [s0, s1] = getSelSamples();
    let peak = 0;
    for (let c = 0; c < audioBuf.numberOfChannels; c++) {
        const d = audioBuf.getChannelData(c);
        for (let i = s0; i < s1; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
    }
    if (peak < 0.0001) return;
    const gain = 1 / peak;
    for (let c = 0; c < audioBuf.numberOfChannels; c++) {
        const d = audioBuf.getChannelData(c);
        for (let i = s0; i < s1; i++) d[i] *= gain;
    }
    peaks = computePeaks(audioBuf, 4000); redraw();
    setStatus('normalizado');
}

function editReverse() {
    if (!audioBuf) return;
    const [s0, s1] = getSelSamples();
    for (let c = 0; c < audioBuf.numberOfChannels; c++) {
        const d = audioBuf.getChannelData(c);
        for (let i = s0, j = s1 - 1; i < j; i++, j--) {
            const tmp = d[i]; d[i] = d[j]; d[j] = tmp;
        }
    }
    peaks = computePeaks(audioBuf, 4000); redraw();
    setStatus('revertido');
}

function editFadeIn() {
    if (!audioBuf) return;
    const [s0, s1] = getSelSamples();
    const len = s1 - s0;
    for (let c = 0; c < audioBuf.numberOfChannels; c++) {
        const d = audioBuf.getChannelData(c);
        for (let i = 0; i < len; i++) d[s0 + i] *= i / len;
    }
    peaks = computePeaks(audioBuf, 4000); redraw();
    setStatus('fade in aplicado');
}

function editFadeOut() {
    if (!audioBuf) return;
    const [s0, s1] = getSelSamples();
    const len = s1 - s0;
    for (let c = 0; c < audioBuf.numberOfChannels; c++) {
        const d = audioBuf.getChannelData(c);
        for (let i = 0; i < len; i++) d[s0 + i] *= 1 - i / len;
    }
    peaks = computePeaks(audioBuf, 4000); redraw();
    setStatus('fade out aplicado');
}

function editSilence() {
    if (!audioBuf) return;
    const [s0, s1] = getSelSamples();
    for (let c = 0; c < audioBuf.numberOfChannels; c++) {
        const d = audioBuf.getChannelData(c);
        for (let i = s0; i < s1; i++) d[i] = 0;
    }
    peaks = computePeaks(audioBuf, 4000); redraw();
    setStatus('silence aplicado');
}

function editTrimToSel() {
    if (!audioBuf) return;
    const [s0, s1] = getSelSamples();
    const nCh  = audioBuf.numberOfChannels;
    const newLen = s1 - s0;
    const ctx  = getAC();
    const newBuf = ctx.createBuffer(nCh, newLen, sampleRate);
    for (let c = 0; c < nCh; c++) {
        newBuf.getChannelData(c).set(audioBuf.getChannelData(c).subarray(s0, s1));
    }
    audioBuf = newBuf;
    duration = audioBuf.duration;
    selStart = 0; selEnd = duration;
    viewStart = 0; viewEnd = null;
    peaks = computePeaks(audioBuf, 4000);
    updateSelInfo(); redraw();
    setStatus('trimado para seleção — ' + fmtTime(duration));
}

// ─── PREPARAR PARA MIDI ──────────────────────────────────────────────────────

function findTrimPoints(buf, threshold) {
    const nCh = buf.numberOfChannels;
    const len = buf.length;
    let start = 0, end = len;

    for (let i = 0; i < len; i++) {
        let loud = false;
        for (let c = 0; c < nCh; c++) {
            if (Math.abs(buf.getChannelData(c)[i]) > threshold) { loud = true; break; }
        }
        if (loud) { start = i; break; }
    }

    for (let i = len - 1; i >= start; i--) {
        let loud = false;
        for (let c = 0; c < nCh; c++) {
            if (Math.abs(buf.getChannelData(c)[i]) > threshold) { loud = true; break; }
        }
        if (loud) { end = i + 1; break; }
    }

    return [start, end];
}

function prepareForMidi() {
    if (!audioBuf) return;
    setStatus('preparando para MIDI...');

    const sr  = audioBuf.sampleRate;
    const nCh = audioBuf.numberOfChannels;
    const ctx = getAC();

    // 1. Detect pitch if missing
    if (!detectedNote) detectPitch();

    // 2. Auto-tune to nearest semitone
    if (detectedNote) autoTune();

    // 3. Trim silence (threshold ~-54 dB)
    const THRESH = 0.002;
    let [s0, s1] = findTrimPoints(audioBuf, THRESH);

    // Leave 2ms of lead-in/lead-out so attack isn't clipped
    const lead = Math.floor(sr * 0.002);
    s0 = Math.max(0, s0 - lead);
    s1 = Math.min(audioBuf.length, s1 + lead);

    if (s1 - s0 < sr * 0.01) { setStatus('sample muito silencioso para preparar'); return; }

    // 4. Create trimmed buffer
    const newLen = s1 - s0;
    const newBuf = ctx.createBuffer(nCh, newLen, sr);
    for (let c = 0; c < nCh; c++)
        newBuf.getChannelData(c).set(audioBuf.getChannelData(c).subarray(s0, s1));

    // 5. Fade in (5 ms) + Fade out (30 ms)
    const fiSamples = Math.min(Math.floor(0.005 * sr), Math.floor(newLen / 4));
    const foSamples = Math.min(Math.floor(0.030 * sr), Math.floor(newLen / 4));
    for (let c = 0; c < nCh; c++) {
        const d = newBuf.getChannelData(c);
        for (let i = 0; i < fiSamples; i++)
            d[i] *= i / fiSamples;
        for (let i = 0; i < foSamples; i++)
            d[newLen - 1 - i] *= i / foSamples;
    }

    // 6. Normalize to 0.99 peak
    let peak = 0;
    for (let c = 0; c < nCh; c++) {
        const d = newBuf.getChannelData(c);
        for (let i = 0; i < newLen; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
    }
    if (peak > 0.0001) {
        const gain = 0.99 / peak;
        for (let c = 0; c < nCh; c++) {
            const d = newBuf.getChannelData(c);
            for (let i = 0; i < newLen; i++) d[i] *= gain;
        }
    }

    // 7. Commit to current clip
    audioBuf  = newBuf;
    duration  = audioBuf.duration;
    selStart  = 0;
    selEnd    = duration;
    viewStart = 0;
    viewEnd   = null;
    seekPos   = null;
    peaks = computePeaks(audioBuf, 4000);
    if (activeClipIdx >= 0 && clips[activeClipIdx]) {
        Object.assign(clips[activeClipIdx], { audioBuf, peaks, selStart, selEnd, viewStart, viewEnd, seekPos });
    }
    updateSelInfo();
    redraw();

    // 8. Export with note name in filename
    const note     = detectedNote ? detectedNote.name.replace('#', 's') : 'sem_nota';
    const clipBase = (activeClipIdx >= 0 && clips[activeClipIdx])
        ? clips[activeClipIdx].name.toLowerCase().replace(/\s+/g, '_')
        : 'sample';
    exportMidiWAV(clipBase + '_' + note);

    const tuneMsg = detectedNote ? ' · afinado para ' + detectedNote.name : '';
    setStatus('MIDI pronto' + tuneMsg + ' · trim + fade + normalize · ' + fmtTime(duration));
}

function exportMidiWAV(basename) {
    const nCh  = audioBuf.numberOfChannels;
    const len  = audioBuf.length;
    const sr   = sampleRate;
    const bAl  = nCh * 2;
    const dSz  = len * bAl;
    const ab   = new ArrayBuffer(44 + dSz);
    const v    = new DataView(ab);
    const wr   = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o+i, s.charCodeAt(i)); };
    wr(0,'RIFF'); v.setUint32(4, 36+dSz, true);
    wr(8,'WAVE'); wr(12,'fmt ');
    v.setUint32(16,16,true); v.setUint16(20,1,true);
    v.setUint16(22,nCh,true); v.setUint32(24,sr,true);
    v.setUint32(28,sr*bAl,true); v.setUint16(32,bAl,true);
    v.setUint16(34,16,true); wr(36,'data'); v.setUint32(40,dSz,true);
    const chs = [];
    for (let c = 0; c < nCh; c++) chs.push(audioBuf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
        for (let c = 0; c < nCh; c++) {
            const s = Math.max(-1, Math.min(1, chs[c][i]));
            v.setInt16(off, s < 0 ? s*32768 : s*32767, true); off += 2;
        }
    }
    const blob = new Blob([ab], { type: 'audio/wav' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = basename + '.wav';
    a.click();
    URL.revokeObjectURL(url);
}

// ─── EXPORT WAV ──────────────────────────────────────────────────────────────
function exportWAV() {
    if (!audioBuf) return;
    const [s0, s1]  = getSelSamples();
    const nCh   = audioBuf.numberOfChannels;
    const newLen = s1 - s0;
    const sr    = sampleRate;
    const blockAlign = nCh * 2;
    const dataSize   = newLen * blockAlign;
    const ab    = new ArrayBuffer(44 + dataSize);
    const v     = new DataView(ab);
    const wr    = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o+i, s.charCodeAt(i)); };
    wr(0,'RIFF'); v.setUint32(4, 36+dataSize, true);
    wr(8,'WAVE'); wr(12,'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr*blockAlign, true); v.setUint16(32, blockAlign, true);
    v.setUint16(34, 16, true); wr(36,'data'); v.setUint32(40, dataSize, true);

    const chs = [];
    for (let c = 0; c < nCh; c++) chs.push(audioBuf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < newLen; i++) {
        for (let c = 0; c < nCh; c++) {
            const s = Math.max(-1, Math.min(1, chs[c][s0 + i]));
            v.setInt16(off, s < 0 ? s*32768 : s*32767, true); off += 2;
        }
    }

    const blob = new Blob([ab], { type: 'audio/wav' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'sample_' + fmtTime(selStart ?? 0).replace(/[:.]/g, '_') + '.wav';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('exportado: ' + a.download);
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function fmtTime(t) {
    const m  = Math.floor(t / 60);
    const s  = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);
    return m + ':' + String(s).padStart(2,'0') + '.' + String(ms).padStart(3,'0');
}

function setStatus(msg) {
    document.getElementById('sm-filename').textContent = msg;
}

function updateSelInfo() {
    const ss = selStart ?? 0;
    const se = selEnd   ?? duration;
    const dur = se - ss;
    document.getElementById('sm-sel-start').textContent = fmtTime(ss);
    document.getElementById('sm-sel-end').textContent   = fmtTime(se);
    document.getElementById('sm-sel-dur').textContent   = fmtTime(dur);
    document.getElementById('sm-sel-smp').textContent   =
        audioBuf ? Math.round(dur * sampleRate).toLocaleString() : '--';
    const wt = document.getElementById('sm-wave-time');
    if (wt) wt.textContent = fmtTime(ss) + ' — ' + fmtTime(se);
}

function updateTimeDisplay() {
    if (!audioBuf) return;
    const t   = currentTime();
    const ss  = selStart ?? 0;
    const se  = selEnd   ?? duration;
    document.getElementById('sm-time-display').textContent =
        fmtTime(t) + ' / ' + fmtTime(se - ss);
}

function updatePlayBtn() {
    const btn = document.getElementById('sm-btn-play');
    btn.textContent = isPlaying ? '■ PARAR' : '▶ TOCAR SELEÇÃO';
    btn.classList.toggle('active', isPlaying);
}

function enableControls(on) {
    ['sm-btn-play','sm-btn-stop','sm-btn-loop','sm-btn-detect',
     'sm-btn-autotune','sm-btn-export','sm-btn-bpm','sm-btn-midi',
     'sm-e-norm','sm-e-rev','sm-e-fi','sm-e-fo','sm-e-sil','sm-e-trim']
        .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !on; });
}
