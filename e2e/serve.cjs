const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const basePath = '/control-plots/';
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);

http.createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://127.0.0.1:4173');
  if (!pathname.startsWith(basePath)) return response.writeHead(404).end();
  const filename = path.resolve(root, pathname.slice(basePath.length) || 'index.html');
  const type = types.get(path.extname(filename));
  if (!filename.startsWith(root + path.sep) || !type) return response.writeHead(404).end();
  fs.readFile(filename, (error, data) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { 'Content-Type': type }).end(data);
  });
}).listen(4173, '127.0.0.1');
