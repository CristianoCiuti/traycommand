<script setup lang="ts">
/*
 * The home page: an Aurora desktop (the aurora is the wallpaper, the taskbar carries the
 * TrayCommand icons).
 *
 * With motion: the desktop is pinned while the story section scrolls past, and every
 * visual state is a pure function of the scroll position, so scrolling back shows exactly
 * what was there before. Each scene moves continuously with the scroll: a pointer clicks
 * the tray, keys get pressed, files drop into a folder, a countdown runs. Only one window
 * is on screen at a time. A progress bar in the taskbar shows where you are.
 *
 * With reduced motion: nothing is pinned. The four scenes are plain sections, each with
 * a small desktop already in its final state.
 *
 * Clicks work in both: the Proxy icon opens its menu, the toggle flips, the Web server
 * icon flips. A click holds until the story moves to another scene.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { withBase } from 'vitepress';
import TaskbarBar from './home/TaskbarBar.vue';
import TrayMenu from './home/TrayMenu.vue';
import ToastWin from './home/ToastWin.vue';
import LauncherWin from './home/LauncherWin.vue';
import AlertWin from './home/AlertWin.vue';
import './home/home.css';

const releases = 'https://github.com/CristianoCiuti/traycommand/releases/latest';

/* ---------- motion preference ---------- */
/* reduced motion wins, unless the visitor asks for the animated story (?motion=on or the link) */
const reduced = ref(false);
const forced = ref(false);
let mq: MediaQueryList | null = null;
const onMq = () => { reduced.value = !!mq?.matches && !forced.value; nextTick(fitLayout); requestAnimationFrame(measure); };
function setMotion(on: boolean) {
  forced.value = on;
  try { on ? sessionStorage.setItem('hs-motion', 'on') : sessionStorage.removeItem('hs-motion'); } catch { /* storage blocked */ }
  onMq();
  if (on) requestAnimationFrame(() => story.value?.scrollIntoView());
}

/* ---------- the timeline: lengths of the scenes in viewport heights ---------- */
const SEG = [0.5, 1.05, 1.1, 0.95, 0.6]; // hero, tray, launcher, schedules, editor
const STARTS = SEG.map((_, i) => SEG.slice(0, i).reduce((a, b) => a + b, 0));
const TOTAL = SEG.reduce((a, b) => a + b, 0);
const storyHeight = `${(TOTAL + 1) * 100}vh`;

