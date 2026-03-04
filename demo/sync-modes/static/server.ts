import express from 'express';
import cors from 'cors';
import { Product } from './entity';
import { seed } from '../shared/mock';
import { encodeEntity } from '../../../src/core/entity';

const app = express();
app.use(cors({ origin: true }));

const items = seed(10_000);
const snapshot = encodeEntity(Product, items as any[]);

app.get('/snapshot.bin', (_, res) => res.send(snapshot));
app.get('/head', (_, res) => res.json({ seq: 0, itemCount: items.length }));

app.listen(3010, () => console.log('Static → http://localhost:3010'));
