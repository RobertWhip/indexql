import { useEffect, useRef, useState } from 'react';
import { Product } from '../entity';
import { IndexQLClient, SyncHandle } from '../../../../src/client/indexqlClient';
import type { Entity } from '../../../../src/core/types';

export function App() {
  const clientRef = useRef<IndexQLClient | null>(null);
  const syncRef   = useRef<SyncHandle | null>(null);
  const [items, setItems] = useState<Entity[]>([]);
  const [seq, setSeq]     = useState(0);

  useEffect(() => {
    (async () => {
      const ab     = await fetch('/snapshot.bin').then(r => r.arrayBuffer());
      const client = IndexQLClient.fromSnapshot(ab, { entity: Product });
      clientRef.current = client;

      const sync = await client.startSync({
        onChange: () => {
          setItems(client.getAll());
          setSeq(sync.seq);
        },
      });
      syncRef.current = sync;
      setItems(client.getAll());
      setSeq(sync.seq);
    })();
    return () => syncRef.current?.stop();
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: 20, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h2 style={{ margin: 0 }}>Manual — {items.length} items — seq {seq}</h2>
        <button
          onClick={() => syncRef.current?.refresh()}
          style={{
            padding: '4px 14px', fontFamily: 'monospace', fontSize: 13,
            cursor: 'pointer', background: '#2980b9', color: '#fff',
            border: 'none', borderRadius: 4,
          }}
        >
          Refresh
        </button>
      </div>
      <p style={{ color: '#888', fontSize: 13 }}>No auto-poll. Click Refresh to fetch latest snapshot.</p>
      <Table items={items} />
    </div>
  );
}

function Table({ items }: { items: Entity[] }) {
  const sorted = [...items].sort((a, b) => (a.seq as number) - (b.seq as number));
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
          <th style={th}>seq</th><th style={th}>name</th>
          <th style={{ ...th, textAlign: 'right' }}>price</th>
          <th style={{ ...th, textAlign: 'right' }}>qty</th>
          <th style={th}>inStock</th>
        </tr>
      </thead>
      <tbody>
        {sorted.slice(0, 100).map(item => (
          <tr key={item.seq as number} style={{ borderBottom: '1px solid #eee' }}>
            <td style={td}>{item.seq as number}</td>
            <td style={td}>{item.name as string}</td>
            <td style={{ ...td, textAlign: 'right' }}>${(item.price as number).toFixed(2)}</td>
            <td style={{ ...td, textAlign: 'right' }}>{item.qty as number}</td>
            <td style={td}>{item.inStock ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 12px' };
