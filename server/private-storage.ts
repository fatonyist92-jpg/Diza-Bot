// Small, boring persistence primitives for DIZA-owned local state.
// Keep schemas where they already live; this module only makes writes
// private and crash-safer without turning storage into a new subsystem.
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export function atomicPrivateWrite(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch { /* non-POSIX filesystem */ }
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

export function privateAppendOptions(): { mode: number } {
  return { mode: 0o600 };
}
