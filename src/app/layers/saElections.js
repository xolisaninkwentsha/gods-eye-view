import { createSaElectionsLayer } from '../../layers/saElections/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';

/** Wire one level of the South African 2026 election map into the application catalog. */
export function createApplicationSaElections(options) {
  return createSaElectionsLayer({
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