const story = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const seg = ref(0);
const t = ref(0);

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ramp = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
const ease = (x: number) => x * x * (3 - 2 * x);
const win = (x: number, a: number, b: number, c: number, d: number) => Math.min(ramp(a, b, x), 1 - ramp(c, d, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/* clicks: hold until the scene changes */
const manual = reactive<{ proxy: boolean | null; web: boolean | null; menu: boolean | null; toast: boolean }>({ proxy: null, web: null, menu: null, toast: false });
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function clickProxyIcon() {
  manual.menu = !(menuAlpha.value > 0.5);
}
function clickProxyEntry() {
  manual.proxy = !proxyOn.value;
  manual.menu = false;
  manual.toast = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (manual.toast = false), 3200);
}
function clickWeb() {
  manual.web = !webOn.value;
}

/* ---------- derived state ---------- */
const s = computed(() => (reduced.value ? -1 : seg.value));

const heroOut = computed(() => (s.value < 0 ? 0 : s.value === 0 ? ease(ramp(0.05, 0.6, t.value)) : 1));
function caption(i: number) {
  let a = 0;
  let dir = 1;
  if (i === 1 && s.value === 0) a = ramp(0.45, 1, t.value); // comes in while the hero leaves
  else if (s.value === i) {
    a = Math.min(i === 1 ? 1 : ramp(0, 0.08, t.value), i === 4 ? 1 : 1 - ramp(0.9, 1, t.value));
    dir = t.value < 0.5 ? 1 : -1;
  }
  if (a <= 0) return { opacity: 0, transform: 'translateY(24px)', visibility: 'hidden' as const };
  return { opacity: a, transform: `translateY(${(1 - a) * 24 * dir}px)`, visibility: 'visible' as const };
}

const menuDerived = computed(() => (s.value === 1 ? win(t.value, 0.18, 0.25, 0.54, 0.6) : 0));
const menuAlpha = computed(() => (manual.menu === null ? menuDerived.value : manual.menu ? 1 : 0));
const proxyOn = computed(() => manual.proxy ?? (s.value > 1 || (s.value === 1 && t.value >= 0.5)));
const toastAlpha = computed(() => Math.max(s.value === 1 ? win(t.value, 0.6, 0.67, 0.93, 0.99) : 0, manual.toast ? 1 : 0));
const rowHover = computed(() => s.value === 1 && t.value > 0.4 && t.value < 0.56);

/* scene 2: keys, launcher, typing, Enter */
/* the keys are gone before the launcher shows: on a phone both sit in the same place */
const keysAlpha = computed(() => (s.value === 2 ? win(t.value, 0, 0.04, 0.24, 0.29) : 0));
const keyDown = computed(() => ({ ctrl: s.value === 2 && t.value > 0.07, alt: s.value === 2 && t.value > 0.12, space: s.value === 2 && t.value > 0.17 }));
const launcherAlpha = computed(() => (s.value === 2 ? win(t.value, 0.29, 0.35, 0.88, 0.95) : 0));
const query = computed(() => (s.value === 2 && t.value >= 0.37 ? 'web'.slice(0, Math.min(3, Math.floor((t.value - 0.37) / 0.07) + 1)) : ''));
const enterDown = computed(() => s.value === 2 && t.value > 0.6 && t.value < 0.67);
const webOn = computed(() => manual.web ?? (s.value > 2 || (s.value === 2 && t.value >= 0.64)));

/* scene 3: files drop into the folder, then the alert counts down */
const folderAlpha = computed(() => (s.value === 3 ? win(t.value, 0, 0.04, 0.32, 0.38) : 0));
const files = computed(() => [0, 1, 2].map((k) => (s.value === 3 ? ease(ramp(0.04 + k * 0.07, 0.15 + k * 0.07, t.value)) : 0)));
const filesIn = computed(() => files.value.filter((p) => p >= 1).length);
const alertAlpha = computed(() => (s.value === 3 ? win(t.value, 0.34, 0.42, 0.95, 1) : 0));
const seconds = computed(() => (s.value === 3 ? 12 * (1 - ramp(0.42, 0.9, t.value)) : 12));
const alertPressed = computed(() => s.value === 3 && t.value >= 0.9);

/* scene 4: the editor rises */
const rise = computed(() => (s.value === 4 ? ease(ramp(0, 0.55, t.value)) : 0));

/* progress in the taskbar */
const chapters = ['Tray menu', 'Launcher', 'Schedules', 'Editor'];
const fill = (i: number) => (s.value > i ? 1 : s.value === i ? t.value : 0);
function jump(i: number) {
  if (!story.value) return;
  const top = story.value.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: top + (STARTS[i] + 0.02) * window.innerHeight, behavior: 'smooth' });
}

/* ---------- the pointer: glides to the Proxy icon, clicks, then the toggle ---------- */
const pointer = reactive({ x: 0, y: 0, alpha: 0, down: false });
function placePointer() {
  const st = stage.value?.getBoundingClientRect();
  const icon = stage.value?.querySelector('.hs-ti-proxy')?.getBoundingClientRect();
  const row = stage.value?.querySelector('.hs-mrow.main')?.getBoundingClientRect();
  if (!st || !icon || !row || s.value < 0 || manual.menu !== null) { pointer.alpha = 0; return; }
  const start = { x: st.width * 0.72, y: st.height * 0.42 };
  const P = { x: icon.left - st.left + icon.width * 0.5, y: icon.top - st.top + icon.height * 0.5 };
  const R = { x: row.left - st.left + row.width * 0.35, y: row.top - st.top + row.height * 0.5 };
  let at = start;
  pointer.down = false;
  if (s.value === 0) {
    pointer.alpha = ramp(0.35, 0.6, t.value);
    const k = ease(ramp(0.35, 1, t.value)); // reaches the icon as the scene starts
    at = { x: lerp(start.x, P.x, k), y: lerp(start.y, P.y, k) };
  } else if (s.value === 1) {
    pointer.alpha = 1 - ramp(0.64, 0.72, t.value);
    const k = ease(ramp(0.27, 0.44, t.value));
    at = { x: lerp(P.x, R.x, k), y: lerp(P.y, R.y, k) };
    pointer.down = (t.value > 0.14 && t.value < 0.19) || (t.value > 0.46 && t.value < 0.51);
  } else {
    pointer.alpha = 0;
  }
  pointer.x = at.x;
  pointer.y = at.y;
}

