/** Card model for a selected SA population square. Pure — no Cesium types. */

import { formatNumber, t } from '../../i18n/index.js';
import { POPULATION_BANDS, populationBand } from './grid.js';

const LINE_CAP = 90;
const cut = (line) =>
  line.length > LINE_CAP ? `${line.slice(0, LINE_CAP - 1)}…` : line;

/** `people` rounded to 2 significant figures, grouped for the locale. */
export function formatPeople(people) {
  return formatNumber(Number(Number(people).toPrecision(2)));
}

/** The card for one `[south, west, people]` cell; read-only, links nowhere. */
export function buildSaPopulationCard([south, west, people], index, cellDeg) {
  const band = populationBand(people);
  return {
    id: `sa-population-card:${index}`,
    selected: true,
    interactive: false,
    title: cut(
      t('About {people} people in this 10 km square', {
        people: formatPeople(people),
      }),
    ),
    details: [cut(t('Kontur Population 2023 (modelled)'))],
    accent: band >= 0 ? POPULATION_BANDS[band].color : undefined,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
    anchor: { lon: west + cellDeg / 2, lat: south + cellDeg / 2 },
  };
}
