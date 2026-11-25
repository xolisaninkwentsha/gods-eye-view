import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf } from '../../render/rendererOf.js';
import { inputFor as defaultInputFor } from '../../input/dispatcher.js';
import { formatDate, msg, t } from '../../i18n/index.js';
import { buildSaFacilityCard } from './cards.js';
import {
  CLASS_FIELD,
  FACILITY_CLASSES,
  normaliseFacilities,
} from './records.js';
export { createSaFacilitiesSource } from './source.js';
export * from './cards.js';
export * from './records.js';

const SAST = 'Africa/Johannesburg';
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * A circle sprite for a class colour: `size` CSS pixels, drawn at twice that
 * for sharpness, with a white ring `ring` pixels wide when it is above 0.
 * Built once per colour and reused.
 */
const sprites = new Map();
function circleSprite(color, size, ring) {
  const key = `${color}|${size}|${ring}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    const px = size * 2;
    const half = px / 2;
    const inner = half - ring * 2;
    const white = ring
      ? `<circle cx="${half}" cy="${half}" r="${half}" fill="#fff"/>`
      : '';
    sprite = {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${white}<circle cx="${half}" cy="${half}" r="${inner}" fill="${color}"/></svg>`,
    };
    sprites.set(key, sprite);
  }
  return sprite;
}

const SETS = Object.freeze({
  health: {
    id: 'sa-health-facilities',
    name: 'SA health facilities',
    icon: '✚',
    source: 'healthsites.io · OpenStreetMap',
    size: 12,
    ring: 2,
    blurb: msg(
      'Hospitals, clinics, doctors, pharmacies and dentists mapped in OpenStreetMap, via healthsites.io.',
    ),
  },
  schools: {
    id: 'sa-schools',
    name: 'SA schools (Giga)',
    icon: '🏫',
    source: 'Giga · DBE',
    size: 8,
    ring: 0,
    blurb: msg(
      'School locations from Giga, coloured by whether the school is connected to the internet.',
    ),
  },
});

const instances = { health: 0, schools: 0 };

/** "25 Nov 2026" in South African time, whatever the machine's zone. */
function sastCalendarDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const part = (options) => formatDate(ms, { ...options, timeZone: SAST });
  return `${part({ day: 'numeric' })} ${part({ month: 'short' })} ${part({ year: 'numeric' })}`;
}

/**
 * Own one SA facility display (health or schools): one ground-clamped dot per
 * record in a renderer draw set (`drawOf(viewer)`), its refresh lifecycle and
 * click selection. The card is read-only.
 */
