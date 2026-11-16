import snapshot from '../../data/horizons.json';

/** Seconds light takes to cross one astronomical unit. */
export const LIGHT_SECONDS_PER_AU = 499.004784;
/**
 * Sun-Earth-Mars angle under which the Sun's corona disturbs the radio link.
 * NASA suspends commanding of its Mars missions when Mars is within 2 degrees
 * of the Sun.
 */
export const CONJUNCTION_DEG = 2;

const DAY_MS = 86_400_000;

export interface EphemerisTable {
  start: string;
  stepDays: number;
  distanceAu: number[];
  elongationDeg: number[];
}

export interface MissionDay {
  date: string;
  distanceAu: number;
  distanceKm: number;
  /** One-way light time between Earth and Mars, in seconds. */
  lightSeconds: number;
  elongationDeg: number;
  /** The Sun is close enough to the line of sight to interrupt the link. */
  blackout: boolean;
}

export interface Blackout {
  start: string;
  /** First day on which the link is usable again. */
  end: string;
  days: number;
}

export const ephemeris: EphemerisTable = snapshot.records;
export const horizonsSnapshot = { ...snapshot, records: undefined };

const KM_PER_AU = 149_597_870.7;
const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dateAt = (table: EphemerisTable, index: number) =>
  new Date(dayOf(table.start) + index * table.stepDays * DAY_MS).toISOString().slice(0, 10);

export function coverage(table: EphemerisTable = ephemeris): { start: string; end: string } {
  return { start: table.start, end: dateAt(table, table.distanceAu.length - 1) };
}

/** The table row for a date, or null when the date is outside the snapshot. */
export function missionDay(date: string, table: EphemerisTable = ephemeris): MissionDay | null {
  const index = Math.round((dayOf(date) - dayOf(table.start)) / (table.stepDays * DAY_MS));
  if (!Number.isInteger(index) || index < 0 || index >= table.distanceAu.length) return null;
  const distanceAu = table.distanceAu[index];
  const elongationDeg = table.elongationDeg[index];
  return {
    date: dateAt(table, index),
    distanceAu,
    distanceKm: distanceAu * KM_PER_AU,
    lightSeconds: distanceAu * LIGHT_SECONDS_PER_AU,
    elongationDeg,
    blackout: elongationDeg < CONJUNCTION_DEG,
  };
}

/** Every stretch of days in the table during which the Sun blocks the link. */
export function blackouts(table: EphemerisTable = ephemeris): Blackout[] {
  const found: Blackout[] = [];
  let open: number | null = null;
  table.elongationDeg.forEach((angle, index) => {
    const blocked = angle < CONJUNCTION_DEG;
    if (blocked && open === null) open = index;
    if (!blocked && open !== null) {
      found.push({ start: dateAt(table, open), end: dateAt(table, index), days: (index - open) * table.stepDays });
      open = null;
    }
  });
  return found;
}

/** The blackout that contains the date, if any. */
export function blackoutOn(date: string, table: EphemerisTable = ephemeris): Blackout | null {
  return blackouts(table).find((window) => date >= window.start && date < window.end) ?? null;
}
