<script setup lang="ts">
/** The notification TrayCommand shows after a toggle ran. */
import { withBase } from 'vitepress';
defineProps<{ on: boolean }>();
</script>

<template>
  <div class="hs-toast hs-glass" role="status">
    <img :src="withBase('/icons/icon-aurora.png')" alt="" width="32" height="32" />
    <span>
      <small>TrayCommand</small>
      <b>{{ on ? 'Proxy is on' : 'Proxy is off' }}</b>
      <code>{{ on ? 'netsh winhttp set proxy 10.0.0.8:3128' : 'netsh winhttp reset proxy' }}</code>
      <small>Exited with 0</small>
    </span>
  </div>
</template>
