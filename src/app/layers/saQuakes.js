import { createSaQuakesLayer } from '../../layers/saQuakes/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';

/** Wire the South African earthquakes into the application catalog. */
export function createApplicationSaQuakes(options) {
  return createSaQuakesLayer({
    overlayHost: {
      setEntries: overlays.setOverlayEntries,
      setVisible: overlays.setOverlaySourceVisible,
      clearSource: overlays.clearOverlaySource,
      hitTest: overlays.hitTestWorldOverlay,
    },
    picking,
    ...options,
  });
}
