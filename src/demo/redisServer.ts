/**
 * src/demo/redisServer.ts
 * Lightweight HTTP proxy for Redis product lookups.
 *
 * POST /products/batch  { ids: string[] } → Product[]
 * GET  /health          → 200 OK
 *
 * Usage: npx ts-node src/demo/redisServer.ts
 */

import * as http from 'http';
import Redis     from 'ioredis';

const PORT = 3001;

const redis = new Redis({ host: '127.0.0.1', port: 6379 });

redis.on('error', err => {
  console.error('Redis connection error:', err.message);
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end',  ()              => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url    = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (method === 'POST' && url === '/products/batch') {
    try {
      const raw  = await readBody(req);
      const body = JSON.parse(raw) as { ids?: string[] };
      const ids  = body.ids;

      if (!Array.isArray(ids) || ids.length === 0) {
        sendJson(res, 400, { error: 'ids array required' });
        return;
      }

      const keys   = ids.map(id => `product:${id}`);
      const values = await redis.mget(...keys);
      const products = values
        .filter((v): v is string => v !== null)
        .map(v => JSON.parse(v));

      sendJson(res, 200, { products, count: products.length });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Redis HTTP server listening on http://localhost:${PORT}`);
  console.log(`  POST /products/batch  { ids: string[] }`);
  console.log(`  GET  /health`);
});
