<script setup lang="ts">
/** The alert a schedule shows before running: choices and a countdown. */
defineProps<{ seconds: number; pressed?: boolean }>();
</script>

<template>
  <div class="hs-alert hs-glass">
    <div class="hs-ahead">
      <span class="hs-tile violet">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /></svg>
      </span>
      <span><b>New invoices</b><small>3 files arrived in <code>C:\Invoices\in</code></small></span>
    </div>
    <div class="hs-choice sel" :class="{ down: pressed }"><kbd>1</kbd>Import now</div>
    <div class="hs-choice"><kbd>2</kbd>Later</div>
    <div class="hs-choice"><kbd>3</kbd>Open the folder</div>
    <div class="hs-count"><span :style="{ width: `${(seconds / 12) * 100}%` }"></span></div>
    <small class="hs-countlabel">{{ pressed ? 'Importing…' : `Import now in ${Math.ceil(seconds)} s` }}</small>
  </div>
</template>
