import type { Entity } from '../../../src/core/types';

const NAMES = ['Widget', 'Gadget', 'Gizmo', 'Sprocket', 'Sensor', 'Module', 'Relay', 'Valve'];
let _seq = 1;

export function seed(n: number): Entity[] {
  return Array.from({ length: n }, () => ({
    seq: _seq,
    price: +(Math.random() * 500 + 1).toFixed(2),
    qty: Math.floor(Math.random() * 1000),
    inStock: Math.random() > 0.2,
    name: `${NAMES[_seq % NAMES.length]}-${_seq++}`,
  }));
}

/** Mutate items in-place. Returns pre-mutation snapshot (needed for delta computation). */
export function mutate(items: Entity[]): Entity[] {
  const prev = items.slice();
  for (let i = 0; i < 100; i++) {
    const idx = Math.floor(Math.random() * items.length);
    const it = { ...items[idx] };
    it.price = +(((it.price as number) * (1 + Math.random() * 0.2 - 0.1))).toFixed(2);
    it.qty = Math.max(0, Math.round((it.qty as number) * (1 + Math.random() * 0.4 - 0.2)));
    if (Math.random() < 0.1) it.inStock = !it.inStock;
    items[idx] = it;
  }
  for (let i = 0; i < 3; i++) items.push(...seed(1));
  for (let i = 0; i < 3; i++) items.splice(Math.floor(Math.random() * items.length), 1);
  return prev;
}
