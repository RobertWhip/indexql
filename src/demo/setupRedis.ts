/**
 * src/demo/setupRedis.ts
 * Populate Redis with all products as JSON strings.
 * Key pattern: product:{id}
 *
 * Usage: npx ts-node src/demo/setupRedis.ts
 */

import * as fs   from 'fs';
import * as path from 'path';
import Redis     from 'ioredis';

const ROOT          = path.resolve(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');

async function setupRedis(): Promise<void> {
  const redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: true });

  try {
    await redis.connect();
  } catch (err) {
    console.error('Could not connect to Redis:', (err as Error).message);
    process.exit(1);
  }

  // Load products from artifacts
  const manifestPath = path.join(ARTIFACTS_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('No manifest found. Run "npm run build" first.');
    process.exit(1);
  }

  const { reconstructProducts } = await import('../core/binary-encoder');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const productsBuf = fs.readFileSync(path.join(ARTIFACTS_DIR, manifest.files.products.name));
  const strings     = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, manifest.files.strings.name), 'utf8'));
  const products    = reconstructProducts(productsBuf, strings);

  console.log(`Loaded ${products.length} products. Writing to Redis in batches of 500…`);

  const BATCH = 500;
  let written = 0;

  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const pipeline = redis.pipeline();
    for (const p of batch) {
      pipeline.set(`product:${p.id}`, JSON.stringify(p));
    }
    await pipeline.exec();
    written += batch.length;
    process.stdout.write(`\r  Written: ${written} / ${products.length}`);
  }

  console.log(`\nDone. ${written} keys set in Redis.`);
  await redis.quit();
}

setupRedis().catch(err => {
  console.error(err);
  process.exit(1);
});
