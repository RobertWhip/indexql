import Redis from 'ioredis';

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6380'),
    });
  }
  return client;
}

export async function storeProducts(categoryId: string, products: Record<string, unknown>[]): Promise<number> {
  const redis = getClient();
  const BATCH = 500;
  let stored = 0;

  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const pipeline = redis.pipeline();
    for (let j = 0; j < batch.length; j++) {
      const seq = i + j;
      pipeline.set(`product:${categoryId}:${batch[j].seq}`, JSON.stringify(batch[j]));
    }
    await pipeline.exec();
    stored += batch.length;
  }

  return stored;
}

export async function fetchProductsBySeq(categoryId: string, seqs: number[]): Promise<Record<string, unknown>[]> {
  if (seqs.length === 0) return [];
  const redis = getClient();
  const keys = seqs.map(seq => `product:${categoryId}:${seq}`);
  const values = await redis.mget(...keys);

  const products: Record<string, unknown>[] = [];
  for (const v of values) {
    if (v) products.push(JSON.parse(v));
  }
  return products;
}