export function createSaFacilitiesLayer({
  set,
  source,
  overlayHost = null,
  inputFor = defaultInputFor,
  picking = null,
} = {}) {
  const config = SETS[set];
  if (!config) throw new TypeError('Unknown SA facilities set');
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SA facilities requires a snapshot source');
  const classes = FACILITY_CLASSES[set];
  const field = CLASS_FIELD[set];
  const overlaySourceId = config.id;
  const pickPrefix = `${config.id}:`;
  const classSprite = new Map(
    classes.map((c) => [
      c.key,
      circleSprite(c.color, config.size, config.ring),
    ]),
  );

  let _viewer = null;
  let _request = null;
  let _dots = null;
  let _setIds = new Set();
  let _count = 0;
  let _counts = new Map();
  let _stale = false;
  let _fetchedAt = null;
  let _loaded = false;
  let _unavailable = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _clickSubscription = null;
  let _selectedId = null;
  /** @type {Map<string, object>} item id -> record */
  const _recordById = new Map();

  const canSelect = () => overlayHost && inputFor && picking;

  function publishSelectedCard() {
    if (!canSelect()) return;
    const record = _selectedId ? _recordById.get(_selectedId) : null;
    if (!record) {
      _selectedId = null;
      overlayHost.clearSource(overlaySourceId);
      return;
    }
    const card = {
      ...buildSaFacilityCard(set, record),
      position: fromDegrees(record.lon, record.lat),
    };
    overlayHost.setEntries(overlaySourceId, [card], CARD_HOST_OPTIONS);
  }

  /** The item a click's draw hit belongs to: a dot of this layer's own set; else null. */
  function pickedItemId(hit) {
    if (!hit || hit.surface || !_setIds.has(hit.set)) return null;
    return typeof hit.id === 'string' && _recordById.has(hit.id)
      ? hit.id
      : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickSubscription || !_viewer) return;
    // Deliberately NOT registered in the pick-ownership registry: unowned,
    // our picks read as "empty space" to sibling layers.
    _clickSubscription = inputFor(_viewer).onClick((event) => {
      // Any card or label painted on top takes the click and leaves the
      // selection alone; this layer's own card links nowhere.
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
      overlayHost.clearSource(overlaySourceId);
      overlayHost.setVisible?.(overlaySourceId, false);
    }
  }

  function resetData() {
    _recordById.clear();
    _count = 0;
    _counts = new Map();
    _stale = false;
    _fetchedAt = null;
    _loaded = false;
    _unavailable = false;
    _lastUpdate = null;
    _lastError = null;
  }

  const layer = {
    id: config.id,
    name: config.name,
    icon: config.icon,
    source: config.source,
    updateInterval: 21600000,

    init(viewer) {
      if (_viewer)
        throw new Error('SA facilities layer is already initialized');
      const draw = drawOf(viewer);
      _dots = draw.icons({
        id: `${config.id}:${++instances[set]}:dots`,
        clampTo: 'both',
        horizonCull: true,
        recede: {},
        show: false,
      });
      _setIds = new Set([_dots.id]);
      _viewer = viewer;
      resetData();
      _enabled = false;
      console.log(`[Data:SaFacilities] Initialized ${set}`);
    },

    enable() {
      _enabled = true;
      if (_dots) _dots.show = true;
      overlayHost?.setVisible?.(overlaySourceId, true);
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
        const payload = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const normalised = normaliseFacilities(payload, set);
        if (!normalised) throw new Error(msg('Malformed SA facilities'));

        _recordById.clear();
        const items = normalised.records.map((record) => {
          const id = `${pickPrefix}${record.id}`;
          _recordById.set(id, record);
          return {
            id,
            pos: fromDegrees(record.lon, record.lat),
            height: 'clampGround',
            disableDepthTest: Number.POSITIVE_INFINITY,
            image: classSprite.get(record[field]),
            size: [config.size, config.size],
          };
        });
        _dots.set(items);
        _count = items.length;
        _counts = new Map(classes.map((c) => [c.key, 0]));
        for (const r of normalised.records)
          _counts.set(r[field], _counts.get(r[field]) + 1);
        _stale = normalised.stale;
        _fetchedAt = normalised.fetchedAt;
        _loaded = true;
        _unavailable = false;
        _lastUpdate = Date.now();
        _lastError = null;
        // The selected record has left the data: only its card goes.
        if (_selectedId) publishSelectedCard();
        console.log(`[Data:SaFacilities] Updated ${set}: ${_count} records`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SaFacilities] Fetch error:', e?.name || 'Error');
        _lastError = e?.message || msg('SA facilities source unavailable');
        if (!_loaded) _unavailable = true;
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
      _viewer = null;
      _enabled = false;
      _dots?.dispose();
      _dots = null;
      _setIds = new Set();
      resetData();
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_dots || !_dots.show) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const r of _recordById.values()) {
        if (result.length >= limit) break;
        result.push({
          id: r.id,
          name: r.name ?? null,
          kind: set === 'health' ? r.kind : (r.level ?? ''),
          lat: r.lat,
          lon: r.lon,
        });
      }
      return result;
    },

    getRowControls() {
      const counts = _counts;
      const legend = classes.map((cls, index) => ({
        label: t(cls.label),
        color: cls.color,
        count: counts.get(cls.key) ?? 0,
        ...(index === 0 ? { blurb: t(config.blurb) } : {}),
      }));
      const lines = [];
      if (_stale)
        lines.push(
          t('Showing the last copy from {date}; refresh failed', {
            date: sastCalendarDate(_fetchedAt),
          }),
        );
      if (_unavailable) lines.push(t('Data unavailable'));
      return {
        chips: [],
        legend,
        // Visible on the row, not hover-only.
        ...(lines.length ? { info: lines.join(' · ') } : {}),
      };
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
