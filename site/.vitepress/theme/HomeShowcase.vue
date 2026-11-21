<script setup lang="ts">
import { withBase } from 'vitepress';

const looks = [
  { id: 'aurora', name: 'Aurora', note: 'Frosted glass over an aurora. The default.' },
  { id: 'terminal', name: 'Phosphor', note: 'A terminal: monospace, cream paper, phosphor green.' },
  { id: 'brutal', name: 'Brutal', note: 'Flat colours, thick outlines, hard shadows.' },
  { id: 'neon', name: 'Neon HUD', note: 'Cyan and magenta lines on night blue.' },
];
const features = [
  { img: 'aurora-schedules', title: 'Run when files arrive', text: 'Watch a folder, only within office hours, only if a check passes, after asking you with an alert.', link: '/guide/schedules' },
  { img: 'aurora-alert', title: 'Ask before running', text: 'A window over the others with up to four choices, fully keyboard driven, with a countdown.', link: '/guide/schedules#alerts-and-choices' },
  { img: 'aurora-import', title: 'Share and import', text: 'Export some trays with their icons; on import see what is new and decide about what is already there.', link: '/guide/sharing' },
];
/** Every picture exists light and dark: the one matching the site is shown. */
const src = (name: string, dark = false) => withBase(`/screens/home/${name}${dark ? '-dark' : ''}.png`);
</script>

<template>
  <div class="showcase">
    <section class="stage" aria-label="The editor and the launcher">
      <img class="editor only-light" :src="src('aurora-editor')" alt="The TrayCommand editor: trays on the left, the selected toggle and its click action on the right" />
      <img class="editor only-dark" :src="src('aurora-editor', true)" alt="The TrayCommand editor: trays on the left, the selected toggle and its click action on the right" />
      <img class="launcher only-light" :src="src('aurora-launcher')" alt="The launcher: type a few letters, press Enter" />
      <img class="launcher only-dark" :src="src('aurora-launcher', true)" alt="The launcher: type a few letters, press Enter" />
    </section>

    <section class="looks">
      <h2>Four looks, one app</h2>
      <p class="lead">Each look has its own icon and restyles every part of the editor and the launcher, light or dark. Choose it in <b>Settings → Look</b>.</p>
      <div class="look-grid">
        <div v-for="l in looks" :key="l.id" class="look">
          <img class="shot only-light" :src="src(`look-${l.id}`)" :alt="`TrayCommand in the ${l.name} look`" loading="lazy" />
          <img class="shot only-dark" :src="src(`look-${l.id}`, true)" :alt="`TrayCommand in the ${l.name} look, dark`" loading="lazy" />
          <span class="caption">
            <img class="icon" :src="withBase(`/icons/icon-${l.id}.png`)" alt="" />
            <span><b>{{ l.name }}</b><small>{{ l.note }}</small></span>
          </span>
        </div>
      </div>
    </section>

    <section class="more">
      <a v-for="f in features" :key="f.img" class="more-card" :href="withBase(f.link)">
        <img class="only-light" :src="src(f.img)" :alt="f.title" loading="lazy" />
        <img class="only-dark" :src="src(f.img, true)" :alt="f.title" loading="lazy" />
        <b>{{ f.title }}</b>
        <span>{{ f.text }}</span>
      </a>
    </section>
  </div>
</template>

<style scoped>
.showcase { max-width: 1152px; margin: 0 auto; padding: 8px 24px 72px; display: flex; flex-direction: column; gap: 72px; }
@media (min-width: 768px) { .showcase { padding: 8px 48px 96px; } }
.only-dark { display: none !important; }
:global(.dark) .only-dark { display: block !important; }
:global(.dark) .only-light { display: none !important; }

.stage { position: relative; padding-bottom: 8%; }
.stage img { border-radius: 16px; border: 1px solid var(--glass-line); }
.editor { display: block; width: 88%; box-shadow: 0 30px 80px -30px var(--glow), 0 2px 10px rgb(27 25 52 / 0.1); }
.launcher { position: absolute; right: 0; bottom: 0; width: 46%; border-radius: 18px; box-shadow: 0 30px 70px -20px rgb(27 25 52 / 0.45), 0 0 0 1px var(--glass-edge); }

h2 { font-size: 30px; line-height: 1.2; letter-spacing: -0.015em; margin: 0 0 8px; text-wrap: balance; }
.lead { color: var(--vp-c-text-2); max-width: 64ch; margin: 0 0 28px; }

.look-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
@media (max-width: 640px) { .look-grid { grid-template-columns: 1fr; } }
.look {
  display: flex; flex-direction: column; gap: 12px; padding: 12px; border-radius: 20px;
  background: var(--glass); border: 1px solid var(--glass-line); box-shadow: inset 0 1px 0 var(--glass-edge); backdrop-filter: blur(16px);
}
.look .shot { display: block; width: 100%; border-radius: 12px; border: 1px solid var(--glass-line); }
.caption { display: flex; align-items: center; gap: 12px; padding: 0 4px 4px; }
.caption .icon { width: 40px; height: 40px; flex: none; }
.caption b { display: block; font-size: 16px; }
.caption small { color: var(--vp-c-text-2); font-size: 13.5px; }

.more { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
@media (max-width: 860px) { .more { grid-template-columns: 1fr; } }
.more-card {
  display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 18px; border-radius: 20px; text-decoration: none !important; color: inherit !important;
  background: var(--glass); border: 1px solid var(--glass-line); box-shadow: inset 0 1px 0 var(--glass-edge); backdrop-filter: blur(16px);
  transition: transform 0.2s, box-shadow 0.2s;
}
.more-card:hover { transform: translateY(-3px); box-shadow: inset 0 1px 0 var(--glass-edge), 0 20px 50px -24px var(--glow); }
.more-card img { display: block; width: 100%; aspect-ratio: 3 / 2; object-fit: contain; background: var(--vp-c-bg-soft); border-radius: 12px; border: 1px solid var(--glass-line); margin-bottom: 6px; }
.more-card b { font-size: 16px; padding: 0 4px; }
.more-card span { color: var(--vp-c-text-2); font-size: 14px; padding: 0 4px; }

@media (prefers-reduced-motion: reduce) { .more-card, .more-card:hover { transition: none; transform: none; } }
</style>
