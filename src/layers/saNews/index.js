import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf } from '../../render/rendererOf.js';
import { cssColor } from '../../render/color.js';
import { inputFor as defaultInputFor } from '../../input/dispatcher.js';
import { formatNumber, msg, t } from '../../i18n/index.js';
import { buildSaNewsCard } from './cards.js';
import { SA_NEWS_KINDS, normalizeSaNews, placeStories } from './records.js';
export { createSaNewsSource } from './source.js';
export * from './cards.js';
export * from './records.js';

/** The draw set a layer makes starts with this; picks name it as `Hit.set`. */
export const SA_NEWS_SET_PREFIX = 'sa-news';
export const SA_NEWS_OVERLAY_SOURCE_ID = 'sa-news';
let instances = 0;

const PICK_PREFIX = 'sa-news:';
const OUTLINE = Object.freeze([1, 1, 1, 0.9]);
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
const KIND_COLOR = new Map(
  SA_NEWS_KINDS.map((k) => [k.key, [...cssColor(k.color).slice(0, 3), 1]]),
);

/** The status lines of the legend; every part of `status` may be missing. */
function statusLines(status) {
  const lines = [];
  const gdelt = status?.gdelt;
  if (gdelt?.state === 'failed') lines.push(t('GDELT unavailable'));
  else if (gdelt && gdelt.complete !== true) {
    const covered = Number.isFinite(gdelt.hoursCovered)
      ? gdelt.hoursCovered
      : 0;
    const hours = Math.floor(Math.max(0, covered) * 10) / 10;
    lines.push(
      t('GDELT: {hours} of 24 h loaded', {
        hours: formatNumber(hours, { maximumFractionDigits: 1 }),
      }),
    );
  }
  const rss = status?.rss;
  if (rss && typeof rss === 'object') {
    const states = Object.values(rss);
    const failed = states.filter((s) => s === 'failed').length;
    if (failed)
      lines.push(
        t('Headlines: {failed} of {total} outlets unavailable', {
          failed,
          total: states.length,
        }),
      );
  }
  return lines;
}

/**
 * Own the South African news display: one ground-clamped dot per story in a
 * renderer draw set (`drawOf(viewer)`), its refresh lifecycle and click
 * selection. A selected dot's card opens the story through `openExternal`.
 */
