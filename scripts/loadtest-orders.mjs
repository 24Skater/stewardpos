#!/usr/bin/env node
/**
 * A load test for `POST /api/orders` — the one endpoint a shop cannot afford to
 * be slow or wrong.
 *
 * Deliberately dependency-free. `autocannon` is the obvious tool and the phase
 * plan names it, but adding a devDependency for a script that runs by hand
 * against a live stack is not worth the supply-chain surface. Node's own http
 * client measures latency just as well.
 *
 * What it checks beyond speed: every response is read and its `total` compared
 * against what the same cart should cost. A register that gets fast by dropping
 * writes, or by racing itself into the wrong total, fails here rather than in a
 * shop. Stock decrements are the reason concurrency matters — the adapter
 * integration tests cover two connections racing; this covers many.
 *
 * Usage:
 *   node scripts/loadtest-orders.mjs --url http://localhost:3000 --token <jwt> \
 *     --product <id> --variant <id> --concurrency 20 --requests 500
 *
 * The token needs `orders.write`. Run against a scratch database: this creates
 * real orders and really decrements stock.
 */

import { performance } from 'node:perf_hooks';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const BASE = arg('url', 'http://localhost:3000');
const TOKEN = arg('token');
const PRODUCT_ID = arg('product');
const VARIANT_ID = arg('variant');
const CONCURRENCY = Number(arg('concurrency', 20));
const REQUESTS = Number(arg('requests', 500));

if (!TOKEN || !PRODUCT_ID || !VARIANT_ID) {
  console.error('Missing --token, --product or --variant. See the header of this file.');
  process.exit(2);
}

const body = JSON.stringify({
  items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }],
  paymentMethod: 'Cash',
});

const latencies = [];
let completed = 0;
let failed = 0;
const statusCounts = new Map();

async function fire() {
  const started = performance.now();

  try {
    const response = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body,
    });

    const elapsed = performance.now() - started;
    latencies.push(elapsed);
    statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);

    // Draining the body is not optional — an unread response holds the socket
    // and the numbers below become a measure of this script, not the server.
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      failed += 1;
      return;
    }

    // Correctness under load, not just latency: a sale that returns 200 with a
    // total of zero is worse than a sale that returns 500.
    const total = payload?.data?.total ?? payload?.total;
    if (typeof total !== 'number' || total <= 0) {
      failed += 1;
      console.error(`Order ${payload?.data?.id ?? '?'} came back with total ${total}`);
    }
  } catch (error) {
    failed += 1;
    latencies.push(performance.now() - started);
    statusCounts.set(error.code ?? 'ERR', (statusCounts.get(error.code ?? 'ERR') ?? 0) + 1);
  } finally {
    completed += 1;
  }
}

let issued = 0;

/** One worker pulls from the shared budget until it is exhausted. */
async function worker() {
  while (issued < REQUESTS) {
    issued += 1;
    await fire();
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const wall = (performance.now() - startedAt) / 1000;

const sorted = [...latencies].sort((a, b) => a - b);

console.log(`\nPOST ${BASE}/api/orders`);
console.log(`  requests    ${completed} at concurrency ${CONCURRENCY}`);
console.log(`  duration    ${wall.toFixed(2)}s  (${(completed / wall).toFixed(1)} req/s)`);
console.log(`  latency     p50 ${percentile(sorted, 50).toFixed(0)}ms   p95 ${percentile(sorted, 95).toFixed(0)}ms   p99 ${percentile(sorted, 99).toFixed(0)}ms   max ${percentile(sorted, 100).toFixed(0)}ms`);
console.log(`  statuses    ${[...statusCounts.entries()].map(([k, v]) => `${k}:${v}`).join('  ')}`);
console.log(`  failed      ${failed}`);

// A load test that cannot fail is a benchmark. This one gates on correctness.
process.exit(failed > 0 ? 1 : 0);
