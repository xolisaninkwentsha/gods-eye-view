import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf } from '../../render/rendererOf.js';
import { hexColor } from '../../render/color.js';
import { inputFor as defaultInputFor } from '../../input/dispatcher.js';
import { loadBundledJson } from '../../data/bundledJson.js';
import { formatNumber, msg, t } from '../../i18n/index.js';
import { buildSaPopulationCard } from './cards.js';
import { POPULATION_BANDS, populationBand } from './grid.js';
export * from './cards.js';

const OVERLAY_SOURCE_ID = 'sa-population';
const PICK_PREFIX = 'sa-population:';
const FILL_ALPHA = 0.55;
const ANALYST_TOP = 200;
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

let instances = 0;

const defaultLoadGrid = () =>
  loadBundledJson(new URL('./sa-population-grid.json', import.meta.url));

/** Band labels: "100–999", …, "200,000+", numbers grouped for the locale. */
function bandLabel(index) {
  const min = POPULATION_BANDS[index].min;
  const next = POPULATION_BANDS[index + 1]?.min;
  return next === undefined
    ? `${formatNumber(min)}+`
    : `${formatNumber(min)}–${formatNumber(next - 1)}`;
}

/**
 * Own the SA population display: one flat ground-clamped fill per grid square
 * in a draw set, and a read-only click card. The bundled grid loads once, on
 * the first update after enable, and is kept.
 */
