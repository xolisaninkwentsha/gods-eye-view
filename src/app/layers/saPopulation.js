import { createSaPopulationLayer } from '../../layers/saPopulation/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';

/** Wire the SA population grid into the application catalog. */
export function createApplicationSaPopulation(options = {}) {
  return createSaPopulationLayer({
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