/* ---------- looks ---------- */
const looks = [
  { id: 'aurora', name: 'Aurora', note: 'Frosted glass over an aurora. The one you start with.' },
  { id: 'terminal', name: 'Phosphor', note: 'A terminal: monospace, cream paper, phosphor green.' },
  { id: 'brutal', name: 'Brutal', note: 'Flat colours, thick outlines, hard shadows.' },
  { id: 'neon', name: 'Neon HUD', note: 'Cyan and magenta lines on night blue.' },
];
const looksEl = ref<HTMLElement | null>(null);
const look = ref(0);
let lookByScroll = -1;
function pickLook(i: number) { look.value = i; }

/* ---------- scroll ---------- */
/*
 * The story does not jump to the scroll position: it follows it with a short exponential
 * ease (TAU), so a mouse wheel notch (often ~100px at once, with no smooth scrolling when
 * the system has animations off) becomes a short continuous movement. Dragging the
 * scrollbar, already continuous, looks the same as before.
 */
const TAU = 0.11; // seconds to cover ~63% of the gap
let raf = 0;
let shown: number | null = null; // story position on screen, in viewport heights
let lastFrame = 0;
function measure(now = performance.now()) {
  raf = 0;
  const vh = window.innerHeight;
  if (!reduced.value && story.value) {
    const top = story.value.getBoundingClientRect().top;
    const target = clamp(-top / vh, 0, TOTAL - 1e-4);
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    shown = shown === null || dt === 0 ? target : shown + (target - shown) * (1 - Math.exp(-dt / TAU));
    if (Math.abs(target - shown) < 0.0005) shown = target;
    else raf = requestAnimationFrame(measure); // keep easing until it arrives
    if (shown === target) lastFrame = 0;
    const y = shown;
    let i = SEG.length - 1;
    while (i > 0 && y < STARTS[i]) i--;
    if (i !== seg.value) { manual.proxy = manual.web = manual.menu = null; manual.toast = false; }
    seg.value = i;
    t.value = (y - STARTS[i]) / SEG[i];
  }
  placePointer();
  const pinned = looksEl.value && getComputedStyle(looksEl.value.firstElementChild as Element).position === 'sticky';
  if (!reduced.value && looksEl.value && pinned) { // not pinned (phones, short windows): icons only
    const r = looksEl.value.getBoundingClientRect();
    const span = r.height - vh;
    const p = span > 0 ? clamp(-r.top / span, 0, 0.9999) : 0;
    const byScroll = Math.floor(p * looks.length);
    if (byScroll !== lookByScroll) { lookByScroll = byScroll; look.value = byScroll; }
  }
}
/*
 * Layout that depends on real sizes. On narrow screens the windows go under the captions:
 * --hs-captop is where the longest caption ends. Each window of the story then gets --fit,
 * the scale that makes it fit the room left (never above 1).
 */
const STACKED = '(max-width: 639px), (max-width: 860px) and (min-height: 521px)'; // same as home.css
function fitLayout() {
  const st = stage.value;
  if (!st) return;
  const copy = st.querySelector<HTMLElement>('.hs-copy');
  const caps = [...st.querySelectorAll<HTMLElement>('.hs-cap')];
  const tray = [st.querySelector<HTMLElement>('.hs-menu'), st.querySelector<HTMLElement>('.hs-toast-pos')];
  if (window.matchMedia(STACKED).matches && copy && caps.length) {
    const stTop = st.getBoundingClientRect().top;
    const capBottom = copy.getBoundingClientRect().top - stTop + Math.max(...caps.map((c) => c.offsetHeight)) + 16;
    st.style.setProperty('--hs-captop', `${Math.round(capBottom)}px`);
    // the tray menu and the notification rise from the taskbar: shrink them to stay under the text
    const barTop = (st.querySelector<HTMLElement>('.hs-taskbar')?.getBoundingClientRect().top ?? 0) - stTop;
    for (const el of tray) {
      if (!el?.offsetHeight) continue;
      el.style.setProperty('--fit', Math.min(1, (barTop - 14 - capBottom) / el.offsetHeight).toFixed(3));
    }
  } else {
    st.style.removeProperty('--hs-captop');
    // side by side: the menu and the notification stop before the text column (both shrink
    // from their right edge, which stays where it is)
    const capRight = copy && caps.length ? Math.max(...caps.map((c) => c.getBoundingClientRect().right)) : 0;
    for (const el of tray) {
      if (!el?.offsetWidth) continue;
      el.style.setProperty('--fit', Math.min(1, (el.getBoundingClientRect().right - capRight - 16) / el.offsetWidth).toFixed(3));
    }
  }
  const area = st.querySelector<HTMLElement>('.hs-area');
  if (!area) return;
  const aw = area.clientWidth;
  const ah = area.clientHeight;
  for (const el of [...area.children] as HTMLElement[]) {
    if (!el.offsetHeight) continue;
    el.style.setProperty('--fit', Math.min(1, ah / el.offsetHeight, aw / el.offsetWidth).toFixed(3));
  }
}
function onResize() {
  fitLayout();
  onScroll();
}

