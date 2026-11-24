import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf } from '../../render/rendererOf.js';
import { cssColor } from '../../render/color.js';
import { inputFor as defaultInputFor } from '../../input/dispatcher.js';
import { msg, t } from '../../i18n/index.js';
import { saAnchorDegrees } from '../saElections/cards.js';
import { formatSaMonth } from '../saGovernance/views.js';
import {
  buildSaDistrictCard,
  SA_DISTRICT_COLOR,
  SA_DISTRICT_LISTED_COLOR,
  SA_DISTRICTS_OVERLAY_SOURCE_ID,
} from './cards.js';
export * from './cards.js';

const withAlpha = ([r, g, b], alpha) => [r, g, b, alpha];
const ringDegrees = (ring) => ring.map(([lon, lat]) => ({ lon, lat }));

/** The draw sets start with this: `sa-districts-2026:<n>:fills`, `:lines`. */
export const SA_DISTRICTS_SET_PREFIX = 'sa-districts-2026';
let instances = 0;

const PICK_PREFIX = 'sa-district:';
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** A synchronous throw from a source becomes a rejection, not an escape. */
const settle = (call) => Promise.resolve().then(call);

/**
 * Own the district outline display, its refresh lifecycle and click selection.
 * Fills are ground-clamped and never pickable (a council beneath still takes
 * the click); each outline is a draped, pickable line in its own draw set.
 */
