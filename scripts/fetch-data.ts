/**
 * Downloads the open data the simulator uses and writes one snapshot per
 * source to src/data. The site builds and runs from these files, never from
 * the network. Run with `pnpm data`; pass source names to refresh only some.
 */
import { writeFileSync } from 'node:fs';

interface Envelope<T> {
  source: string;
  url: string;
  retrievedAt: string;
  license: string;
  coverage: string;
  records: T;
}

const OUT = new URL('../src/data/', import.meta.url);
const today = new Date().toISOString().slice(0, 10);

async function get(url: string, attempts = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (response.ok) return response;
      last = new Error(`${response.status} ${response.statusText} for ${url}`);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

function save<T>(name: string, envelope: Envelope<T>) {
  writeFileSync(new URL(`${name}.json`, OUT), `${JSON.stringify(envelope)}\n`);
  console.log(`${name}: wrote ${envelope.coverage}`);
}

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/* ---------- JPL Horizons: Earth-Mars distance and Sun-Earth-Mars angle ---------- */

async function horizons() {
  const start = '2026-01-01';
  const stop = '2029-12-31';
  const query = [
    'format=text',
    "COMMAND='499'",
    "OBJ_DATA='NO'",
    "MAKE_EPHEM='YES'",
    "EPHEM_TYPE='OBSERVER'",
    "CENTER='500@399'",
    `START_TIME='${start}'`,
    `STOP_TIME='${stop}'`,
    "STEP_SIZE='1%20d'",
    "QUANTITIES='20,23'",
    "CSV_FORMAT='YES'",
  ].join('&');
  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${query}`;
  const body = await (await get(url)).text();
  const table = body.split('$$SOE')[1]?.split('$$EOE')[0];
  must(table, 'Horizons: no ephemeris table in the response');

  const distanceAu: number[] = [];
  const elongationDeg: number[] = [];
  for (const line of table.trim().split('\n')) {
    const cells = line.split(',').map((cell) => cell.trim());
    const au = Number(cells[3]);
    const angle = Number(cells[5]);
    must(Number.isFinite(au) && au > 0.3 && au < 2.8, `Horizons: bad distance in "${line}"`);
    must(Number.isFinite(angle) && angle >= 0 && angle <= 180, `Horizons: bad angle in "${line}"`);
    distanceAu.push(Number(au.toFixed(5)));
    elongationDeg.push(Number(angle.toFixed(2)));
  }
  must(distanceAu.length > 1400, `Horizons: expected daily rows, got ${distanceAu.length}`);

  save('horizons', {
    source: 'NASA/JPL Horizons',
    url: 'https://ssd.jpl.nasa.gov/api/horizons.api',
    retrievedAt: today,
    license: 'Public domain (NASA/JPL-Caltech); credit JPL Solar System Dynamics',
    coverage: `${start} to ${stop}, daily at 00:00 UT, Mars seen from the center of the Earth`,
    records: { start, stepDays: 1, distanceAu, elongationDeg },
  });
}

/* ---------- NOAA SWPC: GOES X-ray flux and planetary Kp ---------- */

async function swpc() {
  const xrayUrl = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json';
  const kpUrl = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
  const xray = (await (await get(xrayUrl)).json()) as Array<{ time_tag: string; flux: number; energy: string }>;
  const kp = (await (await get(kpUrl)).json()) as Array<{ time_tag: string; Kp: number }>;

  // Peak long-band flux per half hour keeps flares visible in a small file.
  const buckets = new Map<string, number>();
  for (const row of xray) {
    if (row.energy !== '0.1-0.8nm' || !(row.flux > 0)) continue;
    const minute = Number(row.time_tag.slice(14, 16)) < 30 ? '00' : '30';
    const key = `${row.time_tag.slice(0, 14)}${minute}:00Z`;
    buckets.set(key, Math.max(buckets.get(key) ?? 0, row.flux));
  }
  const flux = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([time, value]) => ({ time, wm2: Number(value.toExponential(3)) }));
  must(flux.length > 200, `SWPC: expected a week of X-ray flux, got ${flux.length} points`);

  const protonUrl = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-7-day.json';
  const protonRows = (await (await get(protonUrl)).json()) as Array<{ time_tag: string; flux: number; energy: string }>;
  const protonBuckets = new Map<string, number>();
  for (const row of protonRows) {
    if (row.energy !== '>=10 MeV' || !(row.flux > 0)) continue;
    const minute = Number(row.time_tag.slice(14, 16)) < 30 ? '00' : '30';
    const key = `${row.time_tag.slice(0, 14)}${minute}:00Z`;
    protonBuckets.set(key, Math.max(protonBuckets.get(key) ?? 0, row.flux));
  }
  const protons = [...protonBuckets].sort(([a], [b]) => a.localeCompare(b)).map(([time, value]) => ({ time, pfu: Number(value.toPrecision(4)) }));
  must(protons.length > 200, `SWPC: expected a week of proton flux, got ${protons.length} points`);

  const index = kp
    .filter((row) => Number.isFinite(Number(row.Kp)))
    .map((row) => ({ time: `${row.time_tag}Z`, kp: Number(row.Kp) }));
  must(index.length > 20, `SWPC: expected Kp values, got ${index.length}`);

  save('swpc', {
    source: 'NOAA Space Weather Prediction Center',
    url: 'https://services.swpc.noaa.gov/json/',
    retrievedAt: today,
    license: 'Public domain (U.S. Government work, NOAA)',
    coverage: `${flux[0].time.slice(0, 10)} to ${flux.at(-1)!.time.slice(0, 10)}: GOES 0.1-0.8 nm X-ray flux and >=10 MeV proton flux (30-minute peaks), planetary Kp (3-hourly)`,
    records: { xray: flux, protons, kp: index },
  });
}

/* ---------- NASA DONKI: solar energetic particle events ---------- */

async function donki() {
  const key = process.env.NASA_API_KEY ?? 'DEMO_KEY';
  const events: Array<{ id: string; time: string; instruments: string[]; linked: string[]; link: string }> = [];
  const end = new Date(`${today}T00:00:00Z`);
  const firstStart = new Date(end);
  // The API accepts at most 60 days per request.
  for (let chunk = 0; chunk < 8; chunk++) {
    const stop = new Date(end.getTime() - chunk * 60 * 86_400_000);
    const start = new Date(stop.getTime() - 59 * 86_400_000);
    firstStart.setTime(start.getTime());
    const url = `https://api.nasa.gov/DONKI/SEP?startDate=${start.toISOString().slice(0, 10)}&endDate=${stop.toISOString().slice(0, 10)}&api_key=${key}`;
    let text: string;
    try {
      text = await (await get(url, 1)).text();
    } catch (error) {
      // The demo key allows few requests per hour: keep what was read so far.
      if (events.length === 0) throw error;
      firstStart.setTime(stop.getTime());
      break;
    }
    if (text.trim() === '') continue;
    const rows = JSON.parse(text) as Array<{
      sepID: string;
      eventTime: string;
      instruments?: Array<{ displayName: string }>;
      linkedEvents?: Array<{ activityID: string }> | null;
      link: string;
    }>;
    for (const row of rows) {
      must(typeof row.sepID === 'string' && typeof row.eventTime === 'string', 'DONKI: unexpected SEP record');
      events.push({
        id: row.sepID,
        time: row.eventTime,
        instruments: (row.instruments ?? []).map((instrument) => instrument.displayName),
        linked: (row.linkedEvents ?? []).map((event) => event.activityID),
        link: row.link,
      });
    }
  }
  events.sort((a, b) => a.time.localeCompare(b.time));
  must(events.length > 0, 'DONKI: no SEP events in the period');

  save('donki', {
    source: 'NASA DONKI (Space Weather Database Of Notifications, Knowledge, Information)',
    url: 'https://api.nasa.gov/DONKI/SEP',
    retrievedAt: today,
    license: 'Public domain (NASA); credit CCMC/DONKI',
    coverage: `${firstStart.toISOString().slice(0, 10)} to ${today}: ${events.length} solar energetic particle events`,
    records: events,
  });
}

