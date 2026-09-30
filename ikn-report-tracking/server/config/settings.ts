/** Process configuration, read once, with no secret ever reaching a frontend bundle. */
import type { DataClass } from '../../shared/domain.ts';

export interface Settings {
  port: number;
  nodeEnv: string;
  /** SYNTHETIC keeps the demonstration-data notice on every page and every export. */
  dataClass: DataClass;
  notifyProvider: 'SIMULATION' | 'APPROVED_GATEWAY';
  notifyTestAllowlist: readonly string[];
  /** Origins permitted to call the staff API. Empty means same-origin only. */
  corsOrigins: readonly string[];
}

export function settings(): Settings {
  const dataClass = (process.env.IKN_DATA_CLASS ?? 'SYNTHETIC') as DataClass;
  if (dataClass !== 'SYNTHETIC' && dataClass !== 'LIVE') {
    throw new Error(`IKN_DATA_CLASS must be SYNTHETIC or LIVE, got ${dataClass}`);
  }
  const provider = (process.env.IKN_NOTIFY_PROVIDER ?? 'SIMULATION') as Settings['notifyProvider'];
  return {
    port: Number(process.env.PORT ?? 4180),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    dataClass,
    notifyProvider: provider,
    notifyTestAllowlist: (process.env.IKN_NOTIFY_TEST_ALLOWLIST ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
    corsOrigins: (process.env.IKN_CORS_ORIGINS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** The notice that must appear on every page and export while data is synthetic. */
export const SYNTHETIC_NOTICE = 'Demonstration data — not actual IKN performance.';

export function dataClassNotice(dataClass: DataClass): string | undefined {
  return dataClass === 'SYNTHETIC' ? SYNTHETIC_NOTICE : undefined;
}
