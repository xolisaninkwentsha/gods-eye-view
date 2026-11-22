import { h, render as renderVue } from 'vue';
import { t } from '../i18n/index.js';
import { createYouTubeLivePlayer } from '../data/youtubeLivePlayer.js';
import YoutubeCctvOverlay from './views/panels/YoutubeCctvOverlay.vue';

/** A YouTube video ID, as the camera catalog validates it. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** An https link without credentials, or null. */
function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Attach the active YouTube live camera to a floating player window. The
 * browser contacts YouTube only after the viewer presses Play for that
 * camera; selecting it (by click, auto-hop, a scene or voice) only shows its
 * name, credit and the Play control. Choosing another camera, none, closing
 * the window or disposing destroys the player, so no stream keeps playing
 * out of sight.
 *
 * @param {{documentRef?: Document, createPlayer?: typeof createYouTubeLivePlayer}} [options]
 * @returns {{setCamera: (camera: object|null, options?: {reselected?: boolean}) => void,
 *   dispose: () => void}|null}
 */
export function createYoutubeCctvOverlay({
  documentRef = globalThis.document,
  createPlayer = createYouTubeLivePlayer,
} = {}) {
  if (!documentRef) return null;

  const view = {
    panelHidden: true,
    title: '',
    credit: '',
    creditHref: null,
    creditHidden: true,
    playHidden: false,
    retryHidden: true,
    status: '',
    statusHidden: true,
    openHref: null,
    openHidden: true,
  };
  const host = documentRef.createElement('div');
  let disposed = false;
  let exposed = null;
  let selected = null;
  let closedCameraId = null;
  let player = null;
  /** Each player gets its own token, so a replaced player's late state is ignored. */
  let playerToken = 0;

  const handlers = {
    onClose: closeWindow,
    onPlay: startPlayback,
    onRetry: startPlayback,
    onKeydown(event) {
      if (event.key === 'Escape') closeWindow();
    },
  };

  /** Render the view now; the window goes to the end of the body. */
  function paint() {
    if (disposed) return;
    const vnode = h(YoutubeCctvOverlay, { view: { ...view }, ...handlers });
    renderVue(vnode, host);
    exposed = vnode.component.exposed;
  }

  /** Back to the selected-but-not-playing state. */
  function resetPlayback() {
    view.playHidden = false;
    view.retryHidden = true;
    view.status = '';
    view.statusHidden = true;
    view.openHidden = true;
  }

  function stopPlayer() {
    const current = player;
    player = null;
    current?.destroy();
  }

  function onPlayerChange(owner, { state }) {
    if (disposed || owner !== playerToken) return;
    if (state === 'offline' || state === 'unavailable') {
      view.status =
        state === 'offline'
          ? t('Stream is offline')
          : t('This stream cannot play here');
      view.statusHidden = false;
      view.openHidden = false;
      // A refused embed will refuse again; an offline stream may come back.
      view.retryHidden = state === 'unavailable';
    } else {
      view.status = '';
      view.statusHidden = true;
      view.openHidden = true;
      view.retryHidden = true;
    }
    paint();
  }

  function startPlayback() {
    if (!selected || disposed) return;
    stopPlayer();
    resetPlayback();
    view.playHidden = true;
    paint();
    const token = ++playerToken;
    player = createPlayer({
      host: exposed.player.value,
      videoId: selected.youtubeVideoId,
      onChange: (change) => onPlayerChange(token, change),
    });
  }

  function closeWindow() {
    stopPlayer();
    resetPlayback();
    closedCameraId = selected?.id ?? null;
    view.panelHidden = true;
    paint();
  }

  /**
   * Show the window for `camera`, or hide it for null or a camera that is not
   * a YouTube live camera. A routine update for the same camera keeps the
   * stream; `reselected` reopens a window the viewer closed.
   */
  function setCamera(camera, { reselected = false } = {}) {
    if (disposed) return;
    const next =
      camera && VIDEO_ID.test(String(camera.youtubeVideoId || ''))
        ? camera
        : null;
    if (!next) {
      stopPlayer();
      resetPlayback();
      selected = null;
      closedCameraId = null;
      view.panelHidden = true;
      paint();
      return;
    }
    if (
      next.id !== selected?.id ||
      next.youtubeVideoId !== selected?.youtubeVideoId
    ) {
      stopPlayer();
      resetPlayback();
      closedCameraId = null;
    }
    if (reselected) closedCameraId = null;
    selected = next;
    view.title = String(next.name || next.id);
    view.credit = String(next.credit || next.provider || '');
    view.creditHref = safeHttpsUrl(next.sourceUrl);
    view.creditHidden = !view.credit;
    view.openHref = `https://www.youtube.com/watch?v=${next.youtubeVideoId}`;
    view.panelHidden = closedCameraId === next.id;
    paint();
  }

  function dispose() {
    if (disposed) return;
    stopPlayer();
    renderVue(null, host);
    disposed = true;
  }

  paint();
  return { setCamera, dispose };
}
