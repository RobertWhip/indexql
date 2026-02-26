// ── ANSI escape codes ────────────────────────────────────────────────────────

export const RESET  = '\x1b[0m';
export const BOLD   = '\x1b[1m';
export const DIM    = '\x1b[2m';
export const RED    = '\x1b[31m';
export const GREEN  = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const CYAN   = '\x1b[36m';

// ── Inline color wrappers ────────────────────────────────────────────────────

export const bold   = (s: string) => `${BOLD}${s}${RESET}`;
export const dim    = (s: string) => `${DIM}${s}${RESET}`;
export const red    = (s: string) => `${RED}${s}${RESET}`;
export const green  = (s: string) => `${GREEN}${s}${RESET}`;
export const yellow = (s: string) => `${YELLOW}${s}${RESET}`;
export const cyan   = (s: string) => `${CYAN}${s}${RESET}`;

// ── Display helpers ──────────────────────────────────────────────────────────

/** Print a horizontal rule with a label. */
export function hr(label: string, width = 58): void {
  const pad = '─'.repeat(Math.max(0, width - label.length));
  console.log(`\n${bold(`── ${label} ${pad}`)}`);
}

/** Print a label-value row, left-padded. */
export function row(label: string, value: string, labelWidth = 26): void {
  console.log(`  ${label.padEnd(labelWidth)} ${value}`);
}

// ── Structured logger ────────────────────────────────────────────────────────

export const log = {
  info:    (msg: string) => console.log(`${CYAN}ℹ${RESET}  ${msg}`),
  success: (msg: string) => console.log(`${GREEN}✔${RESET}  ${msg}`),
  warn:    (msg: string) => console.log(`${YELLOW}⚠${RESET}  ${msg}`),
  error:   (msg: string) => console.error(`${RED}✖${RESET}  ${msg}`),
  bold:    (msg: string) => console.log(`${BOLD}${msg}${RESET}`),
  dim:     (msg: string) => console.log(`${DIM}${msg}${RESET}`),
  blank:   ()            => console.log(),
};

// ── Unit formatting ──────────────────────────────────────────────────────────

/** Format bytes as human-readable string. */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

/** Format milliseconds as human-readable string. */
export function fmtMs(ms: number): string {
  return ms < 1 ? `<1 ms` : `${ms.toFixed(2)} ms`;
}