export function createSaDistrictsLayer({
  source,
  overlayHost = null,
  inputFor = defaultInputFor,
  picking = null,
} = {}) {
  if (
    typeof source?.getDistricts !== 'function' ||
    typeof source?.getSnapshot !== 'function'
  )
    throw new TypeError('SA districts require a governance source');
  let _viewer = null;
  let _request = null;
  let _fills = null;
  let _lines = null;
  let _count = 0;
  let _listedCount = 0;
  let _govFailed = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _clickSubscription = null;
  let _selectedId = null;
  /** @type {Map<string, {area: object, anchor: object}>} */
  const _rowById = new Map();
  let _gov = null;

  const canSelect = () => overlayHost && inputFor && picking;

  function publishSelectedCard() {
    if (!canSelect()) return;
    const row = _selectedId ? _rowById.get(_selectedId) : null;
    if (!row) {
      _selectedId = null;
      overlayHost.setEntries(
        SA_DISTRICTS_OVERLAY_SOURCE_ID,
        [],
        CARD_HOST_OPTIONS,
      );
      return;
    }
    const card = {
      ...buildSaDistrictCard(row.area, _gov),
      position: fromDegrees(row.anchor.lon, row.anchor.lat),
    };
    overlayHost.setEntries(
      SA_DISTRICTS_OVERLAY_SOURCE_ID,
      [card],
      CARD_HOST_OPTIONS,
    );
  }

  /** The district a click's draw hit belongs to: an outline of this layer's own; else null. */
  function pickedDistrictId(hit) {
    // Only the outlines: a fill never opens a card.
    if (!hit || hit.surface || hit.set !== _lines?.id) return null;
    if (typeof hit.id !== 'string' || !hit.id.startsWith(PICK_PREFIX))
      return null;
    const rest = hit.id.slice(PICK_PREFIX.length);
    const code = rest.slice(0, rest.lastIndexOf(':'));
    return _rowById.has(code) ? code : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickSubscription || !_viewer) return;
    // Deliberately NOT registered in the pick-ownership registry, as with the
    // councils: unowned, our picks read as "empty space" to siblings.
    _clickSubscription = inputFor(_viewer).onClick((event) => {
      if (picking.clickCard?.(event)) return;
      const picked = event.topHit;
      const code = picked ? pickedDistrictId(event.drawHit) : null;
      if (code) {
        _selectedId = code;
        publishSelectedCard();
        return;
      }
      if (picked) {
        const pickId = picking.resolvePickId(picked);
        if (pickId && picking.isOwnedByOtherLayer(layer.id, pickId)) return;
      }
      if (_selectedId) {
        _selectedId = null;
        publishSelectedCard();
      }
    });
  }

  function removeClickHandler() {
    _clickSubscription?.();
    _clickSubscription = null;
  }

  function clearSelection() {
    _selectedId = null;
    if (overlayHost) {
      overlayHost.clearSource(SA_DISTRICTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible?.(SA_DISTRICTS_OVERLAY_SOURCE_ID, false);
    }
  }

  const layer = {
    id: 'sa-districts-2026',
    name: 'SA districts 2026',
    icon: '🗺️',
    source: 'MDB',
    updateInterval: 3600000,

    init(viewer) {
      if (_viewer) throw new Error('SA districts layer is already initialized');
      const draw = drawOf(viewer);
      const prefix = `${SA_DISTRICTS_SET_PREFIX}:${++instances}`;
      _fills = draw.shapes({
        id: `${prefix}:fills`,
        clampTo: 'both',
        // The set flag is what Cesium honours; the per-item flag stays too.
        pickable: false,
        show: false,
      });
      _lines = draw.lines({
        id: `${prefix}:lines`,
        clampTo: 'both',
        // Over the council and ward sets (default 0) whichever layer drew
        // first: under them the outlines vanish and their clicks open
        // council cards.
        groundOrder: 1,
        show: false,
      });
      _viewer = viewer;
      _count = 0;
      _listedCount = 0;
      _govFailed = false;
      _gov = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      console.log('[Data:SaDistricts] Initialized');
    },

    enable() {
      _enabled = true;
      if (_fills) _fills.show = _lines.show = true;
      overlayHost?.setVisible?.(SA_DISTRICTS_OVERLAY_SOURCE_ID, true);
      installClickHandler();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_fills) _fills.show = _lines.show = false;
      removeClickHandler();
      clearSelection();
    },

    async update() {
      if (!_enabled || !_fills) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const [districts, governance] = await Promise.allSettled([
          settle(() => source.getDistricts({ signal: request.signal })),
          settle(() => source.getSnapshot({ signal: request.signal })),
        ]);
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        // Without outlines there is nothing to draw: the update fails and the
        // last drawn set stays.
        if (districts.status === 'rejected') throw districts.reason;
        const { areas, stale, fetchedAt } = districts.value;
        _stale = stale === true;
        // A failed poll keeps the last good governance: only a layer that
        // never had one shows it as unavailable.
        if (governance.status === 'fulfilled' && governance.value)
          _gov = governance.value;
        else
          console.warn(
            '[Data:SaDistricts] Governance unavailable:',
            governance.reason ?? new Error('empty'),
          );
        _govFailed = !_gov;

        const nextFills = [];
        const nextLines = [];
        _rowById.clear();
        let listed = 0;
        for (const area of areas) {
          const isListed = _gov?.interventions.has(area.code) === true;
          if (isListed) listed++;
          const color = cssColor(
            isListed ? SA_DISTRICT_LISTED_COLOR : SA_DISTRICT_COLOR,
          );
          const neutral = cssColor(SA_DISTRICT_COLOR);
          for (const [index, rings] of area.polygons.entries()) {
            const id = `${PICK_PREFIX}${area.code}:${index}`;
            nextFills.push({
              id,
              geometry: { kind: 'polygon', rings: rings.map(ringDegrees) },
              fill: withAlpha(neutral, 0.03),
              height: 'clampGround',
              pickable: false,
            });
            nextLines.push({
              id,
              positions: rings[0].map(([lon, lat]) => fromDegrees(lon, lat)),
              widthPx: 3,
              mode: 'draped',
              style: { kind: 'solid', color },
            });
          }
          const { polygons, ...facts } = area;
          _rowById.set(area.code, {
            area: facts,
            anchor: saAnchorDegrees(polygons),
          });
        }
        _fills.set(nextFills);
        _lines.set(nextLines);
        // Only the card goes if its district is gone; the source stays visible.
        if (_selectedId && !_rowById.has(_selectedId)) {
          _selectedId = null;
          overlayHost?.clearSource(SA_DISTRICTS_OVERLAY_SOURCE_ID);
        } else if (_selectedId) publishSelectedCard();
        _count = areas.length;
        _listedCount = listed;
        _lastUpdate =
          _stale && Number.isFinite(fetchedAt) ? fetchedAt : Date.now();
        _lastError = null;
        console.log(
          `[Data:SaDistricts] Updated: ${_count} districts, ${nextLines.length} outlines`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SaDistricts] Fetch error:', e);
        _lastError = e?.message || msg('SA districts source unavailable');
        _stale = false;
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy() {
      _request?.abort();
      _request = null;
      removeClickHandler();
      clearSelection();
      _rowById.clear();
      _gov = null;
      _viewer = null;
      _enabled = false;
      _fills?.dispose();
      _lines?.dispose();
      _fills = _lines = null;
      _count = 0;
      _listedCount = 0;
      _govFailed = false;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_fills || !_fills.show) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const { area, anchor } of _rowById.values()) {
        if (result.length >= limit) break;
        result.push({
          id: area.code,
          name: area.name,
          province: area.province,
          category: area.category,
          councils: area.members?.length ?? 0,
          section139: _gov?.interventions.has(area.code) === true,
          lat: anchor.lat,
          lon: anchor.lon,
        });
      }
      return result;
    },

    getRowControls() {
      const hint = t('Click a district outline for its card.');
      const legend = _govFailed
        ? [
            {
              label: t('District'),
              color: SA_DISTRICT_COLOR,
              count: _count,
              blurb: [t('Intervention list unavailable'), hint].join('\n'),
            },
          ]
        : [
            {
              label: t('Section 139 (CoGTA list, {asOf})', {
                asOf: formatSaMonth(_gov?.interventionsAsOf),
              }),
              color: SA_DISTRICT_LISTED_COLOR,
              count: _listedCount,
              blurb: hint,
            },
            // The rest: the listed ones are counted above.
            {
              label: t('District'),
              color: SA_DISTRICT_COLOR,
              count: _count - _listedCount,
            },
          ];
      return { chips: [], legend };
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
