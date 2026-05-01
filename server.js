const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.wav':  'audio/wav',
    '.mp3':  'audio/mpeg',
    '.aif':  'audio/aiff',
    '.aiff': 'audio/aiff',
    '.ogg':  'audio/ogg',
    '.flac': 'audio/flac',
};

const AUDIO_EXTS = new Set(['.wav','.mp3','.aif','.aiff','.ogg','.flac']);

function scanDir(dir, base) {
    const files = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return files; }
    for (const e of entries) {
        if (e.name.startsWith('.') || e.name.startsWith('__')) continue;
        const full = path.join(dir, e.name);
        const rel  = (base ? base + '/' : '') + e.name;
        if (e.isDirectory()) files.push(...scanDir(full, rel));
        else if (e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase()))
            files.push(rel);
    }
    return files;
}

const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (urlPath === '/kits-index.json') {
        const files = scanDir(path.join(ROOT, 'kits'), 'kits');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(files));
        return;
    }

    const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

    // security: stay inside ROOT
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  ▓ AMEN TRACKER');
    console.log(`  http://localhost:${PORT}`);
    console.log('');
    console.log('  Deixe esta janela aberta enquanto usar o tracker.');
    console.log('  Feche para parar o servidor.');
    console.log('');
    console.log(`  Abra no navegador: http://localhost:${PORT}`);
});