export function createSaNewsLayer({
  source,
  overlayHost = null,
  inputFor = defaultInputFor,
  picking = null,
  openExternal = null,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SA news requires a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dots = null;
  let _setIds = new Set();
  let _count = 0;
  let _status = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _clickSubscription = null;
  let _selectedId = null;
  let _selectedCardId = null;
  /** @type {Map<string, object>} item id -> placed story */
  const _storyById = new Map();

  const canSelect = () => overlayHost && inputFor && picking;

  function publishSelectedCard() {
    if (!canSelect()) return;
    const placed = _selectedId ? _storyById.get(_selectedId) : null;
    if (!placed) {
      _selectedId = null;
      _selectedCardId = null;
      overlayHost.clearSource(SA_NEWS_OVERLAY_SOURCE_ID);
      return;
    }
    const card = {
      ...buildSaNewsCard(placed, now()),
      position: fromDegrees(placed.lon, placed.lat),
    };
    _selectedCardId = card.id;
    if (!openExternal) card.interactive = false;
    else {
      const { url } = placed;
      // Keyboard/assistive activation mirrors the pointer click-through.
      card.activate = () => {
        openExternal(url);
        return true;
      };
    }
    overlayHost.setEntries(
      SA_NEWS_OVERLAY_SOURCE_ID,
      [card],
      CARD_HOST_OPTIONS,
    );
  }

  /** The item a click's draw hit belongs to: a dot of this layer's own set; else null. */
  function pickedItemId(hit) {
    if (!hit || hit.surface || !_setIds.has(hit.set)) return null;
    return typeof hit.id === 'string' && _storyById.has(hit.id) ? hit.id : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickSubscription || !_viewer) return;
    // Deliberately NOT registered in the pick-ownership registry: unowned,
    // our picks read as "empty space" to sibling layers.
    _clickSubscription = inputFor(_viewer).onClick((event) => {
      // A click on the story's own card opens it; any other card or label
      // painted on top takes the click and leaves the selection alone.
      const cardHit = picking.clickCard?.(event) ?? null;
      if (cardHit) {
        const placed = _selectedId ? _storyById.get(_selectedId) : null;
        if (
          cardHit.sourceId === SA_NEWS_OVERLAY_SOURCE_ID &&
          cardHit.entryId === _selectedCardId &&
          placed &&
          openExternal
        )
          openExternal(placed.url);
        return;
      }
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
      overlayHost.clearSource(SA_NEWS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible?.(SA_NEWS_OVERLAY_SOURCE_ID, false);
    }
  }

  const layer = {
    id: 'sa-news',
    name: 'SA news (24h)',
    icon: '📰',
    source: 'GDELT · SA outlets',
    updateInterval: 300000,

    init(viewer) {
      if (_viewer) throw new Error('SA news layer is already initialized');
      const draw = drawOf(viewer);
      _dots = draw.points({
        id: `${SA_NEWS_SET_PREFIX}:${++instances}:dots`,
        clampTo: 'both',
        horizonCull: true,
        show: false,
      });
      _setIds = new Set([_dots.id]);
      _viewer = viewer;
      _count = 0;
      _status = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:SaNews] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dots) _dots.show = true;
      overlayHost?.setVisible?.(SA_NEWS_OVERLAY_SOURCE_ID, true);
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
        const normalized = normalizeSaNews(payload);
        if (!normalized) throw new Error(msg('Malformed SA news'));

        // Oldest first, so the newest is drawn last and sits on top.
        const placed = placeStories(normalized.stories).sort(
          (a, b) => a.publishedAt - b.publishedAt,
        );
        _storyById.clear();
        const items = placed.map((story) => {
          const id = `${PICK_PREFIX}${story.id}`;
          _storyById.set(id, story);
          return {
            id,
            pos: fromDegrees(story.lon, story.lat),
            height: 'clampGround',
            disableDepthTest: Number.POSITIVE_INFINITY,
            pixelSize: 7,
            color: [...KIND_COLOR.get(story.kind)],
            outlineColor: [...OUTLINE],
            outlineWidth: 1,
          };
        });
        _dots.set(items);
        _status = normalized.status;
        _count = items.length;
        _lastUpdate = Date.now();
        _lastError = null;
        // The selected story has left the window: only its card goes.
        if (_selectedId) publishSelectedCard();
        console.log(`[Data:SaNews] Updated: ${_count} stories`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SaNews] Fetch error:', e?.name || 'Error');
        _lastError = e?.message || msg('SA news source unavailable');
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
      _storyById.clear();
      _viewer = null;
      _enabled = false;
      _dots?.dispose();
      _dots = null;
      _setIds = new Set();
      _count = 0;
      _status = null;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_dots || !_dots.show) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      const newestFirst = [..._storyById.values()].sort(
        (a, b) => b.publishedAt - a.publishedAt,
      );
      for (const s of newestFirst) {
        if (result.length >= limit) break;
        result.push({
          id: s.id,
          name: s.title,
          kind: s.kind,
          place: s.place,
          source: s.source,
          publishedAt: s.publishedAt,
          lat: s.placeLat,
          lon: s.placeLon,
        });
      }
      return result;
    },

    getRowControls() {
      const counts = new Map(SA_NEWS_KINDS.map((k) => [k.key, 0]));
      for (const s of _storyById.values())
        counts.set(s.kind, counts.get(s.kind) + 1);
      const legend = SA_NEWS_KINDS.map((kind, index) => ({
        label: t(kind.label),
        color: kind.color,
        count: counts.get(kind.key),
        ...(index === 0
          ? {
              blurb: t(
                'GDELT events placed at city level and SA outlet headlines matched to town names. Click a card to open the story.',
              ),
            }
          : {}),
      }));
      const lines = statusLines(_status);
      return {
        chips: [],
        legend,
        // Visible on the row, not hover-only: partial coverage and failed
        // sources must show without a hover.
        ...(lines.length ? { info: lines.join(' · ') } : {}),
      };
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
