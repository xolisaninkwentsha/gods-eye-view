import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf } from '../../render/rendererOf.js';
import { cssColor } from '../../render/color.js';
import { inputFor as defaultInputFor } from '../../input/dispatcher.js';
import { msg, t } from '../../i18n/index.js';
import { earthquakeMagnitudeTitle } from '../earthquakes/model.js';
import {
  SA_QUAKE_AGE_ACCENTS,
  SA_QUAKES_OVERLAY_SOURCE_ID,
  buildSaQuakeCard,
  saQuakeAgeBand,
  saQuakeDotPx,
} from './cards.js';
export { normalizeEmscSnapshot } from './records.js';
export { createSaQuakesSource } from './source.js';
export * from './cards.js';

/**
 * The draw sets the quakes are drawn in start with this; each layer has its
 * own (`sa-earthquakes:1:dots`). Picks name them as `Hit.set`.
 */
export const SA_QUAKES_SET_PREFIX = 'sa-earthquakes';
let instances = 0;

const PICK_PREFIX = 'sa-quake:';
const BANDS = ['day', 'week', 'month'];
const OUTLINE = [1, 1, 1, 0.9];
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * Own the South African earthquake display, its refresh lifecycle and click
 * selection. Each event is a ground-clamped dot in one renderer draw set
 * (`drawOf(viewer)`), coloured by age.
 */
