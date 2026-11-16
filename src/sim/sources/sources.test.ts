import { describe, expect, test } from 'vitest';
import { activeDownlinks, antennas, linkBytesPerSecond, slowestDownlink, FALLBACK_BPS } from './dsn';
import type { Antenna } from './dsn';
import { CONJUNCTION_DEG, LIGHT_SECONDS_PER_AU, blackoutOn, blackouts, coverage, ephemeris, missionDay } from './horizons';
import type { EphemerisTable } from './horizons';
import { flareClass, latestParticleEvent, particleEvents, peakFlux, peakKp, peakProtons, stormLevel, xrayFlux } from './spaceWeather';

const table: EphemerisTable = {
  start: '2030-01-01',
  stepDays: 1,
  distanceAu: [1, 1.5, 2, 2.4, 2.4, 2.3],
  elongationDeg: [40, 10, 1.9, 0.5, 1.2, 6],
};

describe('horizons', () => {
  test('converts a row into distance and one-way light time', () => {
    const day = missionDay('2030-01-02', table)!;
    expect(day.distanceAu).toBe(1.5);
    expect(day.lightSeconds).toBeCloseTo(1.5 * LIGHT_SECONDS_PER_AU, 6);
    expect(day.distanceKm).toBeCloseTo(224_396_806, -1);
    expect(day.blackout).toBe(false);
  });

  test('returns null outside the table', () => {
    expect(missionDay('2029-12-31', table)).toBeNull();
    expect(missionDay('2030-01-07', table)).toBeNull();
  });

  test('finds the stretch where the Sun blocks the link', () => {
    expect(blackouts(table)).toEqual([{ start: '2030-01-03', end: '2030-01-06', days: 3 }]);
    expect(blackoutOn('2030-01-04', table)?.end).toBe('2030-01-06');
    expect(blackoutOn('2030-01-06', table)).toBeNull();
    expect(missionDay('2030-01-03', table)?.blackout).toBe(true);
  });

  test('the snapshot is daily, in range, and holds a conjunction', () => {
    expect(ephemeris.distanceAu).toHaveLength(ephemeris.elongationDeg.length);
    expect(Math.min(...ephemeris.distanceAu)).toBeGreaterThan(0.37);
    expect(Math.max(...ephemeris.distanceAu)).toBeLessThan(2.68);
    const range = coverage();
    expect(missionDay(range.start)).not.toBeNull();
    expect(missionDay(range.end)).not.toBeNull();
    const windows = blackouts();
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) expect(missionDay(window.start)!.elongationDeg).toBeLessThan(CONJUNCTION_DEG);
  });

  test('light time in the snapshot stays between 3 and 23 minutes', () => {
    const minutes = ephemeris.distanceAu.map((au) => (au * LIGHT_SECONDS_PER_AU) / 60);
    expect(Math.min(...minutes)).toBeGreaterThan(3);
    expect(Math.max(...minutes)).toBeLessThan(23);
  });
});

describe('space weather', () => {
  test('names flare classes the way NOAA does', () => {
    expect(flareClass(1.78e-5)).toBe('M1.8');
    expect(flareClass(2e-4)).toBe('X2.0');
    expect(flareClass(3.2e-6)).toBe('C3.2');
    expect(flareClass(5e-8)).toBe('A5.0');
  });

  test('grades radiation storms from the proton flux', () => {
    expect(stormLevel(0.5)).toBe(0);
    expect(stormLevel(10)).toBe(1);
    expect(stormLevel(450)).toBe(2);
    expect(stormLevel(1e7)).toBe(5);
  });

  test('finds the peaks of a series', () => {
    expect(peakFlux([{ time: 'a', wm2: 1e-6 }, { time: 'b', wm2: 4e-5 }]).time).toBe('b');
    expect(peakProtons([{ time: 'a', pfu: 3 }, { time: 'b', pfu: 1 }]).time).toBe('a');
    expect(peakKp([{ time: 'a', kp: 2 }, { time: 'b', kp: 6.33 }]).kp).toBe(6.33);
  });

  test('merges the per-instrument records of one particle event', () => {
    const record = (id: string, time: string, instrument: string) => ({ id, time, instruments: [instrument], linked: ['FLR-1'], link: '' });
    const merged = particleEvents([record('b', '2030-02-01T10:00Z', 'GOES'), record('a', '2030-01-01T10:00Z', 'SOHO'), record('c', '2030-02-01T10:00Z', 'ACE')]);
    expect(merged.map((event) => event.id)).toEqual(['a', 'b']);
    expect(merged[1].instruments).toEqual(['GOES', 'ACE']);
    expect(merged[1].linked).toEqual(['FLR-1']);
  });

  test('the snapshots hold a week of flux and at least one particle event', () => {
    expect(xrayFlux.length).toBeGreaterThan(200);
    expect(xrayFlux.every((point) => point.wm2 > 0)).toBe(true);
    expect(latestParticleEvent()?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('dsn', () => {
  const dish = (name: string, downBps: number): Antenna => ({ dish: name, station: 'Madrid', target: 'X', downBps, upBps: 0, rangeKm: 1, rtltSeconds: 1 });

  test('takes the slowest downlink in use as the link rate', () => {
    const list = [dish('A', 0), dish('B', 16_000), dish('C', 2_000_000)];
    expect(activeDownlinks(list).map((antenna) => antenna.dish)).toEqual(['B', 'C']);
    expect(slowestDownlink(list)?.dish).toBe('B');
    expect(linkBytesPerSecond(list)).toBe(2000);
  });

  test('falls back when nothing is being received', () => {
    expect(slowestDownlink([dish('A', 0)])).toBeNull();
    expect(linkBytesPerSecond([])).toBe(FALLBACK_BPS / 8);
  });

  test('the snapshot lists antennas', () => {
    expect(antennas.length).toBeGreaterThan(0);
    expect(linkBytesPerSecond()).toBeGreaterThan(0);
  });
});