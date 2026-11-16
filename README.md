# Spectra

A screenless wristband and an onboard server that help astronauts notice changes in their own health, even when Earth is out of reach. Built for the NASA Space Apps Challenge.

- Site: https://spectra-ai-wearables.github.io/spectra/
- Mission simulator: https://spectra-ai-wearables.github.io/spectra/demo/

## What is real and what is not

| Part | Status |
|---|---|
| Wristband and onboard server | Design proposal. The images are concept renders, not manufactured hardware. |
| Physiological readings | Synthetic, generated in the browser. No open record of an astronaut's continuous heart rate exists. |
| Neural network and statistical baseline | Running. Trained and evaluated on synthetic sessions only. |
| Light time, solar blackouts, space weather, link rate | Open data, from dated snapshots in `src/data`. |
| Spectra Link | Proposal, played out in the simulator. It does not implement the network standards it names. |

Spectra asks for a check. It does not diagnose, and a deviation score is not a probability of illness.

## Open data

`pnpm data` downloads each source, validates it and writes a snapshot to `src/data`. The site builds and runs from those files, never from the network.

| Source | Used for |
|---|---|
| [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Earth to Mars distance and Sun-Earth-Mars angle per day: one-way light time and solar blackouts |
| [NOAA SWPC](https://www.swpc.noaa.gov/) | GOES X-ray flux, proton flux and planetary Kp for the space weather panel |
| [NASA DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) | Solar energetic particle events: the date of the solar particle scenario |
| [NASA DSN Now](https://eyes.nasa.gov/apps/dsn-now/) | The slowest downlink in use, taken as the link rate |

DONKI needs a NASA API key for more than a few requests. Put `NASA_API_KEY=...` in the environment before running `pnpm data donki`. Keep the key out of the repository; `.env` files are ignored.

Two sources were evaluated and not used: NASA's Open Science Data Repository has no continuous astronaut heart rate, and we could not extract heart rate reliably from PhysioNet's wrist PPG recordings in the time we had.

## Develop

Use Node.js 24 and the package manager pinned in `package.json`.

```sh
pnpm install
pnpm dev        # http://localhost:4321/spectra/
pnpm check      # types
pnpm test       # simulator, model and controller
pnpm build
pnpm preview
pnpm train      # retrain the model and rewrite the evaluation
pnpm data       # refresh the open data snapshots
```

## How the simulator is put together

- `src/sim` holds the engine, with no DOM: session generator, quality check, monitors, likely cause, incidents, link, ledger and the ground's copy of the model.
- `src/sim/scenarios` holds one file per scenario, each with a fixed seed and an expected result that a test checks.
- `src/sim/sources` turns the snapshots in `src/data` into the values the engine needs.
- `src/ml` holds the network, its training and its evaluation.
- `src/demo` connects the engine to the page.
- `src/terms.ts` holds every technique the site names, with the real parameters read from the code.

Missing readings are never replaced with zero. A discarded window is shown as discarded, on board and on the ground.

## Use of artificial intelligence

- **Images.** Every image in `src/assets` was generated or edited with an AI image tool from the team's design direction. No NASA logo or mark appears in them.
- **Code and copy.** An AI coding assistant (Claude Code) wrote most of the code, tests and site copy under the team's direction and review.
- **Data.** No dataset here is AI-generated. The physiological readings come from a deterministic simulator in `src/sim/generator.ts`; the open data snapshots are stored as downloaded, reduced in resolution.

## Deploy

A push to `main` runs the tests, builds the site and publishes it to GitHub Pages through `.github/workflows/deploy.yml`. The base path is `/spectra/`.
