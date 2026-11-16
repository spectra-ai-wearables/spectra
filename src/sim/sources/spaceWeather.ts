import donki from '../../data/donki.json';
import swpc from '../../data/swpc.json';

export interface FluxPoint {
  time: string;
  /** GOES long-band X-ray flux, in W/m². */
  wm2: number;
}

export interface ProtonPoint {
  time: string;
  /** Protons of 10 MeV and above, in particle flux units. */
  pfu: number;
}

export interface KpPoint {
  time: string;
  kp: number;
}

export const xrayFlux: FluxPoint[] = swpc.records.xray;
export const protonFlux: ProtonPoint[] = swpc.records.protons;
export const kpIndex: KpPoint[] = swpc.records.kp;
export const swpcSnapshot = { ...swpc, records: undefined };
export const donkiSnapshot = { ...donki, records: undefined };

/** A solar energetic particle event as catalogued by NASA DONKI. */
export interface ParticleEvent {
  id: string;
  /** Onset, in UT. */
  time: string;
  /** Instruments that detected it; DONKI files one record per instrument. */
  instruments: string[];
  /** The flare and coronal mass ejection it is linked to. */
  linked: string[];
  link: string;
}

/** DONKI records merged by onset time, oldest first. */
export function particleEvents(records: ParticleEvent[] = donki.records): ParticleEvent[] {
  const byTime = new Map<string, ParticleEvent>();
  for (const record of records) {
    const known = byTime.get(record.time);
    if (!known) {
      byTime.set(record.time, { ...record, instruments: [...record.instruments], linked: [...record.linked] });
      continue;
    }
    known.instruments.push(...record.instruments.filter((name) => !known.instruments.includes(name)));
    known.linked.push(...record.linked.filter((name) => !known.linked.includes(name)));
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function latestParticleEvent(records: ParticleEvent[] = donki.records): ParticleEvent | null {
  return particleEvents(records).at(-1) ?? null;
}

/**
 * NOAA's solar radiation storm scale starts at S1, when protons of 10 MeV and
 * above reach 10 pfu, and grows tenfold per level up to S5.
 */
export const STORM_FLOOR_PFU = 10;

/** NOAA flare class for a long-band X-ray flux, such as "M2.4". */
export function flareClass(wm2: number): string {
  const scale: Array<[string, number]> = [['X', 1e-4], ['M', 1e-5], ['C', 1e-6], ['B', 1e-7]];
  for (const [letter, floor] of scale) {
    if (wm2 >= floor) return `${letter}${(wm2 / floor).toFixed(1)}`;
  }
  return `A${(wm2 / 1e-8).toFixed(1)}`;
}

/** NOAA radiation storm level for a proton flux: 0 when below S1, up to 5. */
export function stormLevel(pfu: number): number {
  if (pfu < STORM_FLOOR_PFU) return 0;
  return Math.min(5, Math.floor(Math.log10(pfu)));
}

export function peakFlux(series: FluxPoint[] = xrayFlux): FluxPoint {
  return series.reduce((best, point) => (point.wm2 > best.wm2 ? point : best));
}

export function peakProtons(series: ProtonPoint[] = protonFlux): ProtonPoint {
  return series.reduce((best, point) => (point.pfu > best.pfu ? point : best));
}

export function peakKp(series: KpPoint[] = kpIndex): KpPoint {
  return series.reduce((best, point) => (point.kp > best.kp ? point : best));
}
