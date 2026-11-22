import { defineConfig } from 'vitepress';

const releases = 'https://github.com/CristianoCiuti/traycommand/releases/latest';
const site = 'https://cristianociuti.github.io/traycommand/';

/** The first paragraph of a rendered page, as plain text, for its link preview. */
function firstParagraph(html: string): string {
  const m = /<p>([\s\S]*?)<\/p>/.exec(html);
  if (!m) return '';
  const text = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 200 ? `${text.slice(0, 197).replace(/\s+\S*$/, '')}…` : text;
}

export default defineConfig({
  title: 'TrayCommand',
  description: 'Run shell commands from system tray icons: toggles with live state, menus, a keyboard launcher, global shortcuts, forms and schedules.',
  base: '/traycommand/',
  cleanUrls: true,
  lastUpdated: false,
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/traycommand/icon.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/traycommand/icon.png' }],
    ['meta', { name: 'theme-color', content: '#5a3fe0' }],
  ],
  /*
   * Link previews (chat apps, social networks): every page gets its own title, a description (its
   * front matter's, or its first paragraph) and its address, with one shared picture.
   */
  transformHead({ pageData, title, description, content }) {
    const page = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    const url = `${site}${page}`;
    let text = pageData.frontmatter.description || (pageData.frontmatter.layout === 'home' ? '' : firstParagraph(content));
    text = text || description;
    const head: [string, Record<string, string>][] = [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'TrayCommand' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: text }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:image', content: `${site}og.jpg` }],
      ['meta', { property: 'og:image:type', content: 'image/jpeg' }],
      ['meta', { property: 'og:image:width', content: '1200' }],
      ['meta', { property: 'og:image:height', content: '630' }],
      ['meta', { property: 'og:image:alt', content: 'TrayCommand: the editor of the tray icons, over an aurora wallpaper' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: text }],
      ['meta', { name: 'twitter:image', content: `${site}og.jpg` }],
    ];
    return head;
  },
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
