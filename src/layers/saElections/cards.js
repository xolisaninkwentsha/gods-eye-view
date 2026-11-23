/** Card models for selected SA election areas. Pure — no Cesium types. */

import { t, formatNumber } from '../../i18n/index.js';
import { droneAirspaceAnchorDegrees } from '../droneAirspace/cards.js';
import { saAreaColor } from './records.js';
import { partyStyle } from './parties.js';

const NEUTRAL = '#9aa4ad';
const ONE_DIGIT = { maximumFractionDigits: 1, minimumFractionDigits: 1 };

const pct = (share) => formatNumber(share, { style: 'percent', ...ONE_DIGIT });

/** Anchor point for a card: centroid of the largest polygon's outer ring. */
export function saAnchorDegrees(polygons) {
  return droneAirspaceAnchorDegrees(polygons);
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

function statusDetails(status) {
  if (status === 'ok' || status === 'stale') return null;
  if (status === 'off') return [t('Results are off')];
  if (status === 'loading') return [t('Downloading results from the IEC…')];
  return [t('IEC results unavailable')];
}

/** The one-line reason results are missing (off, loading, failed), or null for ok and stale. */
export function saStatusLine(status) {
  return statusDetails(status)?.[0] ?? null;
}

/**
 * An area with a result shows it whatever the status: while a download runs, the provinces
 * already read are served. Only an area without one says why (or, with results in, that it has none).
 */
export function buildSaCouncilCard(row, status) {
  const title = `${row.name} (${row.code})`;
  const id = `sa-council-card:${row.stableId}`;
  const accent = saAreaColor(row, 'councils').color ?? NEUTRAL;
  const result = row.result;
  if (!result) {
    const why = statusDetails(status) ?? [t('No result for this council')];
    return entry(id, title, why, accent);
  }
  if (!result.largest)
    return entry(id, title, [t('Seat count unavailable')], accent);

  const { party, seats } = result.largest;
  const short = partyStyle(party).short;
  const details = [
    t('{party} · {seats} of {total} seats', {
      party: short,
      seats,
      total: result.totalSeats,
    }),
    result.majority ? t('Majority') : t('No majority'),
  ];
  const parties = Array.isArray(result.parties) ? result.parties : [];
  const top = parties
    .filter((p) => p.seats != null)
    .slice(0, 3)
    .map((p) => `${partyStyle(p.party).short} ${p.seats}`);
  if (top.length) details.push(top.join(' · '));
  const lead = parties.find((p) => p.party === party);
  if (Number.isFinite(lead?.prShare)) {
    details.push(
      t('{party} PR vote {share}', { party: short, share: pct(lead.prShare) }),
    );
  }
  if (Number.isFinite(result.turnout))
    details.push(t('Turnout {share}', { share: pct(result.turnout) }));
  return entry(id, title, details, accent);
}

export function buildSaWardCard(row, status) {
  const title = `${row.name} · ${row.municipality}`;
  const id = `sa-ward-card:${row.stableId}`;
  const accent = saAreaColor(row, 'wards').color ?? NEUTRAL;
  const result = row.result;
  if (!result) {
    const why = statusDetails(status) ?? [t('No result for this ward')];
    return entry(id, title, why, accent);
  }
  if (result.tie || !result.winner) return entry(id, title, [t('Tie')], accent);

  const details = [
    `${partyStyle(result.winner.party).short} ${pct(result.winner.share)}`,
  ];
  if (result.runnerUp) {
    details.push(
      t('Runner-up {party} {share}', {
        party: partyStyle(result.runnerUp.party).short,
        share: pct(result.runnerUp.share),
      }),
    );
  }
  if (Number.isFinite(result.margin)) {
    details.push(
      t('Margin {points} points', {
        points: formatNumber(result.margin * 100, ONE_DIGIT),
      }),
    );
  }
  if (Number.isFinite(result.turnout))
    details.push(t('Turnout {share}', { share: pct(result.turnout) }));
  if (!result.confirmed)
    details.push(t('Unconfirmed: does not match the IEC seat count'));
  return entry(id, title, details, accent);
}
