# Spectra

Screenless sensing and onboard intelligence for astronaut health monitoring.

## Develop

Use Node.js 24 and the package manager pinned in `package.json`.

```sh
pnpm install
pnpm dev
```

The GitHub Pages base path is `/spectra/`:

- Home: `/spectra/`
- Mission simulator: `/spectra/demo/`

```sh
pnpm check
pnpm test
pnpm build
pnpm preview
```

## Experience

The home introduces the wristband and onboard server, with responsive product imagery, expandable component explanations, keyboard-operated blueprint tabs and full-size image viewing. Image dialogs close with Escape and return focus to their opener. Reduced-motion preferences disable animation.

The simulator is a separate page. Choose a scenario, then start the session. Playback advances ten simulated seconds per real second. Pause, resume, restart, review session insights, inspect system logs or interrupt the Earth link. Events remain on board until the simulated link can deliver them.

The existing neural network and statistical baseline remain intact. Both run on synthetic data. The hardware imagery illustrates proposed designs, not manufactured or flight-certified equipment.

## Assets and copy

Source images live in `src/assets`. Astro generates responsive WebP assets at build time; diagrams retain their original proportions and full-resolution enlargement. The two clean exploded views were generated with the built-in imagegen tool. See `docs/image-prompts.md` for the edit prompt.

Product explanations are HTML rather than text baked into promotional images. Keep the English copy concise, explain each action and state, and avoid em dashes. Do not replace missing readings with zero or imply that a deviation score is a diagnosis.

No deployment is required for local development. The existing GitHub Actions workflow publishes the static build after a push to the configured branch.