function onScroll() {
  if (raf) return;
  if (!lastFrame) lastFrame = performance.now(); // the first eased frame starts from here
  raf = requestAnimationFrame(measure);
}

onMounted(() => {
  mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  let stored = false;
  try { stored = sessionStorage.getItem('hs-motion') === 'on'; } catch { /* storage blocked */ }
  forced.value = new URLSearchParams(location.search).get('motion') === 'on' || stored;
  reduced.value = mq.matches && !forced.value;
  mq.addEventListener('change', onMq);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  nextTick(fitLayout);
  document.fonts?.ready.then(fitLayout); // the captions' height depends on the font
  requestAnimationFrame(measure);
});
onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMq);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);
  cancelAnimationFrame(raf);
  clearTimeout(toastTimer);
});

const captions = [
  { title: 'A click runs it. A check says if it is on.', text: 'A toggle has a script to turn something on, one to turn it off, and a check script. The icon, the menu and the editor follow the check in real time.', link: '/guide/concepts', more: 'How trays work' },
  { title: 'Or leave the mouse alone.', text: 'Ctrl+Alt+Space opens the launcher from anywhere. Type a few letters of any entry in any tray and press Enter. Recent entries come first.', link: '/guide/launcher', more: 'The launcher' },
  { title: 'Run it when the files arrive.', text: 'A schedule can watch a folder, only in office hours, only if a check passes. It can ask first, with up to four choices and a countdown.', link: '/guide/schedules', more: 'Schedules and alerts' },
  { title: 'Build it in the editor.', text: 'Write the script, press Test, see the exit code and the state before saving. It all lands in one JSON file you can share.', link: '/guide/editor', more: 'The editor' },
];

const src = (name: string) => withBase(`/screens/home/${name}.png`);
const srcDark = (name: string) => withBase(`/screens/home/${name}-dark.png`);

const quiet = [
  { title: 'Start at login, no admin', text: 'A plain shortcut in your Startup folder. No Task Scheduler, no registry, no administrator rights.', link: '/guide/startup-and-updates' },
  { title: 'Updates itself', text: 'Installs in your user profile and updates from GitHub releases, checked with SHA-256.', link: '/guide/startup-and-updates' },
  { title: 'Asks for values', text: 'A small form before the script runs: a branch, an environment, a file.', link: '/guide/inputs' },
  { title: 'Hide without deleting', text: 'Hide a tray or an entry and bring it back later. Disable entries to pause their checks.', link: '/guide/editor' },
  { title: 'Export and import', text: 'Share trays, schedules and variables as a zip with their icons. On import, decide about what is already there.', link: '/guide/sharing' },
  { title: 'Windows, Linux, macOS', text: 'PowerShell, cmd, bash, zsh, sh or your own shell. One configuration file for every PC.', link: '/guide/platforms' },
];
const fade = (a: number, extra = '') => ({ opacity: a, visibility: a > 0.01 ? ('visible' as const) : ('hidden' as const), transform: extra || undefined });
</script>

