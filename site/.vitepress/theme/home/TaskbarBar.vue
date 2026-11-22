<script setup lang="ts">
/**
 * The Windows taskbar at the bottom of the desktop: the TrayCommand icons, the clock,
 * and a "left" slot (the story's progress). The Proxy menu opens above its own icon.
 */
import { onMounted, ref } from 'vue';

defineProps<{ proxyOn: boolean; webOn: boolean; hoverP?: boolean; pressP?: boolean; menuShown?: boolean; pulse?: boolean; proxyLocked?: boolean }>();
defineEmits<{ proxy: []; web: [] }>();

const clock = ref('09:41');
const date = ref('21/11/2026');
onMounted(() => {
  const now = new Date();
  clock.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  date.value = now.toLocaleDateString();
});
</script>

<template>
  <div class="hs-taskbar">
    <div class="hs-tleft"><slot name="left" /></div>
    <div class="hs-tray" :class="{ pulse }">
      <slot name="coach" />
      <span class="hs-anchor">
        <slot name="menu" />
        <button
          class="hs-ti hs-ti-proxy"
          :class="{ hover: hoverP, down: pressP, locked: proxyLocked }"
          :aria-disabled="proxyLocked || undefined"
          aria-label="Proxy tray icon"
          :aria-expanded="!!menuShown"
          @click="$emit('proxy')"
        >
          <span class="hs-tile teal">P</span><span class="hs-dot" :class="{ on: proxyOn }"></span>
        </button>
      </span>
      <button class="hs-ti" :aria-label="`Web server tray icon, ${webOn ? 'on' : 'off'}`" @click="$emit('web')">
        <span class="hs-tile green">S</span><span class="hs-dot" :class="{ on: webOn }"></span>
      </button>
      <span class="hs-sys" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19.5" r="0.6" /></svg>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></svg>
      </span>
      <span class="hs-clock" aria-hidden="true"><span>{{ clock }}</span><span>{{ date }}</span></span>
    </div>
  </div>
</template>
