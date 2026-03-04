import express from 'express';
import cors from 'cors';
import { Product } from './entity';
import { seed, mutate } from '../shared/mock';
import { encodeEntity, getEntitySchema, toBinaryColumnMetas, getKeyColumn } from '../../../src/core/entity';
import { encodeDelta, computeDelta } from '../../../src/core/delta-codec';

const app = express();
app.use(cors({ origin: true }));

const schema = getEntitySchema(Product);
const meta = toBinaryColumnMetas(schema);
const keyCol = getKeyColumn(schema).propertyKey;

const items = seed(10_000);
let snapshot = encodeEntity(Product, items as any[]);
let seq = 0;
const deltas: Array<{ seq: number; buf: Buffer }> = [];

setInterval(() => {
  const prev = mutate(items);
  seq++;

  const packet = computeDelta(prev, items, meta, keyCol);
  packet.seq = seq;
  deltas.push({ seq, buf: encodeDelta(packet, meta) });
  if (deltas.length > 60) deltas.shift();

  snapshot = encodeEntity(Product, items as any[]);
}, 2000);

app.get('/snapshot.bin', (_, res) => res.send(snapshot));
app.get('/head', (_, res) => res.json({ seq, itemCount: items.length }));
app.get('/d/:seq.bin', (req, res) => {
  const entry = deltas.find(d => d.seq === +req.params.seq);
  entry ? res.send(entry.buf) : res.status(404).end();
});

app.listen(3012, () => console.log('Incremental → http://localhost:3012'));
