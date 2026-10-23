// Server statico per provare l'interfaccia in locale: node demo-server.mjs  ->  http://localhost:8888/?demo
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
createServer((req, res) => {
  const f = req.url.startsWith('/manifest') ? 'manifest.json' : 'index.html';
  res.setHeader('content-type', f.endsWith('json') ? 'application/json' : 'text/html; charset=utf-8');
  res.end(readFileSync(new URL('./public/' + f, import.meta.url)));
}).listen(8888, () => console.log('http://localhost:8888/?demo'));
