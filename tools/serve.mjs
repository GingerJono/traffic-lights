// Minimal static server for local testing: node tools/serve.mjs [port]
// Wraps app/index.html in a document skeleton the way the Artifact host does.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const port = Number(process.argv[2] || 8765);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

http.createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/') path = '/index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (path === '/index.html') {
      body = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        + '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, () => console.log(`http://localhost:${port}/`));
