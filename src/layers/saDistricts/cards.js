/** Card models for selected SA district outlines. Pure — no Cesium types. */

import { t } from '../../i18n/index.js';
import { governanceLines } from '../saGovernance/views.js';

// Overlay cards do not wrap lines, so each text line stays short.
const LINE_CAP = 90;
export const SA_DISTRICT_LISTED_COLOR = '#eb5757';
export const SA_DISTRICT_COLOR = '#d0d7de';
export const SA_DISTRICTS_OVERLAY_SOURCE_ID = 'sa-districts-2026';

function cut(text) {
  return text.length > LINE_CAP ? `${text.slice(0, LINE_CAP - 1)}…` : text;
}

function entry(id, title, details, accent) {
  return {
    id,
    selected: true,
    interactive: false,
    title,
    details,
    accent,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** "Councils: a, b, … (+N)": as many names as fit in the line cap. */
function councilsLine(members) {
  const names = members.map((m) => m.name);
  const line = (list) => t('Councils: {list}', { list });
  const full = line(names.join(', '));
  if (full.length <= LINE_CAP) return full;
  for (let shown = names.length - 1; shown >= 0; shown--) {
    const more = t('… (+{n})', { n: names.length - shown });
    const list = [...names.slice(0, shown), more].join(', ');
    const candidate = line(list);
    if (candidate.length <= LINE_CAP) return candidate;
  }
  return cut(line(t('… (+{n})', { n: names.length })));
}

/**
 * The card for one district: where it is, which councils it holds, then the
 * governance lines. `gov` is null when governance data is unavailable.
 */
export function buildSaDistrictCard(area, gov) {
  const details = [area.province];
  details.push(
    area.category === 'A'
      ? t('Metro (also a council)')
      : t('District municipality'),
  );
  if (area.category !== 'A' && area.members?.length)
    details.push(councilsLine(area.members));
  details.push(
    ...(gov ? governanceLines(area.code, gov) : [t('Audit: unavailable')]),
  );
  return entry(
    `sa-district-card:${area.code}`,
    cut(`${area.name} (${area.code})`),
    details.filter((line) => typeof line === 'string' && line).map(cut),
    gov?.interventions.has(area.code)
      ? SA_DISTRICT_LISTED_COLOR
      : SA_DISTRICT_COLOR,
  );
}
