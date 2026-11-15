/** Site root with a trailing slash, so links work under the GitHub Pages base path. */
export const home = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/`;

export const site = {
  name: 'Spectra',
  title: 'Spectra — on-board AI health monitoring for astronauts',
  description:
    'A multispectral wearable and on-board machine learning that help astronauts notice changes in their own health, even without a link to Earth.',
  emails: ['me@borerto.com', 'me@baliestri.dev'],
  repoUrl: 'https://github.com/spectra-ai-wearables/spectra',
  nasaSource: {
    label: 'NASA — The Human Body in Space',
    url: 'https://www.nasa.gov/humans-in-space/the-human-body-in-space/',
  },
};
