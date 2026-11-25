/** Card model for a selected SA health facility or school. Pure — no Cesium types. */

import { t } from '../../i18n/index.js';
import { FACILITY_CLASSES, SCHOOL_LEVEL_LABELS } from './records.js';

const LINE_CAP = 90;
const cut = (line) =>
  line.length > LINE_CAP ? `${line.slice(0, LINE_CAP - 1)}…` : line;

const CARD_ID_PREFIX = Object.freeze({
  health: 'sa-health-facilities-card',
  schools: 'sa-schools-card',
});

const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : '');

/** The card for one record; it is read-only and links nowhere. */
export function buildSaFacilityCard(set, record) {
  const classes = FACILITY_CLASSES[set];
  const details = [];
  let title;
  let cls;
  if (set === 'health') {
    cls = classes.find((c) => c.key === record.kind);
    const label = cls ? t(cls.label) : '';
    title =
      text(record.name) ||
      t('Unnamed {kind}', { kind: label.toLocaleLowerCase() });
    if (label) details.push(label);
    const who = text(record.operator) || text(record.city);
    if (who) details.push(who);
    details.push(t('OpenStreetMap via healthsites.io'));
  } else {
    cls = classes.find((c) => c.key === record.connectivity);
    title = text(record.name) || t('Unnamed school');
    const level = text(record.level);
    // "Unknown" is no information; a level the table lacks shows as sent.
    if (level && level !== 'Unknown')
      details.push(
        Object.hasOwn(SCHOOL_LEVEL_LABELS, level)
          ? t(SCHOOL_LEVEL_LABELS[level])
          : level,
      );
    details.push(
      t('Internet: {state}', {
        state: cls ? t(cls.label).toLocaleLowerCase() : '',
      }),
    );
    details.push(t('Giga school data (ITU–UNICEF)'));
  }
  return {
    id: `${CARD_ID_PREFIX[set]}:${record.id}`,
    selected: true,
    interactive: false,
    title: cut(title),
    details: details.map(cut),
    accent: cls?.color,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}
