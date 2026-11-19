#!/usr/bin/env node
/*
 * Converts a TrayCommand 1.x configuration (tray-command.json) to the 2.x format.
 *
 *   node scripts/convert-v1.mjs <old tray-command.json> <new traycommand.json> [old exe path]
 *
 * Relative icon paths in 1.x were relative to the executable FILE (e.g. "..\\icon\\x.png");
 * in 2.x they are relative to the folder of the configuration file.
 */
import fs from 'node:fs';
import path from 'node:path';

const [input, output, exeArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: convert-v1.mjs <old.json> <new.json> [old exe path]');
  process.exit(2);
}
const old = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^﻿/, ''));
const exe = exeArg ?? path.join(path.dirname(path.resolve(input)), 'TrayCommand.exe');
const outDir = path.dirname(path.resolve(output));
const warnings = [];

const icon = (i) => {
  if (!i || i === false || !i.path) return undefined;
  const abs = i.relative ? path.resolve(exe, i.path) : i.path;
  const rel = path.relative(outDir, abs);
  return (rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel).split(path.sep).join('/');
};

const app = (s) => (typeof s === 'string' ? s.replaceAll('§APP§', '${configDir}') : s);

const notify = (m) => (m === undefined || m === false ? undefined : m);

function refs(list, ownKind, where) {
  if (!list?.length) return undefined;
  const out = [];
  for (const r of list) {
    const kind = { run: 'on', stop: 'off', right: 'right' }[r.type];
    if (!kind) {
      warnings.push(`${where}: reference to the state check of "${r.id}" dropped`);
      continue;
    }
    out.push(kind === ownKind ? r.id : `${r.id}:${kind}`);
  }
  return out.length ? out : undefined;
}

function action(cmd, kind, where) {
  if (!cmd || cmd === false || !cmd.command) return undefined;
  const a = {
    run: app(cmd.command),
    shell: cmd.shell,
    notify: notify(cmd.message),
    before: refs(cmd.before, kind, where),
    parallel: refs(cmd.simultaneous, kind, where),
    after: refs(cmd.after, kind, where),
  };
  for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
  return Object.keys(a).length === 1 ? a.run : a;
}

function state(item, where) {
  const c = item.checkCommand;
  if (!c || c === false || !c.command) return undefined;
  const s = { check: app(c.command) };
  if (c.shell) s.shell = c.shell;
  if (c.stateOnOutput) s.on = c.stateOnOutput;
  if (c.stateOffOutput) s.off = c.stateOffOutput;
  s.interval = Math.max(2, Math.round((c.checkIntervalMs ?? 5000) / 1000));
  const off = icon(item.iconOff);
  if (off) s.iconOff = off;
  const n = { on: notify(c.stateOnMessage), off: notify(c.stateOffMessage) };
  if (n.on !== undefined || n.off !== undefined) s.notify = Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined));
  if (c.before || c.after || c.simultaneous) warnings.push(`${where}: composed state checks are not supported in 2.x and were dropped`);
  return s;
}

function entry(item, where, isTray) {
  if (item.separator) return { separator: true };
  const e = {};
  if (item.id) e.id = item.id;
  e.label = item.label ?? '';
  const ic = icon(item.icon);
  if (ic) e.icon = ic;
  if (item.hidden) e.hidden = true;
  if (item.enabled === false) e.disabled = true;
  if (typeof item.enabled === 'string' && item.enabled.startsWith('check ')) e.enabledWhen = item.enabled.slice(6).trim();
  const st = state(item, where);
  const on = action(item.command, 'on', where);
  const off = action(item.turnOffCommand, 'off', where);
  if (on) e.action = on;
  if (st) {
    e.state = st;
    if (off) e.offAction = off;
  } else if (off) warnings.push(`${where}: turnOffCommand without checkCommand dropped`);
  const right = action(item.rightCommand, 'right', where);
  if (right) {
    if (isTray) e.rightAction = right;
    else warnings.push(`${where}: right click on menu items is not supported, dropped`);
  }
  if (item.subMenu?.length) e.menu = item.subMenu.map((c, i) => entry(c, `${where}.menu[${i}]`, false));
  if (item.iconSize) warnings.push(`${where}: iconSize ignored (menu icons are always 16px)`);
  return e;
}

const trays = [];
let appMenu = 'own';
for (const [key, tray] of Object.entries(old.trays ?? {})) {
  const t = { id: tray.id ?? key, ...entry(tray, `trays.${key}`, true) };
  if (key === 'default') {
    // 1.x always had this tray: keep it only if it still has something besides "Edit config file"
    t.menu = (t.menu ?? []).filter((m) => !/^edit config/i.test(m.label ?? ''));
    if (!t.menu.length && !t.action) continue;
    appMenu = t.id;
  }
  trays.push(t);
}

const misc = old.settings?.misc ?? {};
const config = {
  $schema: 'https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json',
  version: 2,
  settings: {
    ...(old.settings?.shell?.shell ? { shell: old.settings.shell.shell } : {}),
    theme: misc.darkTheme === true ? 'dark' : 'system',
    appMenu,
    notifyOnStartup: misc.disableNotificationStartup === true ? false : true,
    checkUpdates: true,
    autostart: misc.runOnStartUp === true,
    allowAdminCommands: false,
  },
  variables: {},
  trays,
};
fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);
console.log(`written ${output} (${trays.length} trays)`);
for (const w of warnings) console.log(`warning: ${w}`);