/* ---------- NASA DSN Now: antennas and the spacecraft they track ---------- */

async function dsn() {
  const url = 'https://eyes.nasa.gov/dsn/data/dsn.xml';
  const xml = await (await get(url)).text();
  const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
  const dishes: Array<{ dish: string; station: string; target: string; downBps: number; upBps: number; rangeKm: number; rtltSeconds: number }> = [];
  let station = '';
  for (const block of xml.split(/(?=<station |<dish )/)) {
    if (block.startsWith('<station ')) {
      station = attr(block, 'friendlyName');
      continue;
    }
    if (!block.startsWith('<dish ')) continue;
    const target = /<target [^>]*>/.exec(block)?.[0];
    if (!target) continue;
    const rates = (kind: string) =>
      [...block.matchAll(new RegExp(`<${kind} [^>]*>`, 'g'))]
        .filter((match) => attr(match[0], 'active') === 'true')
        .map((match) => Number(attr(match[0], 'dataRate')))
        .filter((rate) => rate > 0);
    dishes.push({
      dish: attr(block, 'name'),
      station,
      target: attr(target, 'name'),
      downBps: Math.max(0, ...rates('downSignal')),
      upBps: Math.max(0, ...rates('upSignal')),
      rangeKm: Number(attr(target, 'downlegRange')),
      rtltSeconds: Number(attr(target, 'rtlt')),
    });
  }
  must(dishes.length > 0, 'DSN Now: no dishes in the feed');
  const time = Number(/timeUTC="(\d+)"/.exec(xml)?.[1] ?? Date.now());

  save('dsn', {
    source: 'NASA Deep Space Network Now',
    url,
    retrievedAt: today,
    license: 'Public domain (NASA/JPL-Caltech)',
    coverage: `One reading of the network at ${new Date(time).toISOString().slice(0, 16)}Z: ${dishes.length} antennas with a target`,
    records: dishes,
  });
}

const sources: Record<string, () => Promise<void>> = { horizons, swpc, donki, dsn };
const wanted = process.argv.slice(2);
let failed = 0;
for (const [name, run] of Object.entries(sources)) {
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  try {
    await run();
  } catch (error) {
    failed += 1;
    // A source that is down keeps its previous snapshot.
    console.error(`${name}: not updated: ${error instanceof Error ? error.message : error}`);
  }
}
process.exitCode = failed > 0 ? 1 : 0;