<template>
  <div class="hs" :class="{ 'hs-reduced': reduced }">
    <!-- ================= the desktop ================= -->
    <section ref="story" class="hs-story" :style="reduced ? undefined : { height: storyHeight }">
      <div ref="stage" class="hs-stage">
        <div class="hs-wall" aria-hidden="true" :style="reduced ? undefined : { transform: `translate3d(${(seg + t) * -1.2}%, ${(seg + t) * 0.6}%, 0) rotate(${(seg + t) * 1.5}deg)` }"></div>

        <div class="hs-copy">
          <div class="hs-hero" :style="{ opacity: 1 - heroOut, transform: `translateY(${heroOut * -40}px)`, visibility: heroOut > 0.99 ? 'hidden' : 'visible' }">
            <img class="hs-appicon" :src="withBase('/icons/icon-aurora.png')" alt="" width="72" height="72" />
            <h1>Your scripts, down by the clock.</h1>
            <p>TrayCommand puts your shell commands in the system tray. Click to run them. Toggles check whether the proxy, the VPN or the dev server is on, and show it.</p>
            <div class="hs-actions">
              <a class="hs-btn" :href="releases">Download</a>
              <a class="hs-btn alt" :href="withBase('/guide/getting-started')">Get started</a>
            </div>
            <small class="hs-fine">Free and open source. Windows, Linux and macOS.</small>
          </div>

          <template v-if="!reduced">
            <div v-for="(c, i) in captions" :key="i" class="hs-cap" :style="caption(i + 1)">
              <h2>{{ c.title }}</h2>
              <p>{{ c.text }}</p>
              <a :href="withBase(c.link)" :tabindex="s === i + 1 ? 0 : -1">{{ c.more }}</a>
            </div>
          </template>
        </div>

        <template v-if="!reduced">
          <!-- the area on the right where the windows of the story appear, one at a time -->
          <div class="hs-area" aria-hidden="true">
            <div class="hs-keys" :style="fade(keysAlpha)">
              <kbd :class="{ down: keyDown.ctrl }">Ctrl</kbd><span>+</span><kbd :class="{ down: keyDown.alt }">Alt</kbd><span>+</span><kbd class="wide" :class="{ down: keyDown.space }">Space</kbd>
            </div>
            <LauncherWin :query="query" :web-on="webOn" :enter="enterDown" :style="fade(launcherAlpha, `scale(${0.96 + 0.04 * launcherAlpha})`)" />

            <div class="hs-folder" :style="fade(folderAlpha)">
              <span v-for="(p, k) in files" :key="k" class="hs-file" :style="{ transform: `translate(${(k - 1) * 70 * (1 - p)}px, ${-170 * (1 - p)}px) scale(${1 - 0.5 * p})`, opacity: p >= 1 ? 0 : 1 }">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>
                <small>invoice-04{{ 12 + k }}.pdf</small>
              </span>
              <span class="hs-bigfolder">
                <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                <b v-if="filesIn">{{ filesIn }}</b>
              </span>
              <code>C:\Invoices\in</code>
            </div>
            <AlertWin :seconds="seconds" :pressed="alertPressed" :style="fade(alertAlpha, `translateY(${(1 - Math.min(1, alertAlpha * 1.5)) * 20}px)`)" />
          </div>

          <div class="hs-editor" :style="{ transform: `translateY(${(1 - rise) * 105}%) scale(${0.94 + 0.06 * rise})`, opacity: Math.min(1, rise * 4), visibility: rise > 0 ? 'visible' : 'hidden' }" aria-hidden="true">
            <img class="only-light" :src="src('aurora-editor')" alt="" />
            <img class="only-dark" :src="srcDark('aurora-editor')" alt="" />
          </div>

          <svg class="hs-pointer" :class="{ down: pointer.down }" :style="{ transform: `translate(${pointer.x}px, ${pointer.y}px)`, opacity: pointer.alpha }" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M5 3l14 8-6.2 1.6L10 19z" fill="#fff" stroke="#1b1934" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
        </template>

        <ToastWin class="hs-toast-pos" :on="proxyOn" :style="fade(toastAlpha, `translateX(${(1 - toastAlpha) * 24}px)`)" />

        <TaskbarBar :proxy-on="proxyOn" :web-on="webOn" :hover-p="s === 1 && t < 0.27" :press-p="pointer.down && t < 0.3" :menu-shown="menuAlpha > 0.5" @proxy="clickProxyIcon" @web="clickWeb">
          <template #menu>
            <TrayMenu :proxy-on="proxyOn" :hover="rowHover" :style="fade(menuAlpha, `translateY(${(1 - menuAlpha) * 8}px)`)" @toggle="clickProxyEntry" />
          </template>
          <template #left>
            <nav v-if="!reduced" class="hs-progress" aria-label="Story">
              <button v-for="(c, i) in chapters" :key="c" :class="{ now: s === i + 1 }" @click="jump(i + 1)">
                <span class="bar"><i :style="{ transform: `scaleX(${fill(i + 1)})` }"></i></span>
                <span class="lbl">{{ c }}</span>
              </button>
            </nav>
            <span v-else class="hs-hint">Try the icons down here</span>
            <button v-if="forced && !reduced" class="hs-stillbtn" @click="setMotion(false)"><span class="long">Show still pictures</span><span class="short">Still</span></button>
          </template>
        </TaskbarBar>
      </div>
    </section>

    <!-- ================= reduced motion: the same scenes, still ================= -->
    <section v-if="reduced" class="hs-stills">
      <p class="hs-motion">
        Your system asks for less motion, so the story is shown as still pictures.
        <button @click="setMotion(true)">Show it animated</button>
      </p>
      <div v-for="(c, i) in captions" :key="i" class="hs-still">
        <div class="hs-stilltext">
          <h2>{{ c.title }}</h2>
          <p>{{ c.text }}</p>
          <a :href="withBase(c.link)">{{ c.more }}</a>
        </div>
        <div class="hs-frame" aria-hidden="true">
          <div class="hs-wall"></div>
          <template v-if="i === 0">
            <div class="hs-frame-menu"><TrayMenu :proxy-on="true" /></div>
          </template>
          <LauncherWin v-else-if="i === 1" class="hs-frame-win" query="web" :web-on="true" />
          <AlertWin v-else-if="i === 2" class="hs-frame-win" :seconds="8" />
          <div v-else class="hs-frame-editor">
            <img class="only-light" :src="src('aurora-editor')" alt="" />
            <img class="only-dark" :src="srcDark('aurora-editor')" alt="" />
          </div>
          <div class="hs-minibar">
            <span class="hs-ti"><span class="hs-tile teal">P</span><span class="hs-dot" :class="{ on: i === 0 || i === 1 }"></span></span>
            <span class="hs-ti"><span class="hs-tile green">S</span><span class="hs-dot" :class="{ on: i === 1 }"></span></span>
            <span class="hs-ti"><span class="hs-tile blue">{}</span></span>
          </div>
        </div>
      </div>
    </section>

    <!-- ================= looks ================= -->
    <section ref="looksEl" class="hs-looks" :data-look="looks[look].id">
      <div class="hs-lsticky">
        <div class="hs-lbg" aria-hidden="true">
          <span v-for="(l, i) in looks" :key="l.id" :class="[`bg-${l.id}`, { in: look === i }]"></span>
        </div>
        <div class="hs-lstage">
          <div class="hs-ltext">
            <h2>Same app, four looks.</h2>
            <p>Each look restyles the editor, the launcher and the app icon, light or dark. Aurora is home. The others are in Settings, under Look.</p>
            <div class="hs-lpick" role="radiogroup" aria-label="Look">
              <button v-for="(l, i) in looks" :key="l.id" role="radio" :aria-checked="look === i" @click="pickLook(i)">
                <img :src="withBase(`/icons/icon-${l.id}.png`)" alt="" width="48" height="48" />
                <span>{{ l.name }}</span>
              </button>
            </div>
            <p class="hs-lnote">{{ looks[look].note }}</p>
          </div>
          <div class="hs-lshots">
            <template v-for="(l, i) in looks" :key="l.id">
              <img class="only-light" :class="{ in: look === i }" :src="src(`look-${l.id}`)" :alt="`TrayCommand in the ${l.name} look`" loading="lazy" />
              <img class="only-dark" :class="{ in: look === i }" :src="srcDark(`look-${l.id}`)" :alt="`TrayCommand in the ${l.name} look, dark`" loading="lazy" />
            </template>
          </div>
        </div>
      </div>
    </section>

    <!-- ================= the quiet parts ================= -->
    <section class="hs-quiet">
      <h2>The quiet parts</h2>
      <dl>
        <div v-for="q in quiet" :key="q.title">
          <dt><a :href="withBase(q.link)">{{ q.title }}</a></dt>
          <dd>{{ q.text }}</dd>
        </div>
      </dl>
    </section>

    <section class="hs-end">
      <h2>Put your first script by the clock.</h2>
      <div class="hs-actions">
        <a class="hs-btn" :href="releases">Download</a>
        <a class="hs-btn alt" :href="withBase('/guide/getting-started')">Get started</a>
      </div>
    </section>
  </div>
</template>
