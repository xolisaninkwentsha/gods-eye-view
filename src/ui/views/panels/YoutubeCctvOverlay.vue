<script setup>
import { ref } from 'vue';
import { t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import UiCloseButton from '../../kit/UiCloseButton.vue';

// A YouTube live camera's floating player, teleported to the end of the page.
// `createYoutubeCctvOverlay()` owns every decision and renders this with the
// `view` it computes; the player itself goes into the exposed `player` host,
// which the template never binds. It shares the Québec window's look.
defineProps({
  view: { type: Object, required: true },
});
const emit = defineEmits(['close', 'play', 'retry', 'keydown']);

const player = ref(null);
defineExpose({ player });
</script>

<!-- Only line breaks inside tags: the markup has no whitespace between elements. -->
<template><Teleport to="body"
    ><section
      class="qci-panel yci-panel"
      :hidden="view.panelHidden"
      role="region"
      :aria-label="t('CCTV camera')"
      @keydown="emit('keydown', $event)"
      ><header class="qci-header yci-header"
        ><strong>{{ view.title }}</strong
        ><UiCloseButton
          :label="t('Close camera preview')"
          @click="emit('close')" /></header
      ><a
        class="qci-credit yci-credit"
        target="_blank"
        rel="noopener noreferrer"
        :href="view.creditHref"
        :hidden="view.creditHidden"
        >{{ view.credit }}</a
      ><div ref="player" class="yci-player"></div
      ><div class="qci-actions"
        ><UiButton
          class="qci-play yci-play"
          :hidden="view.playHidden"
          @click="emit('play')"
          >{{ t('Play') }}</UiButton
        ><UiButton
          class="yci-retry"
          :hidden="view.retryHidden"
          @click="emit('retry')"
          >{{ t('Try again') }}</UiButton></div
      ><p class="qci-note yci-status" :hidden="view.statusHidden">{{ view.status }}</p
      ><a
        class="yci-open"
        target="_blank"
        rel="noopener noreferrer"
        :href="view.openHref"
        :hidden="view.openHidden"
        >{{ t('Open on YouTube') }}</a
      ><p class="qci-note yci-note">{{
        t('Video plays from YouTube, which sees your IP address.')
      }}</p></section
  ></Teleport
></template>