export function createSaPopulationLayer({
  overlayHost = null,
  picking = null,
  inputFor = defaultInputFor,
  loadGrid = defaultLoadGrid,
} = {}) {
  let _viewer = null;
  let _fills = null;
  let _setIds = new Set();
  let _enabled = false;
  let _clickSubscription = null;
  let _selectedId = null;
  let _gridPromise = null;
  let _cellDeg = 0.1;
  let _total = 0;
  let _count = 0;
  let _counts = POPULATION_BANDS.map(() => 0);
  let _loaded = false;
  let _unavailable = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _drawn = false;
  /** @type {Map<string, {cell: number[], index: number}>} item id -> cell */
  const _cellById = new Map();

  const canSelect = () => overlayHost && inputFor && picking;

  function publishSelectedCard() {
    if (!canSelect()) return;
    const found = _selectedId ? _cellById.get(_selectedId) : null;
    if (!found) {
      _selectedId = null;
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      return;
    }
    const { anchor, ...built } = buildSaPopulationCard(
      found.cell,
      found.index,
      _cellDeg,
    );
    overlayHost.setEntries(
      OVERLAY_SOURCE_ID,
      [{ ...built, position: fromDegrees(anchor.lon, anchor.lat) }],
      CARD_HOST_OPTIONS,
    );
  }

  function pickedItemId(hit) {
    if (!hit || hit.surface || !_setIds.has(hit.set)) return null;
    return typeof hit.id === 'string' && _cellById.has(hit.id) ? hit.id : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickSubscription || !_viewer) return;
    // Deliberately NOT registered in the pick-ownership registry: these large
    // ground fills would otherwise make sibling layers' cards inert.
    _clickSubscription = inputFor(_viewer).onClick((event) => {
      if (picking.clickCard?.(event)) return;
      const picked = event.topHit;
      const itemId = picked ? pickedItemId(event.drawHit) : null;
      if (itemId) {
        _selectedId = itemId;
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
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      overlayHost.setVisible?.(OVERLAY_SOURCE_ID, false);
    }
  }

  function resetData() {
    _cellById.clear();
    _count = 0;
    _counts = POPULATION_BANDS.map(() => 0);
    _total = 0;
    _loaded = false;
    _unavailable = false;
    _lastUpdate = null;
    _lastError = null;
    _drawn = false;
  }

  /** The grid, loaded once; a failed load is forgotten so a later update retries. */
  function grid() {
    if (!_gridPromise) {
      _gridPromise = Promise.resolve()
        .then(() => loadGrid())
        .catch((error) => {
          _gridPromise = null;
          throw error;
        });
    }
    return _gridPromise;
  }

  function draw(data) {
    if (!Array.isArray(data?.cells))
      throw new Error(msg('Malformed SA population'));
    const cellDeg = Number(data.cellDeg) > 0 ? Number(data.cellDeg) : 0.1;
    const items = [];
    const counts = POPULATION_BANDS.map(() => 0);
    let sum = 0;
    _cellById.clear();
    data.cells.forEach((cell, index) => {
      const [south, west, people] = cell ?? [];
      if (![south, west, people].every(Number.isFinite)) return;
      const band = populationBand(people);
      if (band < 0) return;
      const north = south + cellDeg;
      const east = west + cellDeg;
      const id = `${PICK_PREFIX}${index}`;
      _cellById.set(id, { cell, index });
      counts[band] += 1;
      sum += people;
      items.push({
        id,
        geometry: {
          kind: 'polygon',
          rings: [
            [
              { lon: west, lat: south },
              { lon: east, lat: south },
              { lon: east, lat: north },
              { lon: west, lat: north },
              { lon: west, lat: south },
            ],
          ],
        },
        fill: hexColor(POPULATION_BANDS[band].color, FILL_ALPHA),
        height: 'clampGround',
      });
    });
    _fills.set(items);
    _cellDeg = cellDeg;
    _counts = counts;
    _count = items.length;
    _total = Number.isFinite(data.total) ? data.total : sum;
    _drawn = true;
  }

  const layer = {
    id: 'sa-population',
    name: 'SA population (Kontur 2023)',
    icon: '👥',
    source: 'Kontur',
    updateInterval: 0,

    init(viewer) {
      if (_viewer)
        throw new Error('SA population layer is already initialized');
      _fills = drawOf(viewer).shapes({
        id: `sa-population:${++instances}:fills`,
        clampTo: 'both',
        show: false,
      });
      _setIds = new Set([_fills.id]);
      _viewer = viewer;
      resetData();
      _enabled = false;
      console.log('[Data:SaPopulation] Initialized');
    },

    enable() {
      _enabled = true;
      if (_fills) _fills.show = true;
      overlayHost?.setVisible?.(OVERLAY_SOURCE_ID, true);
      installClickHandler();
    },

    disable() {
      _enabled = false;
      if (_fills) _fills.show = false;
      removeClickHandler();
      clearSelection();
    },

    async update() {
      if (!_enabled || !_fills) return false;
      if (_drawn) return true;
      const fills = _fills;
      try {
        const data = await grid();
        if (!_enabled || _fills !== fills) return false;
        if (!_drawn) draw(data);
        _loaded = true;
        _unavailable = false;
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (e) {
        if (!_enabled || _fills !== fills) return false;
        console.warn('[Data:SaPopulation] Load error:', e?.name || 'Error');
        _lastError = e?.message || msg('SA population unavailable');
        if (!_loaded) _unavailable = true;
        return false;
      }
    },

    destroy() {
      removeClickHandler();
      clearSelection();
      _viewer = null;
      _enabled = false;
      _fills?.dispose();
      _fills = null;
      _setIds = new Set();
      resetData();
    },

    getAnalystRecords() {
      if (!_fills || !_fills.show) return [];
      return [..._cellById.values()]
        .sort((a, b) => b.cell[2] - a.cell[2] || a.index - b.index)
        .slice(0, ANALYST_TOP)
        .map(({ cell, index }) => ({
          id: `${PICK_PREFIX}${index}`,
          people: cell[2],
          south: cell[0],
          west: cell[1],
        }));
    },

    getRowControls() {
      const legend = POPULATION_BANDS.map((band, index) => ({
        label: bandLabel(index),
        color: band.color,
        count: _counts[index],
        ...(index === 0
          ? {
              blurb: [
                t(
                  'People per square of about 10 km, from Kontur’s 2023 population model. Squares with fewer than 100 people are not drawn.',
                ),
                t('{total} million people in all', {
                  total: formatNumber(_total / 1e6, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }),
                }),
              ].join('\n'),
            }
          : {}),
      }));
      return {
        chips: [],
        legend,
        ...(_unavailable ? { info: t('Data unavailable') } : {}),
      };
    },

    /**
     * Why a start failed, for the person: the population grid never loaded.
     * Null otherwise (the app then names the layer by id).
     * @returns {?string}
     */
    enableFailureMessage() {
      return _unavailable ? t('SA population unavailable') : null;
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
