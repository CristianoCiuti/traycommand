import { defineConfig } from 'vitepress';

const releases = 'https://github.com/CristianoCiuti/traycommand/releases/latest';

export default defineConfig({
  title: 'TrayCommand',
  description: 'Run shell commands from system tray icons: toggles with live state, menus, a keyboard launcher, global shortcuts, forms and schedules.',
  base: '/traycommand/',
  cleanUrls: true,
  lastUpdated: false,
  head: [['link', { rel: 'icon', type: 'image/png', href: '/traycommand/icon.png' }]],
  themeConfig: {
    logo: '/icon.png',
    outline: [2, 3],
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Configuration reference', link: '/reference/', activeMatch: '/reference/' },
      { text: 'Recipes', link: '/recipes/', activeMatch: '/recipes/' },
      { text: 'Download', link: releases },
    ],
    sidebar: {
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Concepts', link: '/guide/concepts' },
            { text: 'The editor', link: '/guide/editor' },
            { text: 'Launcher and shortcuts', link: '/guide/launcher' },
            { text: 'Asking for values', link: '/guide/inputs' },
            { text: 'Schedules', link: '/guide/schedules' },
            { text: 'Export and import', link: '/guide/sharing' },
            { text: 'Start at login and updates', link: '/guide/startup-and-updates' },
            { text: 'Administrator', link: '/guide/administrator' },
            { text: 'AI assistants', link: '/guide/ai-assistants' },
            { text: 'Windows, Linux, macOS', link: '/guide/platforms' },
            { text: 'Migrating from 1.x', link: '/guide/migration' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Configuration file', link: '/reference/' },
            { text: 'Command line and data folder', link: '/reference/cli' },
          ],
        },
        {
          text: 'More',
          items: [
            { text: 'Recipes', link: '/recipes/' },
            { text: 'Changelog', link: '/changelog' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/CristianoCiuti/traycommand' }],
    footer: { message: 'Released under the MIT License.' },
  },
});
