const buckets = new Map();

const CLEANUP_INTERVAL_MS = 60_000;
const IDLE_TIMEOUT_MS = 300_000;

export function checkRateLimit(toolName, scope, config = {}) {
  const capacity = config.capacity ?? 30;
  const refillPerSec = config.refillPerSec ?? 2;
  const key = `${scope.scope_id}:${toolName}`;

  let bucket = buckets.get(key);
  const now = Date.now();

  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    buckets.set(key, bucket);
  }

  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSec);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const e = new Error(`RATE_LIMITED: Tool "${toolName}" capacity exceeded. Try again shortly.`);
    e.code = 429;
    e.expose = true;
    throw e;
  }

  bucket.tokens -= 1;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > IDLE_TIMEOUT_MS) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);
