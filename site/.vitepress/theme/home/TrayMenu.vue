<script setup lang="ts">
/** The context menu of the Proxy tray icon. */
defineProps<{ proxyOn: boolean; hover?: boolean }>();
defineEmits<{ toggle: [] }>();
</script>

<template>
  <div class="hs-menu hs-glass" role="menu" aria-label="Proxy">
    <button class="hs-mrow main" :class="{ hover }" role="menuitemcheckbox" :aria-checked="proxyOn" @click="$emit('toggle')">
      <span class="hs-check" :class="{ on: proxyOn }"></span>
      <span><b>Proxy</b><small>{{ proxyOn ? 'Click to turn off' : 'Click to turn on' }}</small></span>
      <span class="hs-pill" :class="{ on: proxyOn }">{{ proxyOn ? 'ON' : 'OFF' }}</span>
    </button>
    <div class="hs-msep"></div>
    <div class="hs-mrow plain"><span></span><span>Open proxy settings</span><kbd>Ctrl Alt P</kbd></div>
    <div class="hs-mrow plain"><span></span><span>Show the log</span></div>
  </div>
</template>
