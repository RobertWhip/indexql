/**
 * tests/runner.ts
 * Minimal zero-dependency test runner.
 * Collected via a simple module-level registry; tests run sequentially.
 *
 * Usage: npx ts-node tests/runner.ts
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _tests: TestCase[] = [];

/** Register a named test. */
export function run(name: string, fn: () => void | Promise<void>): void {
  _tests.push({ name, fn });
}

// ── Assertions ────────────────────────────────────────────────────────────────

export function assert(condition: boolean, message = 'Assertion failed'): void {
  if (!condition) throw new Error(message);
}

export function assertEq<T>(actual: T, expected: T, message?: string): void {
  const msg = message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  if (actual !== expected) throw new Error(msg);
}

export function assertThrows(fn: () => unknown, message = 'Expected function to throw'): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(message);
}

// ── Runner ────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';

async function runAll(): Promise<void> {
  // Import test files to populate the registry
  require('./core.test');
  require('./client.test');
  require('./cli.test');

  console.log();
  console.log(`${BOLD}${CYAN}IndexQL Test Suite${RESET}`);
  console.log(`${'─'.repeat(60)}`);

  let passed = 0;
  let failed = 0;
  const failures: { name: string; error: string }[] = [];

  for (const test of _tests) {
    try {
      await test.fn();
      process.stdout.write(`  ${GREEN}✔${RESET} ${DIM}${test.name}${RESET}\n`);
      passed++;
    } catch (err) {
      process.stdout.write(`  ${RED}✖${RESET} ${BOLD}${test.name}${RESET}\n`);
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`    ${RED}${msg}${RESET}\n`);
      failures.push({ name: test.name, error: msg });
      failed++;
    }
  }

  console.log(`${'─'.repeat(60)}`);

  if (failed === 0) {
    console.log(`${GREEN}${BOLD}All ${passed} tests passed.${RESET}\n`);
  } else {
    console.log(`${RED}${BOLD}${failed} test(s) failed.${RESET} ${GREEN}${passed} passed.${RESET}`);
    console.log();
    console.log(`${YELLOW}Failures:${RESET}`);
    failures.forEach(f => console.log(`  • ${f.name}\n    ${RED}${f.error}${RESET}`));
    console.log();
    process.exit(1);
  }
}

// Run when this file is executed directly
if (require.main === module) {
  runAll().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
