import { createSaNewsLayer } from '../../layers/saNews/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';

/** Wire the South African news into the application catalog. */
export function createApplicationSaNews(options) {
  return createSaNewsLayer({
    overlayHost: {
      setEntries: overlays.setOverlayEntries,
      setVisible: overlays.setOverlaySourceVisible,
      clearSource: overlays.clearOverlaySource,
      hitTest: overlays.hitTestWorldOverlay,
    },
    openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    picking,
    ...options,
  });
}
