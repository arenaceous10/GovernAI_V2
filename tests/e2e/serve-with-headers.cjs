// Serves a build folder with the headers from vercel.json, so tests run under the production CSP.
// node tests/e2e/serve-with-headers.cjs <dir> <port>
const http = require('http'); const fs = require('fs'); const path = require('path');
const [dir, port] = [process.argv[2] || 'dist', +(process.argv[3] || 4174)];
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.json': 'application/json' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  for (const h of cfg.headers) if (new RegExp(`^${h.source.replace('(.*)', '.*')}$`).test(u)) for (const { key, value } of h.headers) res.setHeader(key, value);
  let f = path.join(dir, u === '/' ? 'index.html' : u);
  if (!f.startsWith(path.resolve(dir)) && !path.resolve(f).startsWith(path.resolve(dir))) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html');
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('serving', dir, 'on', port));
