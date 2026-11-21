// Renders assets/*.svg into the PNG/ICO files used by the app and the packager.
// Every look has its own icon (assets/icon-<look>.svg); Aurora, the default look, is also the icon of the executable.
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import fs from 'node:fs';

const render = (svg, size) => new Resvg(fs.readFileSync(svg), { fitTo: { mode: 'width', value: size } }).render().asPng();
const ico = (svg) => pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => render(svg, s)));
const STYLES = ['aurora', 'terminal', 'brutal', 'neon'];
const DEFAULT = 'aurora';

fs.mkdirSync('build', { recursive: true });
for (const style of STYLES) {
  const svg = `assets/icon-${style}.svg`;
  fs.writeFileSync(`assets/icon-${style}.png`, render(svg, 256));
  fs.writeFileSync(`assets/icon-${style}.ico`, await ico(svg));
  fs.writeFileSync(`src/ui/public/icon-${style}.png`, render(svg, 128));
}
const svg = `assets/icon-${DEFAULT}.svg`;
fs.copyFileSync(svg, 'assets/icon.svg');
fs.writeFileSync('assets/icon.png', render(svg, 256));
fs.writeFileSync('build/icon.png', render(svg, 1024));
fs.writeFileSync('src/ui/public/icon.png', render(svg, 128));
fs.writeFileSync('build/icon.ico', await ico(svg));
fs.writeFileSync('assets/trayTemplate.png', render('assets/tray-template.svg', 16));
fs.writeFileSync('assets/trayTemplate@2x.png', render('assets/tray-template.svg', 32));
console.log('icons ok');
