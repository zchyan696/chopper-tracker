const AUDIO_EXTS = new Set(['wav','mp3','aif','aiff','ogg','flac']);

function isAudio(name) {
    return AUDIO_EXTS.has(name.split('.').pop().toLowerCase());
}

// Recursively scan a directory handle, return flat list of { name, path, handle }
async function scanDir(dirHandle, path = '') {
    const files = [];
    for await (const [name, handle] of dirHandle.entries()) {
        if (name.startsWith('.')) continue;
        const fullPath = path ? `${path}/${name}` : name;
        if (handle.kind === 'directory') {
            const sub = await scanDir(handle, fullPath);
            files.push(...sub);
        } else if (handle.kind === 'file' && isAudio(name)) {
            files.push({ name, path: fullPath, handle });
        }
    }
    return files;
}

export class KitsBrowser {
    constructor({ onLoad }) {
        this.onLoad = onLoad;
        this.files  = [];
        this.filtered = [];
        this.previewCtx = null;
        this.previewSrc = null;
    }

    mount() {
        this.container = document.getElementById('kits-panel');
        this.list      = document.getElementById('kits-list');
        this.search    = document.getElementById('kits-search');
        this.btnOpen   = document.getElementById('btn-open-kits');
        this.status    = document.getElementById('kits-status');

        this.btnOpen.addEventListener('click', () => this.openFolder());
        this.search.addEventListener('input', () => this.filter(this.search.value));
        this.list.addEventListener('click', e => {
            const li = e.target.closest('li[data-idx]');
            if (!li) return;
            const idx = parseInt(li.dataset.idx);
            this.selectItem(li, idx, /* load */ false);
        });
        this.list.addEventListener('dblclick', e => {
            const li = e.target.closest('li[data-idx]');
            if (!li) return;
            const idx = parseInt(li.dataset.idx);
            this.selectItem(li, idx, /* load */ true);
        });
    }

    async openFolder() {
        if (!window.showDirectoryPicker) {
            alert('File System Access API not supported.\nUse Chrome or Edge.');
            return;
        }
        try {
            const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
            this.status.textContent = 'scanning...';
            this.files    = await scanDir(dirHandle);
            this.filtered = this.files;
            this.status.textContent = `${this.files.length} samples found`;
            this.render(this.filtered);
            this.search.value = '';
        } catch (e) {
            if (e.name !== 'AbortError') this.status.textContent = 'error: ' + e.message;
        }
    }

    filter(q) {
        const lq = q.toLowerCase().trim();
        this.filtered = lq
            ? this.files.filter(f => f.path.toLowerCase().includes(lq))
            : this.files;
        this.render(this.filtered);
        this.status.textContent = `${this.filtered.length} / ${this.files.length} samples`;
    }

    render(files) {
        this.list.innerHTML = '';
        files.forEach((f, i) => {
            const li = document.createElement('li');
            li.dataset.idx = i;

            // folder part dim, filename bright
            const parts = f.path.split('/');
            const fname = parts.pop();
            const fdir  = parts.join('/');

            if (fdir) {
                const dirSpan = document.createElement('span');
                dirSpan.className = 'kit-dir';
                dirSpan.textContent = fdir + '/';
                li.appendChild(dirSpan);
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'kit-name';
            nameSpan.textContent = fname;
            li.appendChild(nameSpan);

            this.list.appendChild(li);
        });
    }

    async selectItem(li, idx, load) {
        // Highlight
        this.list.querySelectorAll('li.active').forEach(el => el.classList.remove('active'));
        li.classList.add('active');

        const f = this.filtered[idx];
        if (!f) return;
        const file = await f.handle.getFile();

        if (load) {
            this.stopPreview();
            await this.onLoad(file);
        } else {
            await this.preview(file);
        }
    }

    async preview(file) {
        this.stopPreview();
        if (!this.previewCtx) this.previewCtx = new AudioContext();
        if (this.previewCtx.state === 'suspended') await this.previewCtx.resume();

        const ab  = await file.arrayBuffer();
        const buf = await this.previewCtx.decodeAudioData(ab);
        const src = this.previewCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this.previewCtx.destination);
        src.start();
        this.previewSrc = src;
    }

    stopPreview() {
        if (this.previewSrc) {
            try { this.previewSrc.stop(); } catch (_) {}
            this.previewSrc = null;
        }
    }
}
