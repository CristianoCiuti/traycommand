// Renders assets/*.svg into the PNG/ICO files used by the app and the packager.
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import fs from 'node:fs';

const render = (svg, size) => new Resvg(fs.readFileSync(svg), { fitTo: { mode: 'width', value: size } }).render().asPng();

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('assets/icon.png', render('assets/icon.svg', 256));
fs.writeFileSync('build/icon.png', render('assets/icon.svg', 1024));
fs.writeFileSync('src/ui/public/icon.png', render('assets/icon.svg', 128));
fs.writeFileSync('build/icon.ico', await pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => render('assets/icon.svg', s))));
fs.writeFileSync('assets/trayTemplate.png', render('assets/tray-template.svg', 16));
fs.writeFileSync('assets/trayTemplate@2x.png', render('assets/tray-template.svg', 32));
console.log('icons ok');
