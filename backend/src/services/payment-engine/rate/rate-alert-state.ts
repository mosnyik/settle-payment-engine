import { promises as fs } from 'fs';
import path from 'path';

export interface RateOutcome {
  lastSuccessAt?: number;
  failedAt?: number;
  error?: string;
}

export interface AlertState {
  monitoringStartedAt: number;
  incidentOpen?: boolean;
  lastAlertAt?: number;
}

export async function readState<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeState(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}

export type AlertDecision = { kind: 'failure' | 'stale' | 'recovery'; detail: string };

export function decideAlert(
  outcome: RateOutcome | undefined,
  state: AlertState,
  now: number,
  staleAfterMs: number,
  cooldownMs: number,
): AlertDecision | undefined {
  const lastSuccess = outcome?.lastSuccessAt ?? state.monitoringStartedAt;
  const failed = outcome?.failedAt !== undefined;
  const stale = now - lastSuccess >= staleAfterMs;
  if (!failed && !stale) {
    if (state.incidentOpen && outcome?.lastSuccessAt !== undefined) {
      return { kind: 'recovery', detail: `Updates resumed at ${new Date(outcome.lastSuccessAt).toISOString()}.` };
    }
    return;
  }
  if (state.lastAlertAt !== undefined && now - state.lastAlertAt < cooldownMs) return;
  return failed
    ? { kind: 'failure', detail: `Update failed at ${new Date(outcome!.failedAt!).toISOString()}: ${outcome?.error || 'Unknown error'}` }
    : { kind: 'stale', detail: outcome?.lastSuccessAt
      ? `No successful update since ${new Date(lastSuccess).toISOString()}.`
      : `No successful update observed since monitoring started at ${new Date(lastSuccess).toISOString()}.` };
}
