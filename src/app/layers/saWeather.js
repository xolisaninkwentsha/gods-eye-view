import { createSaWeatherLayer } from '../../layers/saWeather/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';

/** Wire the South African weather warnings into the application catalog. */
export function createApplicationSaWeather(options) {
  return createSaWeatherLayer({
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
