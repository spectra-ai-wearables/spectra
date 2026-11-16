import snapshot from '../../data/dsn.json';

export interface Antenna {
  dish: string;
  station: string;
  target: string;
  downBps: number;
  upBps: number;
  rangeKm: number;
  rtltSeconds: number;
}

export const antennas: Antenna[] = snapshot.records;
export const dsnSnapshot = { ...snapshot, records: undefined };

/** Antennas that were receiving data from a spacecraft when the snapshot was taken. */
export function activeDownlinks(list: Antenna[] = antennas): Antenna[] {
  return list.filter((antenna) => antenna.downBps > 0);
}

/**
 * The slowest downlink in use in the snapshot. The simulator takes it as its
 * link rate: a deliberately modest figure that a real antenna was carrying.
 */
export function slowestDownlink(list: Antenna[] = antennas): Antenna | null {
  const active = activeDownlinks(list);
  return active.length === 0 ? null : active.reduce((best, antenna) => (antenna.downBps < best.downBps ? antenna : best));
}

/** Used when the snapshot holds no active downlink. */
export const FALLBACK_BPS = 8000;

export function linkBytesPerSecond(list: Antenna[] = antennas): number {
  return (slowestDownlink(list)?.downBps ?? FALLBACK_BPS) / 8;
}
