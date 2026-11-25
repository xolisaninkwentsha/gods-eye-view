import { createSaFacilitiesLayer } from '../../layers/saFacilities/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';

/** Wire the SA health facilities or schools (`options.set`) into the application catalog. */
export function createApplicationSaFacilities(options) {
  return createSaFacilitiesLayer({
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
