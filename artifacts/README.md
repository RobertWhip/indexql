# IndexQL Artifacts

This directory holds the pre-built static artifacts emitted by the IndexQL build pipeline.

## Files

| File | Description |
|---|---|
| `manifest.json` | Build metadata: schema hash, file hashes, counts, timestamp |
| `products.gz.json` | Encoded product catalog (Buffer/base64 + checksum) |
| `facets.gz.json` | Pre-computed facets over the full product set |

> **Note:** The `.gz.json` extension signals that files are encoded artifacts.
> Actual encoding is Buffer-based base64 (no native gzip dependency).

---

## Artifact Format

Each artifact file (`products.gz.json`, `facets.gz.json`) is a JSON object:

```json
{
  "encoding":  "base64",
  "algorithm": "buffer-json",
  "checksum":  "a1b2c3d4",
  "data":      "<base64-encoded JSON string>"
}
```

| Field | Description |
|---|---|
| `encoding` | Always `"base64"` – data field is a Base64 string |
| `algorithm` | `"buffer-json"` – JSON → UTF-8 Buffer → base64 |
| `checksum` | 8-char hex XOR checksum of the raw JSON string |
| `data` | Base64 payload; decode with `Buffer.from(data, 'base64').toString('utf8')` |

---

## Manifest Format

```json
{
  "version": "1.0.0",
  "schema": "<64-bit hash of schema SDL>",
  "generatedAt": "2025-01-01T00:00:00.000Z",
  "files": {
    "products": {
      "name": "products.gz.json",
      "hash": "<64-bit hash of artifact .data>",
      "sizeBytes": 12345,
      "count": 100
    },
    "facets": {
      "name": "facets.gz.json",
      "hash": "<64-bit hash of artifact .data>",
      "sizeBytes": 2345
    }
  }
}
```

---

## Decoding (Node.js)

```typescript
import * as fs from 'fs';

const artifact = JSON.parse(fs.readFileSync('artifacts/products.gz.json', 'utf8'));
const json     = Buffer.from(artifact.data, 'base64').toString('utf8');
const products = JSON.parse(json);
```

Or use the SDK:

```typescript
import { IndexQLClient } from './src/client/indexqlClient';
const client   = IndexQLClient.load();
const products = client.getAllProducts();
```

---

## Regenerating

```bash
npm run seed    # Regenerate products.json (optional)
npm run build   # Rebuild all artifacts
npm run inspect # Inspect current artifacts
```
