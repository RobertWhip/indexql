import express from 'express';
import cors from 'cors';
import { Product } from './entity';
import { seed, mutate } from '../shared/mock';
import { encodeEntity } from '../../../src/core/entity';

const app = express();
app.use(cors({ origin: true }));

const items = seed(10_000);
let snapshot = encodeEntity(Product, items as any[]);
let seq = 0;

setInterval(() => {
  mutate(items);
  snapshot = encodeEntity(Product, items as any[]);
  seq++;
}, 2000);

app.get('/snapshot.bin', (_, res) => res.send(snapshot));
app.get('/head', (_, res) => res.json({ seq, itemCount: items.length }));

app.listen(3013, () => console.log('Manual → http://localhost:3013'));
