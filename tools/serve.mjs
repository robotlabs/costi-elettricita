// Server statico locale per provare la pagina: node tools/serve.mjs [porta]
// Se la porta è occupata passa alla successiva libera (niente crash per EADDRINUSE).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

let port = Number(process.argv[2] || process.env.PORT || 5173);
const maxPort = port + 50;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < maxPort) { port++; server.listen(port, '127.0.0.1'); }
  else { console.error(e); process.exit(1); }
});
server.on('listening', () => console.log(`Bollette luce → http://127.0.0.1:${port}/`));
server.listen(port, '127.0.0.1');
