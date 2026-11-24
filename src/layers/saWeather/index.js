import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf } from '../../render/rendererOf.js';
import { cssColor } from '../../render/color.js';
import { inputFor as defaultInputFor } from '../../input/dispatcher.js';
import { msg, t } from '../../i18n/index.js';
import { saAnchorDegrees } from '../saElections/cards.js';
import { buildSaWeatherCard } from './cards.js';
import {
  SA_WEATHER_BANDS,
  SA_WEATHER_OVERLAY_SOURCE_ID,
  saWeatherBandAccent,
  saWeatherBandRank,
} from './records.js';
export { normalizeSaWeatherAreas } from './records.js';
export { createSaWeatherSource } from './source.js';
export * from './cards.js';
export * from './records.js';

const withAlpha = ([r, g, b], alpha) => [r, g, b, alpha];
const ringDegrees = (ring) => ring.map(([lon, lat]) => ({ lon, lat }));

/**
 * The draw sets the warnings are drawn in start with this; each layer has its
 * own (`sa-weather-warnings:1:fills`, …). Picks name them as `Hit.set`.
 */
export const SA_WEATHER_SET_PREFIX = 'sa-weather-warnings';
let instances = 0;

const PICK_PREFIX = 'sa-weather:';
const NO_WARNINGS_COLOR = '#9aa4ad';
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** FNV-1a over an area's rings, so a boundary change alters the signature. */
function geometryHash(polygons) {
  const text = JSON.stringify(polygons);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function worstBand(warnings) {
  let worst = null;
  for (const w of warnings)
    if (saWeatherBandRank(w.band) > saWeatherBandRank(worst)) worst = w.band;
  return worst;
}

/** The areas with only the warnings still in force at `nowMs`; areas left with none go. */
function inForce(rows, nowMs) {
  const kept = [];
  for (const row of rows) {
    const warnings = row.warnings.filter((w) => !(w.expiresMs <= nowMs));
    if (warnings.length)
      kept.push({ ...row, warnings, band: worstBand(warnings) });
  }
  return kept;
}

/**
 * Own the South African weather warnings display, its refresh lifecycle, and
 * click selection. Each area polygon is a ground-clamped fill in one renderer
 * draw set and its boundary a draped line in another (`drawOf(viewer)`).
 */
export function createSaWeatherLayer({
  source,
  overlayHost = null,
  inputFor = defaultInputFor,
  picking = null,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SA weather warnings require a snapshot source');
  let _viewer = null;
  let _request = null;
  let _snapshotSignature = null;
  let _fills = null;
  let _lines = null;
  let _setIds = new Set();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _clickSubscription = null;
  let _selectedId = null;
  /** @type {Map<string, object>} */
  const _rowById = new Map();

  const canSelect = () => overlayHost && inputFor && picking;

  function publishSelectedCard() {
    if (!canSelect()) return;
    const row = _selectedId ? _rowById.get(_selectedId) : null;
    if (!row) {
      _selectedId = null;
      overlayHost.setEntries(
        SA_WEATHER_OVERLAY_SOURCE_ID,
        [],
        CARD_HOST_OPTIONS,
      );
      return;
    }
    const { anchor, ...area } = row;
    const card = {
      ...buildSaWeatherCard(area),
      position: fromDegrees(anchor.lon, anchor.lat),
    };
    overlayHost.setEntries(
      SA_WEATHER_OVERLAY_SOURCE_ID,
      [card],
      CARD_HOST_OPTIONS,
    );
  }

  /** The area a click's draw hit belongs to: an item of this layer's own sets; else null. */
  function pickedAreaId(hit) {
    if (!hit || hit.surface || !_setIds.has(hit.set)) return null;
    if (typeof hit.id !== 'string' || !hit.id.startsWith(PICK_PREFIX))
      return null;
    const rest = hit.id.slice(PICK_PREFIX.length);
    const areaId = rest.slice(0, rest.lastIndexOf(':'));
    return _rowById.has(areaId) ? areaId : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickSubscription || !_viewer) return;
    // Deliberately NOT registered in the pick-ownership registry: claiming
    // these large ground polygons would make other layers' cards inert over
    // them. Unowned, our picks read as "empty space" to siblings.
    _clickSubscription = inputFor(_viewer).onClick((event) => {
      if (picking.clickCard?.(event)) return;
      const picked = event.topHit;
      const areaId = picked ? pickedAreaId(event.drawHit) : null;
      if (areaId) {
        _selectedId = areaId;
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
      overlayHost.clearSource(SA_WEATHER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible?.(SA_WEATHER_OVERLAY_SOURCE_ID, false);
    }
  }

  const layer = {
    id: 'sa-weather-warnings',
    name: 'SA weather warnings',
    icon: '⛈️',
    source: 'SAWS',
    updateInterval: 600000,

    init(viewer) {
      if (_viewer)
        throw new Error('SA weather warnings layer is already initialized');
      const draw = drawOf(viewer);
      const prefix = `${SA_WEATHER_SET_PREFIX}:${++instances}`;
      _fills = draw.shapes({
        id: `${prefix}:fills`,
        clampTo: 'both',
        show: false,
      });
      _lines = draw.lines({
        id: `${prefix}:lines`,
        clampTo: 'both',
        show: false,
      });
      _setIds = new Set([_fills.id, _lines.id]);
      _viewer = viewer;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      console.log('[Data:SaWeather] Initialized');
    },

    enable() {
      _enabled = true;
      if (_fills) _fills.show = _lines.show = true;
      overlayHost?.setVisible?.(SA_WEATHER_OVERLAY_SOURCE_ID, true);
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

        // Warnings end while the page stays open: drop them here, before the
        // signature, so an expiry redraws.
        const rows = inForce(snapshot.rows, now());
        const signature = JSON.stringify(
          rows
            .map(({ polygons, warnings, ...facts }) => ({
              ...facts,
              warnings: warnings.map((w) => [
                w.event,
                w.level,
                w.band,
                w.onsetMs,
                w.expiresMs,
                w.sentMs,
              ]),
              geometry: geometryHash(polygons),
            }))
            .sort((a, b) => a.stableId.localeCompare(b.stableId)),
        );
        if (signature === _snapshotSignature) {
          if (_selectedId) publishSelectedCard();
          _lastUpdate = updatedAt;
          _lastError = null;
          return true;
        }
        // Yellow first, red last, so the worst band is drawn on top.
        const ordered = rows
          .map((row, index) => ({ row, index }))
          .sort(
            (a, b) =>
              saWeatherBandRank(a.row.band) - saWeatherBandRank(b.row.band) ||
              a.index - b.index,
          )
          .map(({ row }) => row);
        const nextFills = [];
        const nextLines = [];
        _rowById.clear();
        for (const row of ordered) {
          const color = cssColor(saWeatherBandAccent(row.band));
          for (const [index, rings] of row.polygons.entries()) {
            const id = `${PICK_PREFIX}${row.stableId}:${index}`;
            nextFills.push({
              id,
              geometry: { kind: 'polygon', rings: rings.map(ringDegrees) },
              fill: withAlpha(color, 0.35),
              height: 'clampGround',
            });
            nextLines.push({
              id,
              positions: rings[0].map(([lon, lat]) => fromDegrees(lon, lat)),
              widthPx: 2,
              mode: 'draped',
              style: { kind: 'solid', color: withAlpha(color, 0.9) },
            });
          }
          const { polygons, ...facts } = row;
          _rowById.set(row.stableId, {
            ...facts,
            anchor: saAnchorDegrees(polygons),
          });
        }

        _fills.set(nextFills);
        _lines.set(nextLines);
        _snapshotSignature = signature;
        // The selected area's warnings have all expired: its card goes.
        if (_selectedId && !_rowById.has(_selectedId)) clearSelection();
        else if (_selectedId) publishSelectedCard();
        _count = rows.length;
        _lastUpdate = updatedAt;
        _lastError = null;
        console.log(
          `[Data:SaWeather] Updated: ${_count} areas, ${nextFills.length} polygons`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SaWeather] Fetch error:', e);
        _lastError =
          e?.message || msg('SA weather warnings source unavailable');
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
      _fills?.dispose();
      _lines?.dispose();
      _fills = _lines = null;
      _setIds = new Set();
      _count = 0;
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
      for (const row of _rowById.values()) {
        if (result.length >= limit) break;
        result.push({
          id: row.stableId,
          name: row.name,
          band: row.band,
          warnings: row.warnings.length,
          events: [...new Set(row.warnings.map((w) => w.event))].join(', '),
          lat: row.anchor.lat,
          lon: row.anchor.lon,
        });
      }
      return result;
    },

    getRowControls() {
      const labels = {
        yellow: t('Yellow'),
        orange: t('Orange'),
        red: t('Red'),
      };
      const rows = [..._rowById.values()];
      const legend = SA_WEATHER_BANDS.map((band, index) => ({
        label: labels[band],
        color: saWeatherBandAccent(band),
        count: rows.filter((row) => row.band === band).length,
        ...(index === 0
          ? {
              blurb: t(
                'SAWS impact-based warnings. Colour is the impact, the number the likelihood. For decisions, check weathersa.co.za.',
              ),
            }
          : {}),
      }));
      if (!rows.length)
        legend.unshift({
          label: t('No warnings in force'),
          color: NO_WARNINGS_COLOR,
          count: 0,
        });
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
