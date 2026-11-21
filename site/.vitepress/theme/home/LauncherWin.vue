<script setup lang="ts">
/** The keyboard launcher, filtered by what has been typed so far. */
import { computed } from 'vue';

const props = defineProps<{ query: string; webOn: boolean; enter?: boolean }>();

const results = [
  { name: 'Web server', path: 'Toggle', tile: 'S', tone: 'green', toggle: true },
  { name: 'Stop server', path: 'Web server', tile: '>_' },
  { name: 'Public', path: 'Web server › Sites', tile: '>_' },
  { name: 'Open configuration', path: 'Web server', tile: '>_' },
  { name: 'VS Code', path: '2 entries', tile: '{}', tone: 'blue' },
  { name: 'Proxy', path: 'Toggle', tile: 'P', tone: 'teal' },
];
const shown = computed(() => {
  const q = props.query.toLowerCase();
  const r = q ? results.filter((x) => (x.name + ' ' + x.path).toLowerCase().includes(q)) : results;
  return r.slice(0, 4);
});
function parts(name: string) {
  const q = props.query.toLowerCase();
  const i = q ? name.toLowerCase().indexOf(q) : -1;
  return i < 0 ? [name, '', ''] : [name.slice(0, i), name.slice(i, i + q.length), name.slice(i + q.length)];
}
</script>

<template>
  <div class="hs-launcher hs-glass">
    <div class="hs-lq">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <span class="hs-typed">{{ query }}<i class="hs-caret"></i><span v-if="!query" class="hs-ph">Type to search every tray</span></span>
    </div>
    <div v-for="(r, i) in shown" :key="r.name" class="hs-lrow" :class="{ sel: i === 0 }">
      <span class="hs-tile" :class="r.tone">{{ r.tile }}</span>
      <span class="hs-lname">
        <b>{{ parts(r.name)[0] }}<u>{{ parts(r.name)[1] }}</u>{{ parts(r.name)[2] }}</b>
        <small>{{ r.path }}</small>
      </span>
      <span v-if="r.toggle" class="hs-pill" :class="{ on: webOn }">{{ webOn ? 'ON' : 'OFF' }}</span>
      <span v-if="i === 0" class="hs-act">
        {{ r.toggle ? (webOn ? 'Turned on' : 'Turn on') : 'Run' }}
        <kbd :class="{ down: enter }">Enter</kbd>
      </span>
    </div>
  </div>
</template>
