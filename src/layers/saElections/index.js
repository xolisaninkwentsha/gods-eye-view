import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf, findCamera } from '../../render/rendererOf.js';
import { hexColor } from '../../render/color.js';
import { inputFor as defaultInputFor } from '../../input/dispatcher.js';
import { msg, t } from '../../i18n/index.js';
import {
  SA_ELECTIONS_OVERLAY_SOURCE,
  normalizeSaElectionsPayload,
  saAreaColor,
} from './records.js';
import {
  buildSaCouncilCard,
  buildSaWardCard,
  saAnchorDegrees,
  saStatusLine,
} from './cards.js';
import { OTHER_COLOR, partyStyle } from './parties.js';
export { createSaElectionsSource } from './source.js';
export * from './records.js';
export * from './cards.js';

const NEUTRAL = '#9aa4ad';
const STRONG_ALPHA = 0.5;
const FAINT_ALPHA = 0.15;
const LEGEND_PARTIES = 11;
const ringDegrees = (ring) => ring.map(([lon, lat]) => ({ lon, lat }));

/** Each layer's draw sets start with this, then the level (`sa-wards:1:fills`). */
export const SA_ELECTIONS_SET_PREFIX = 'sa';
let instances = 0;

const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

const LAYER_FIELDS = Object.freeze({
  councils: { id: 'sa-councils-2026', name: 'SA councils 2026' },
  wards: { id: 'sa-wards-2026', name: 'SA wards 2026' },
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

/**
 * Own one South African 2026 election display (councils or wards): a
 * ground-clamped fill and a draped outline per polygon, the click card, and
 * the refresh lifecycle. Neither level is shared by link or claimed in the
 * pick-ownership registry.
 */
export function createSaElectionsLayer({
  level,
  source,
  overlayHost = null,
  inputFor = defaultInputFor,
  picking = null,
  maxCameraHeightM = null,
  repollMs = 30_000,
} = {}) {
  const fields = Object.hasOwn(LAYER_FIELDS, level)
    ? LAYER_FIELDS[level]
    : null;
  if (!fields)
    throw new TypeError('SA elections level must be councils or wards');
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SA elections requires a snapshot source');
  const overlaySourceId = SA_ELECTIONS_OVERLAY_SOURCE[level];
  const pickPrefix = `sa-${level}:`;
  const buildCard = level === 'wards' ? buildSaWardCard : buildSaCouncilCard;
  const outlineWidthPx = level === 'wards' ? 1 : 2;

  let _viewer = null;
  let _request = null;
  let _signature = null;
  let _fills = null;
  let _lines = null;
  let _setIds = new Set();
  let _count = 0;
  let _status = 'loading';
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _repollTimer = null;
  let _removeMoveEnd = null;
  let _rowListener = null;
  let _clickSubscription = null;
  let _selectedId = null;
  /** @type {Map<string, object>} */
  const _rowById = new Map();

  const canSelect = () => overlayHost && inputFor && picking;
  const resultsShown = () => _status === 'ok' || _status === 'stale';

  function clearRepoll() {
    clearTimeout(_repollTimer);
    _repollTimer = null;
  }

  function scheduleRepoll() {
    clearRepoll();
    if (_status !== 'loading' || !_enabled) return;
    _repollTimer = setTimeout(() => {
      _repollTimer = null;
      // The lifecycle does not see this update, so the row is told itself.
      void layer.update().finally(() => _rowListener?.());
    }, repollMs);
  }

  /** Whether the camera is low enough to draw (always, with no limit set). */
  function withinCameraLimit() {
    if (maxCameraHeightM == null) return true;
    const height = _viewer ? findCamera(_viewer)?.pose()?.height : null;
    return Number.isFinite(height) && height <= maxCameraHeightM;
  }

  function applyVisibility() {
    if (!_fills) return;
    _fills.show = _lines.show = _enabled && withinCameraLimit();
  }

  function publishSelectedCard() {
    if (!canSelect()) return;
    const row = _selectedId ? _rowById.get(_selectedId) : null;
    if (!row) {
      _selectedId = null;
      overlayHost.setEntries(overlaySourceId, [], CARD_HOST_OPTIONS);
      return;
    }
    const card = {
      ...buildCard(row, _status),
      position: fromDegrees(row.anchor.lon, row.anchor.lat),
    };
    overlayHost.setEntries(overlaySourceId, [card], CARD_HOST_OPTIONS);
  }

  /** The area a click's draw hit belongs to: an item of this layer's own sets. */
  function pickedAreaId(hit) {
    if (!hit || hit.surface || !_setIds.has(hit.set)) return null;
    if (typeof hit.id !== 'string' || !hit.id.startsWith(pickPrefix))
      return null;
    const rest = hit.id.slice(pickPrefix.length);
    const areaId = rest.slice(0, rest.lastIndexOf(':'));
    return _rowById.has(areaId) ? areaId : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickSubscription || !_viewer) return;
    // Deliberately NOT registered in the pick-ownership registry: sibling
    // layers yield to owned picks before their own overlay-card hit-tests, so
    // claiming these large ground polygons would make FIRMS, vessel and CCTV
    // cards inert anywhere over an area. Same contract as drone airspace.
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
      overlayHost.clearSource(overlaySourceId);
      overlayHost.setVisible?.(overlaySourceId, false);
    }
  }

  function removeCameraGate() {
    _removeMoveEnd?.();
    _removeMoveEnd = null;
  }

  const layer = {
    id: fields.id,
    name: fields.name,
    icon: '🗳️',
    source: 'MDB · IEC',
    updateInterval: 3_600_000,

    /** Connect the layer row's repaint listener. */
    setRowControlsListener(listener) {
      _rowListener = typeof listener === 'function' ? listener : null;
    },

    init(viewer) {
      if (_viewer) throw new Error('SA elections layer is already initialized');
      const draw = drawOf(viewer);
      const prefix = `${SA_ELECTIONS_SET_PREFIX}-${level}:${++instances}`;
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
      _status = 'loading';
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log(`[Data:SaElections:${level}] Initialized`);
    },

    enable() {
      _enabled = true;
      applyVisibility();
      removeCameraGate();
      if (maxCameraHeightM != null && _viewer)
        _removeMoveEnd =
          findCamera(_viewer)?.on('moveEnd', applyVisibility) ?? null;
      overlayHost?.setVisible?.(overlaySourceId, true);
      installClickHandler();
    },

    disable() {
      _request?.abort();
      _request = null;
      clearRepoll();
      _enabled = false;
      applyVisibility();
      removeCameraGate();
      removeClickHandler();
      clearSelection();
    },

    async update() {
      if (!_enabled || !_fills) return false;
      _request?.abort();
      clearRepoll();
      const request = new AbortController();
      _request = request;
      try {
        const payload = await source.getSnapshot({
          signal: request.signal,
          level,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const { status, rows } = normalizeSaElectionsPayload(payload, level);
        _status = status;
        const signature = JSON.stringify([
          status,
          rows
            .map(({ polygons, ...facts }) => ({
              ...facts,
              geometry: geometryHash(polygons),
            }))
            .sort((a, b) => a.stableId.localeCompare(b.stableId)),
        ]);
        if (signature !== _signature) {
          const nextFills = [];
          const nextLines = [];
          _rowById.clear();
          for (const row of rows) {
            const { color, strength } = resultsShown()
              ? saAreaColor(row, level)
              : { color: null, strength: null };
            for (const [index, rings] of row.polygons.entries()) {
              const id = `${pickPrefix}${row.stableId}:${index}`;
              if (color) {
                nextFills.push({
                  id,
                  geometry: { kind: 'polygon', rings: rings.map(ringDegrees) },
                  fill: hexColor(
                    color,
                    strength === 'faint' ? FAINT_ALPHA : STRONG_ALPHA,
                  ),
                  height: 'clampGround',
                });
              }
              nextLines.push({
                id,
                positions: rings[0].map(([lon, lat]) => fromDegrees(lon, lat)),
                widthPx: outlineWidthPx,
                mode: 'draped',
                style: { kind: 'solid', color: hexColor(color ?? NEUTRAL, 1) },
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
          _signature = signature;
          _count = rows.length;
        }
        applyVisibility();
        if (_selectedId) publishSelectedCard();
        _lastUpdate = Date.now();
        _lastError = null;
        scheduleRepoll();
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn(`[Data:SaElections:${level}] Fetch error:`, e);
        _lastError = e?.message || msg('SA election results unavailable');
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy() {
      _request?.abort();
      _request = null;
      _rowListener = null;
      clearRepoll();
      removeCameraGate();
      removeClickHandler();
      clearSelection();
      _rowById.clear();
      _signature = null;
      _viewer = null;
      _enabled = false;
      _fills?.dispose();
      _lines?.dispose();
      _fills = _lines = null;
      _setIds = new Set();
      _count = 0;
      _status = 'loading';
      _lastUpdate = null;
      _lastError = null;
    },

    getRowControls() {
      if (!resultsShown()) {
        return {
          chips: [],
          legend: [
            {
              label:
                level === 'wards' ? t('SA wards 2026') : t('SA councils 2026'),
              color: NEUTRAL,
              count: _rowById.size,
              blurb: saStatusLine(_status),
            },
          ],
        };
      }
      const tally = new Map();
      for (const row of _rowById.values()) {
        const { color } = saAreaColor(row, level);
        if (!color) continue;
        const party =
          level === 'wards'
            ? row.result.winner.party
            : row.result.largest.party;
        const { short } = partyStyle(party);
        const entry = tally.get(short) ?? { label: short, color, count: 0 };
        entry.count++;
        tally.set(short, entry);
      }
      const ranked = [...tally.values()].sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label),
      );
      const legend = ranked.slice(0, LEGEND_PARTIES);
      legend.push({
        label: t('Other'),
        color: OTHER_COLOR,
        count: ranked
          .slice(LEGEND_PARTIES)
          .reduce((sum, p) => sum + p.count, 0),
      });
      if (level === 'councils') {
        legend[0].blurb = t('Faint: no party holds more than half the seats');
      }
      return { chips: [], legend };
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _status === 'stale',
      };
    },
  };
  return layer;
}
