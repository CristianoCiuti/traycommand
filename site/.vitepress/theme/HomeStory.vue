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
 * The desktop opens with the editor on it; the first scroll minimizes it into the tray icon,
 * and it comes back in the last scene. A bubble over the tray says where to look.
 *
 * Size: everything but the wallpaper sits on a canvas scaled by k on large screens (see
 * home.css), so the desktop fills big monitors instead of leaving a small column.
 *
 * With reduced motion: nothing is pinned. The four scenes are plain sections, each with
 * a small desktop already in its final state; the first screen shows the editor open.
 *
 * Clicks on the tray: in the animated story they move the story to the step they stand for
 * (the P to the open menu, the menu entry to the toggle turned on and its notification, the
 * S to the launcher turning the web server on), so what is on screen is always a step of the
 * story and the tray windows never overlap; the P does nothing while the notification is up.
 * In the still pictures they act on the spot: the P opens its menu, the entry flips the toggle
 * and shows the notification until the menu opens again, the S flips. One tray window at a time.
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
const onMq = () => { reduced.value = !!mq?.matches && !forced.value; nextTick(relayout); requestAnimationFrame(measure); };
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
const k = ref(1); // canvas scale (large screens)
const lk = ref(1); // the same for the looks, when they fill one screen (not on phones)
const stacked = ref(false); // narrow screen: text on top, windows under it
const heroCrowded = ref(false); // small phone: the tray menu or the notification would cover the hero text
const minOrigin = ref('100% 100%'); // where the editor shrinks to: the Proxy tray icon
const coachLeft = ref('auto'); // where the bubble sits on the canvas: centred on the P
const coachShape = ref(''); // its outline, body and point in one path (see fitLayout)
let coachWidth = 0;
let coachHeight = 0;
const seg = ref(0);
const t = ref(0);

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ramp = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
const ease = (x: number) => x * x * (3 - 2 * x);
const win = (x: number, a: number, b: number, c: number, d: number) => Math.min(ramp(a, b, x), 1 - ramp(c, d, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/* ---------- clicks on the tray ---------- */
/* still pictures only: what the clicks changed on the spot */
const manual = reactive<{ proxy: boolean | null; web: boolean | null; menu: boolean | null; toast: boolean }>({ proxy: null, web: null, menu: null, toast: false });
const trayUsed = ref(false); // the bubble over the tray goes for good once the tray is used
const userDriven = ref(false); // a click moved the story: the visitor's own pointer, no simulated one
let drivenAt: number | null = null; // where that click sent the story (viewport heights)
/* move the story to scene i at progress `at` (the easing in measure() animates the way there) */
function goTo(i: number, at: number) {
  if (!story.value) return;
  const y = STARTS[i] + at * SEG[i];
  const top = story.value.getBoundingClientRect().top + window.scrollY;
  userDriven.value = true;
  drivenAt = y;
  window.scrollTo({ top: top + y * window.innerHeight, behavior: 'instant' as ScrollBehavior });
  onScroll();
}
/* the story's steps for the clicks (progress inside the scene, see the timeline below) */
const AT_MENU_CLOSED = 0.12;
const AT_MENU_OPEN = 0.32;
const AT_TOGGLED = 0.68; // proxy on, menu closed, notification up
const AT_WEB_ON = 0.72; // scene 2: the launcher has turned the web server on
function clickProxyIcon() {
  trayUsed.value = true;
  if (s.value < 0) {
    const open = !(menuAlpha.value > 0.5);
    manual.menu = open;
    if (open) manual.toast = false; // one tray window at a time
    return;
  }
  if (proxyLocked.value) return; // the visitor has just been through the P
  goTo(1, menuAlpha.value > 0.5 ? AT_MENU_CLOSED : AT_MENU_OPEN);
}
function clickProxyEntry() {
  if (s.value < 0) {
    manual.proxy = !proxyOn.value;
    manual.menu = false;
    manual.toast = true; // stays until the menu opens again
    return;
  }
  goTo(1, AT_TOGGLED);
}
function clickWeb() {
  trayUsed.value = true;
  if (s.value < 0) {
    manual.web = !webOn.value;
    return;
  }
  goTo(2, AT_WEB_ON);
}

/* ---------- derived state ---------- */
const s = computed(() => (reduced.value ? -1 : seg.value));

const heroOut = computed(() => (s.value < 0 ? 0 : s.value === 0 ? ease(ramp(0.05, 0.5, t.value)) : 1));
/* the hero steps aside while the tray menu or the notification is up, when they would cover it */
const heroStyle = computed(() => {
  const aside = heroCrowded.value && s.value <= 0 && (menuAlpha.value > 0.01 || toastAlpha.value > 0.01);
  const a = aside ? 0 : 1 - heroOut.value;
  return { opacity: a, translate: `0 ${heroShift.value}px`, transform: `translateY(${heroOut.value * -40}px)`, visibility: a < 0.01 ? ('hidden' as const) : ('visible' as const), transition: s.value <= 0 ? 'opacity 0.25s, visibility 0.25s' : undefined };
});
function caption(i: number) {
  let a = 0;
  let dir = 1;
  if (i === 1 && s.value === 0) a = ramp(0.62, 1, t.value); // comes in once the hero has left
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
const rowHover = computed(() => !userDriven.value && s.value === 1 && t.value > 0.4 && t.value < 0.56);
/* while the notification of scene 1 is up the P does nothing: no menu over the notification */
const proxyLocked = computed(() => s.value === 1 && toastAlpha.value > 0.01);

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
/*
 * The three files sit on an arc over the folder: the middle one on top, the two side ones a row
 * lower and spread out, so none touches another (see .hs-folder for the sizes). They drop in this
 * order: left, right, middle. A side file goes down first and only then slides to the middle, so
 * it passes under the others, never over them; it lands on the folder icon's centre.
 */
const FILE_DX = 130; // sideways offset of the side files
const FILE_ROW = 52; // how much lower the side files sit
const FILE_LAND = 132; // top of a file when it lands on the folder icon's centre
const FILE_SLOTS = [-1, 1, 0]; // drop order: left, right, middle
function fileStyle(k: number, p: number) {
  const side = FILE_SLOTS[k];
  const x0 = side * FILE_DX;
  const y0 = side === 0 ? 0 : FILE_ROW;
  const down = ease(Math.min(1, p * 1.7)); // down first...
  const across = ease(ramp(0.35, 1, p)); // ...then towards the middle
  const x = x0 * (1 - across);
  const y = y0 + (FILE_LAND - y0) * down;
  return { transform: `translate(${x}px, ${y}px) scale(${1 - 0.5 * p})`, opacity: p >= 1 ? 0 : 1 - ramp(0.8, 1, p) };
}
const alertAlpha = computed(() => (s.value === 3 ? win(t.value, 0.34, 0.42, 0.95, 1) : 0));
const seconds = computed(() => (s.value === 3 ? 12 * (1 - ramp(0.42, 0.9, t.value)) : 12));
const alertPressed = computed(() => s.value === 3 && t.value >= 0.9);

/* the editor: a whole window floating where placeEditor() found the most room. Open on the first
   screen (when there is room for it, phones included), minimized into the tray as the story
   starts, back in scene 4. */
const rise = computed(() => (s.value === 4 ? ease(ramp(0, 0.55, t.value)) : 0));
const editorStyle = computed(() => {
  const hidden = { visibility: 'hidden' as const, opacity: 0 };
  // last scene: coming up a little as it appears
  if (s.value === 4) return { ...edBox.value, '--ed-w': edWidth.value, transform: `translateY(${(1 - rise.value) * 48}px) scale(${0.96 + 0.04 * rise.value})`, opacity: Math.min(1, rise.value * 2), visibility: rise.value > 0 ? ('visible' as const) : ('hidden' as const) };
  if (s.value > 0 || !edHeroBox.value) return hidden; // no room for it on the first screen
  const at = { ...edHeroBox.value, '--ed-w': edHeroWidth.value, transformOrigin: minOrigin.value };
  // still pictures, the tray was used: the editor goes into the tray, out of the way of the menu
  // and the notification (in the story a click moves on to scene 1 instead)
  if (trayUsed.value && s.value < 0) return { ...at, transform: 'scale(0.05)', opacity: 0, visibility: 'hidden' as const, transition: 'transform 0.4s ease-in, opacity 0.3s 0.1s, visibility 0s 0.4s' };
  if (s.value < 0) return at; // still pictures: simply open
  const m = ease(ramp(0.04, 0.55, t.value));
  return { ...at, transform: `scale(${1 - 0.95 * m})`, opacity: 1 - ramp(0.35, 0.55, t.value), visibility: m >= 1 ? ('hidden' as const) : ('visible' as const) };
});

/* the bubble over the tray, on the first screen only */
/* never together with the menu or the notification: they use the same corner */
const coachAlpha = computed(() => {
  if (trayUsed.value || menuAlpha.value > 0.01 || toastAlpha.value > 0.01) return 0;
  return s.value < 0 ? 1 : s.value === 0 ? 1 - ramp(0, 0.18, t.value) : 0;
});

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
  if (!st || !icon || !row || s.value < 0 || userDriven.value) { pointer.alpha = 0; return; }
  const q = k.value; // the pointer lives on the canvas: screen pixels / k
  const start = { x: (st.width * 0.72) / q, y: (st.height * 0.42) / q };
  const P = { x: (icon.left - st.left + icon.width * 0.5) / q, y: (icon.top - st.top + icon.height * 0.5) / q };
  const R = { x: (row.left - st.left + row.width * 0.35) / q, y: (row.top - st.top + row.height * 0.5) / q };
  let at = start;
  pointer.down = false;
  if (s.value === 0) {
    pointer.alpha = ramp(0.55, 0.7, t.value); // after the editor has gone into the tray
    const m = ease(ramp(0.55, 1, t.value)); // reaches the icon as the scene starts
    at = { x: lerp(start.x, P.x, m), y: lerp(start.y, P.y, m) };
  } else if (s.value === 1) {
    pointer.alpha = 1 - ramp(0.64, 0.72, t.value);
    const m = ease(ramp(0.27, 0.44, t.value));
    at = { x: lerp(P.x, R.x, m), y: lerp(P.y, R.y, m) };
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
    const changed = i !== seg.value;
    if (changed) { manual.proxy = manual.web = manual.menu = null; manual.toast = false; }
    seg.value = i;
    t.value = (y - STARTS[i]) / SEG[i];
    if (changed && stacked.value) nextTick(fitLayout); // the room under the text depends on this scene's text
    // after a click the simulated pointer stays away only until the visitor scrolls again: then
    // the story plays on from there, pointer included (open menu -> it clicks the toggle)
    if (userDriven.value && drivenAt !== null && Math.abs(target - drivenAt) > 0.01) { userDriven.value = false; drivenAt = null; }
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
 * Layout that depends on real sizes, in canvas pixels (screen pixels / k).
 * k: large screens scale the canvas so the desktop fills them (1 up to 1440x880).
 * Narrow screens: the windows go under the captions; --hs-captop is where the longest one ends.
 * Each window of the story gets --fit, the scale that fills the room it has: never above 1 on
 * a narrow screen, up to 1.4 beside the captions.
 */
const STACKED = '(max-width: 639px), (max-width: 860px) and (min-height: 521px)'; // same as home.css
function computeK() {
  const st = stage.value;
  if (!st) return;
  const w = st.clientWidth;
  const h = st.clientHeight;
  k.value = w < 1000 ? 1 : clamp(Math.min(w / 1440, h / 880), 1, 1.75);
}
const offsetIn = (el: HTMLElement | null, root: HTMLElement) => {
  let x = 0;
  let y = 0;
  for (let e: HTMLElement | null = el; e && e !== root; e = e.offsetParent as HTMLElement | null) { x += e.offsetLeft; y += e.offsetTop; }
  return { x, y };
};
function fitLayout() {
  const st = stage.value;
  const canvas = st?.querySelector<HTMLElement>('.hs-canvas');
  if (!st || !canvas) return;
  const q = k.value;
  stacked.value = window.matchMedia(STACKED).matches;
  const icon = canvas.querySelector<HTMLElement>('.hs-ti-proxy');
  // the tray bubble (on the canvas, not in the taskbar) is centred over the P, its point in the
  // middle; near the edge of the screen it slides sideways to stay on it, the point stays on the P
  if (icon) {
    const p = icon.getBoundingClientRect();
    const cv = canvas.getBoundingClientRect();
    const pc = (p.left + p.width / 2 - cv.left) / q; // P centre, in canvas pixels
    const coachEl = canvas.querySelector<HTMLElement>('.hs-coach');
    const w = coachEl?.offsetWidth || coachWidth || 240;
    const h = coachEl?.offsetHeight || coachHeight || 60;
    coachWidth = w;
    coachHeight = h;
    const left = Math.round(clamp(pc - w / 2, 8, Math.max(8, canvas.clientWidth - w - 8)));
    coachLeft.value = `${left}px`;
    // one outline for body and point: a rounded rectangle (radius 12) with a 18x9 point on the P
    const r = 12;
    const ax = clamp(Math.round(pc - left), r + 9, w - r - 9);
    coachShape.value = `path('M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} `
      + `H ${ax + 9} L ${ax} ${h + 9} L ${ax - 9} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z')`;
  }
  const copy = st.querySelector<HTMLElement>('.hs-copy');
  const caps = [...st.querySelectorAll<HTMLElement>('.hs-cap')];
  const tray = [st.querySelector<HTMLElement>('.hs-menu'), st.querySelector<HTMLElement>('.hs-toast-pos')];
  if (stacked.value && copy && caps.length) {
    const stTop = st.getBoundingClientRect().top;
    // the windows live under the text of the scene on screen (the first scene's on the hero)
    const cap = caps[clamp(seg.value - 1, 0, caps.length - 1)];
    const capBottom = (copy.getBoundingClientRect().top - stTop) / q + cap.offsetHeight + 20;
    canvas.style.setProperty('--hs-captop', `${Math.round(capBottom)}px`);
    // the tray menu and the notification rise from the taskbar: shrink them to stay under the text
    const barTop = ((st.querySelector<HTMLElement>('.hs-taskbar')?.getBoundingClientRect().top ?? 0) - stTop) / q;
    for (const el of tray) {
      if (!el?.offsetHeight) continue;
      el.style.setProperty('--fit', Math.min(1, (barTop - 14 - capBottom) / el.offsetHeight).toFixed(3));
    }
    // on the first screen the hero text may leave too little room for them (small phones)
    const hero = [...st.querySelectorAll<HTMLElement>('.hs-hero > *')].filter((e) => e.offsetHeight);
    const heroBottom = (copy.getBoundingClientRect().top - stTop) / q + Math.max(0, ...hero.map((e) => e.offsetTop + e.offsetHeight));
    heroCrowded.value = barTop - 14 - heroBottom < Math.max(0, ...tray.map((el) => el?.offsetHeight ?? 0));
  } else {
    heroCrowded.value = false;
    canvas.style.removeProperty('--hs-captop');
    // side by side: the menu and the notification stop before the text column (both shrink
    // from their right edge, which stays where it is)
    const capRight = copy && caps.length ? Math.max(...caps.map((c) => c.getBoundingClientRect().right)) : 0;
    for (const el of tray) {
      if (!el?.offsetWidth) continue;
      el.style.setProperty('--fit', Math.min(1, ((el.getBoundingClientRect().right - capRight) / q - 16) / el.offsetWidth).toFixed(3));
    }
  }
  const area = st.querySelector<HTMLElement>('.hs-area');
  if (!area) return;
  const aw = area.clientWidth;
  const ah = area.clientHeight;
  const grow = stacked.value ? 1 : 1.4;
  for (const el of [...area.children] as HTMLElement[]) {
    if (!el.offsetHeight) continue;
    el.style.setProperty('--fit', Math.min(grow, ah / el.offsetHeight, aw / el.offsetWidth).toFixed(3));
  }
  placeEditor(st, canvas, copy, caps, area, q);
  // side by side, each scene's text sits on the middle of the window beside it (the windows are
  // centred in the area); one above the other, the text stays at the top
  const bar = canvas.querySelector<HTMLElement>('.hs-taskbar');
  caps.forEach((cap, i) => {
    const editorBelow = i === caps.length - 1 && parseInt(edBox.value.top ?? '0', 10) !== area.offsetTop;
    if (stacked.value || !copy || !bar || editorBelow) { cap.style.top = ''; return; }
    const mid = area.offsetTop + area.clientHeight / 2 - copy.offsetTop;
    const lowest = bar.offsetTop - 20 - copy.offsetTop - cap.offsetHeight;
    cap.style.top = `${Math.round(clamp(mid - cap.offsetHeight / 2, 0, Math.max(0, lowest)))}px`;
  });
}

/*
 * The editor: a whole window floating in the free room, as big as it can be, both on the first
 * screen and in the last scene. Two candidate rooms each time: beside the text (the right
 * column, like the other scenes) and under it (the full content width, like on a phone); the
 * one that gives the bigger picture wins (a phone: always under). On the first screen the room
 * ends above the tray bubble, and when it is too small (a small phone) there is no editor.
 */
type Room = { left: number; top: number; w: number; h: number };
const edBox = ref<Record<string, string>>({});
const edWidth = ref('100%');
const edHeroBox = ref<Record<string, string> | null>(null);
const edHeroWidth = ref('100%');
const heroShift = ref(0); // how far the hero text comes down to line up with the editor beside it
let edRatio = 1.5; // width / height of the editor picture, read once it has loaded
function placeEditor(st: HTMLElement, canvas: HTMLElement, copy: HTMLElement | null, caps: HTMLElement[], area: HTMLElement, q: number) {
  const bar = canvas.querySelector<HTMLElement>('.hs-taskbar');
  const cap = caps[caps.length - 1];
  if (!copy || !bar) return;
  const img = [...canvas.querySelectorAll<HTMLImageElement>('.hs-editor img')].find((i) => i.naturalWidth);
  if (img) edRatio = img.naturalWidth / img.naturalHeight;
  const gap = 20;
  const contentLeft = copy.offsetLeft;
  const contentRight = canvas.clientWidth - contentLeft;
  const copyTop = (copy.getBoundingClientRect().top - st.getBoundingClientRect().top) / q;
  const size = (b: Room) => Math.max(0, Math.min(b.w, b.h * edRatio));
  const best = (below: Room, side: Room) => (stacked.value || size(below) > size(side) ? below : side);
  const css = (b: Room) => ({ left: `${Math.round(b.left)}px`, top: `${Math.round(b.top)}px`, width: `${Math.round(b.w)}px`, height: `${Math.round(Math.max(0, b.h))}px` });

  // last scene: the room ends above the taskbar
  if (cap) {
    const capBottom = copyTop + cap.offsetHeight + gap;
    const b = best(
      { left: contentLeft, top: capBottom, w: contentRight - contentLeft, h: bar.offsetTop - gap - capBottom },
      { left: area.offsetLeft, top: area.offsetTop, w: area.clientWidth, h: area.clientHeight },
    );
    edBox.value = css(b);
    edWidth.value = `${Math.floor(size(b))}px`;
  }

  // first screen: the room ends above the tray bubble. With the editor under the text, the text
  // has no reason to keep to a column: it takes the full width (hero-wide), so that option is
  // measured with the wide text; beside the text, the text keeps its column.
  const roomBottom = bar.offsetTop - 18 - (coachHeight || 60) - gap;
  const heroBottomNow = () => {
    const hero = [...st.querySelectorAll<HTMLElement>('.hs-hero > *')].filter((e) => e.offsetHeight);
    return copyTop + Math.max(0, ...hero.map((e) => e.offsetTop + e.offsetHeight)) + gap;
  };
  canvas.classList.remove('hero-wide');
  const side: Room = { left: area.offsetLeft, top: area.offsetTop, w: area.clientWidth, h: roomBottom - area.offsetTop };
  canvas.classList.add('hero-wide');
  const wideBottom = heroBottomNow();
  const under: Room = { left: contentLeft, top: wideBottom, w: contentRight - contentLeft, h: roomBottom - wideBottom };
  const h = best(under, side);
  if (h !== under) canvas.classList.remove('hero-wide');
  const hw = size(h);
  heroShift.value = 0;
  if (hw < 200 || hw / edRatio < 120) {
    edHeroBox.value = null; // too little room: no editor on this first screen
    return;
  }
  // side by side: the editor sits in the middle of its room, so the text comes down to share its
  // middle (never below the room); one above the other, the text stays at the top
  if (h !== under) {
    const textTop = copyTop;
    const textH = heroBottomNow() - gap - textTop;
    const want = h.top + h.h / 2 - (textTop + textH / 2);
    heroShift.value = Math.round(clamp(want, 0, Math.max(0, roomBottom - (textTop + textH))));
  }
  edHeroBox.value = css(h);
  edHeroWidth.value = `${Math.floor(hw)}px`;
  // it minimizes into the Proxy icon: the transform origin is the icon's centre, from its room
  const icon = canvas.querySelector<HTMLElement>('.hs-ti-proxy');
  if (icon) {
    const i = offsetIn(icon, canvas);
    minOrigin.value = `${Math.round(i.x + icon.offsetWidth / 2 - h.left)}px ${Math.round(i.y + icon.offsetHeight / 2 - h.top)}px`;
  }
}
function relayout() {
  computeK();
  const lc = looksEl.value?.querySelector<HTMLElement>('.hs-lcanvas');
  lk.value = lc && getComputedStyle(lc).position === 'absolute' ? k.value : 1;
  nextTick(() => { fitLayout(); onScroll(); }); // k must be on the canvas before measuring
}
function onResize() {
  relayout();
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
  nextTick(relayout);
  document.fonts?.ready.then(relayout); // the captions' height depends on the font
  requestAnimationFrame(measure);
});
onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMq);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);
  cancelAnimationFrame(raf);
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

        <div class="hs-canvas" :style="{ '--k': k }">
        <div class="hs-copy">
          <div class="hs-hero" :style="heroStyle">
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

        <!-- the area on the right where the windows of the story appear, one at a time; it is
             there in the still pictures too, empty, because the editor is placed from it -->
        <div class="hs-area" aria-hidden="true">
          <template v-if="!reduced">
            <div class="hs-keys" :style="fade(keysAlpha)">
              <kbd :class="{ down: keyDown.ctrl }">Ctrl</kbd><span>+</span><kbd :class="{ down: keyDown.alt }">Alt</kbd><span>+</span><kbd class="wide" :class="{ down: keyDown.space }">Space</kbd>
            </div>
            <LauncherWin :query="query" :web-on="webOn" :enter="enterDown" :style="fade(launcherAlpha, `scale(${0.96 + 0.04 * launcherAlpha})`)" />

            <div class="hs-folder" :style="fade(folderAlpha)">
              <span v-for="(p, k) in files" :key="k" class="hs-file" :style="fileStyle(k, p)">
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
          </template>
        </div>

        <template v-if="!reduced">
          <svg class="hs-pointer" :class="{ down: pointer.down }" :style="{ transform: `translate(${pointer.x}px, ${pointer.y}px)`, opacity: pointer.alpha }" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M5 3l14 8-6.2 1.6L10 19z" fill="#fff" stroke="#1b1934" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
        </template>

        <div class="hs-editor floating" :style="editorStyle" aria-hidden="true">
          <img class="only-light" :src="src('aurora-editor')" alt="" @load="relayout" />
          <img class="only-dark" :src="srcDark('aurora-editor')" alt="" @load="relayout" />
        </div>

        <ToastWin class="hs-toast-pos" :on="proxyOn" :style="fade(toastAlpha, `translateX(${(1 - toastAlpha) * 24}px)`)" />

        <!-- on the canvas, not inside the taskbar: the taskbar's own glass would stop its blur -->
        <div v-if="coachAlpha > 0.01" class="hs-coach" :style="{ opacity: coachAlpha, left: coachLeft, '--shape': coachShape || undefined }" aria-hidden="true">Your trays live here<small>Click the P to open its menu.</small></div>

        <TaskbarBar :proxy-on="proxyOn" :web-on="webOn" :hover-p="!userDriven && s === 1 && t < 0.27" :press-p="pointer.down && t < 0.3" :proxy-locked="proxyLocked" :menu-shown="menuAlpha > 0.5" :pulse="coachAlpha > 0.5" @proxy="clickProxyIcon" @web="clickWeb">
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
            <!-- one switch, always here: play the story, or back to still pictures -->
            <button v-if="reduced" class="hs-stillbtn" title="Your system asks for less motion, so the story is shown as still pictures below" @click="setMotion(true)">
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></svg>
              <span class="long">Play the story</span><span class="short">Play</span>
            </button>
            <button v-else-if="forced" class="hs-stillbtn" @click="setMotion(false)">
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="5" y="5" width="5" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="5" height="14" rx="1" fill="currentColor" /></svg>
              <span class="long">Show still pictures</span><span class="short">Still</span>
            </button>
          </template>
        </TaskbarBar>
        </div>
      </div>
    </section>

    <!-- ================= reduced motion: the same scenes, still ================= -->
    <section v-if="reduced" class="hs-stills">
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
        <div class="hs-lcanvas" :style="{ '--k': lk }">
        <div class="hs-lstage">
          <div class="hs-ltext">
            <!-- two lines in every look: each look has its own heading face and width -->
            <h2><span>Same app,</span> <span>four looks.</span></h2>
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