export function createSaQuakesLayer({
  source,
  overlayHost = null,
  inputFor = defaultInputFor,
  picking = null,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SA earthquakes require a snapshot source');
  let _viewer = null;
  let _request = null;
  let _snapshotSignature = null;
  let _dots = null;
  let _setIds = new Set();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _clickSubscription = null;
  let _selectedId = null;
  let _nowMs = 0;
  /** @type {Map<string, object>} */
  const _rowById = new Map();

  const canSelect = () => overlayHost && inputFor && picking;

  function publishSelectedCard() {
    if (!canSelect()) return;
    const row = _selectedId ? _rowById.get(_selectedId) : null;
    if (!row) {
      _selectedId = null;
      overlayHost.setEntries(
        SA_QUAKES_OVERLAY_SOURCE_ID,
        [],
        CARD_HOST_OPTIONS,
      );
      return;
    }
    const card = {
      ...buildSaQuakeCard(row, _nowMs),
      position: fromDegrees(row.lon, row.lat),
    };
    overlayHost.setEntries(
      SA_QUAKES_OVERLAY_SOURCE_ID,
      [card],
      CARD_HOST_OPTIONS,
    );
  }

  /** The event a click's draw hit belongs to: an item of this layer's own set; else null. */
  function pickedQuakeId(hit) {
    if (!hit || hit.surface || !_setIds.has(hit.set)) return null;
    if (typeof hit.id !== 'string' || !hit.id.startsWith(PICK_PREFIX))
      return null;
    const id = hit.id.slice(PICK_PREFIX.length);
    return _rowById.has(id) ? id : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickSubscription || !_viewer) return;
    // Deliberately NOT registered in the pick-ownership registry, as the
    // weather layer: unowned, our picks read as "empty space" to siblings.
    _clickSubscription = inputFor(_viewer).onClick((event) => {
      if (picking.clickCard?.(event)) return;
      const picked = event.topHit;
      const id = picked ? pickedQuakeId(event.drawHit) : null;
      if (id) {
        _selectedId = id;
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
      overlayHost.clearSource(SA_QUAKES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible?.(SA_QUAKES_OVERLAY_SOURCE_ID, false);
    }
  }

  const layer = {
    id: 'sa-earthquakes',
    name: 'SA earthquakes (30 days)',
    icon: '〰️',
    source: 'EMSC',
    updateInterval: 600000,

    init(viewer) {
      if (_viewer)
        throw new Error('SA earthquakes layer is already initialized');
      const draw = drawOf(viewer);
      _dots = draw.points({
        id: `${SA_QUAKES_SET_PREFIX}:${++instances}:dots`,
        clampTo: 'both',
        show: false,
      });
      _setIds = new Set([_dots.id]);
      _viewer = viewer;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      console.log('[Data:SaQuakes] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dots) _dots.show = true;
      overlayHost?.setVisible?.(SA_QUAKES_OVERLAY_SOURCE_ID, true);
      installClickHandler();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dots) _dots.show = false;
      removeClickHandler();
      clearSelection();
    },

    async update() {
      if (!_enabled || !_dots) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot =
          typeof source.getSnapshotDetail === 'function'
            ? await source.getSnapshotDetail({ signal: request.signal })
            : { rows: await source.getSnapshot({ signal: request.signal }) };
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _stale = snapshot.stale === true;
        const updatedAt =
          _stale && Number.isFinite(snapshot.fetchedAt)
            ? snapshot.fetchedAt
            : Date.now();

        // The age band depends on the clock, so it is part of the signature:
        // a quake ageing into the next band recolours.
        _nowMs = now();
        const rows = snapshot.rows;
        const signature = JSON.stringify(
          rows.map((r) => [
            r.stableId,
            r.mag,
            r.lon,
            r.lat,
            saQuakeAgeBand(r.timeMs, _nowMs),
          ]),
        );
        if (signature === _snapshotSignature) {
          // Rows are the same events, but the card shows the latest facts.
          for (const row of rows) _rowById.set(row.stableId, row);
          if (_selectedId) publishSelectedCard();
          _lastUpdate = updatedAt;
          _lastError = null;
          return true;
        }
        // Oldest first, so the newest is drawn on top.
        const ordered = [...rows].sort((a, b) => a.timeMs - b.timeMs);
        const items = [];
        _rowById.clear();
        for (const row of ordered) {
          const band = saQuakeAgeBand(row.timeMs, _nowMs);
          items.push({
            id: `${PICK_PREFIX}${row.stableId}`,
            pos: fromDegrees(row.lon, row.lat),
            height: 'clampGround',
            disableDepthTest: Number.POSITIVE_INFINITY,
            pixelSize: saQuakeDotPx(row.mag),
            color: cssColor(SA_QUAKE_AGE_ACCENTS[band]),
            outlineColor: OUTLINE,
            outlineWidth: 1,
          });
          _rowById.set(row.stableId, row);
        }
        _dots.set(items);
        _snapshotSignature = signature;
        if (_selectedId && !_rowById.has(_selectedId)) {
          // Only the card goes; the source stays visible for the next click.
          _selectedId = null;
          overlayHost?.clearSource(SA_QUAKES_OVERLAY_SOURCE_ID);
        } else if (_selectedId) publishSelectedCard();
        _count = rows.length;
        _lastUpdate = updatedAt;
        _lastError = null;
        console.log(`[Data:SaQuakes] Updated: ${_count} events`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SaQuakes] Fetch error:', e);
        _lastError = e?.message || msg('SA earthquakes source unavailable');
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
      _snapshotSignature = null;
      _viewer = null;
      _enabled = false;
      _dots?.dispose();
      _dots = null;
      _setIds = new Set();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_dots || !_dots.show) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of _rowById.values()) {
        if (result.length >= limit) break;
        result.push({
          id: row.stableId,
          name: row.region
            ? `${earthquakeMagnitudeTitle(row.mag)} · ${row.region}`
            : earthquakeMagnitudeTitle(row.mag),
          magnitude: row.mag,
          timeMs: row.timeMs,
          region: row.region,
          lat: row.lat,
          lon: row.lon,
        });
      }
      return result;
    },

    getRowControls() {
      const labels = {
        day: t('Last 24 hours'),
        week: t('1 to 7 days ago'),
        month: t('7 to 30 days ago'),
      };
      const counts = { day: 0, week: 0, month: 0 };
      for (const row of _rowById.values())
        counts[saQuakeAgeBand(row.timeMs, _nowMs)]++;
      const legend = BANDS.map((band, index) => ({
        label: labels[band],
        color: SA_QUAKE_AGE_ACCENTS[band],
        count: counts[band],
        ...(index === 0
          ? {
              blurb: t(
                'Events recorded by the South African seismograph network (SASN), via EMSC. Includes mine tremors, which are not labelled separately. Depth is not measured, so it is not shown.',
              ),
            }
          : {}),
      }));
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
