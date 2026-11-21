import zlib from 'node:zlib';

/*
 * Minimal zip reader and writer (stored and deflated files, no encryption, no zip64):
 * enough for exports, and for zips of an export made again with Explorer or Finder.
 */

export interface ZipFile {
  name: string;
  data: Buffer;
}

/** Larger files are refused (an export holds a JSON file and small icons). */
export const MAX_ZIP_ENTRY = 20 * 1024 * 1024;
export const MAX_ZIP_TOTAL = 60 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date and time of a Date (local time, as zip tools show it). */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function writeZip(files: ZipFile[], now = new Date()): Buffer {
  const { time, date } = dosTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const deflated = zlib.deflateRawSync(f.data);
    const store = deflated.length >= f.data.length;
    const body = store ? f.data : deflated;
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

export function isZip(data: Buffer): boolean {
  return data.length >= 4 && data.readUInt32LE(0) === 0x04034b50;
}

/** The files of a zip (folders left out). Throws with a readable message when it cannot be read. */
export function readZip(data: Buffer): ZipFile[] {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('The zip file is damaged');
  const count = data.readUInt16LE(end + 10);
  let p = data.readUInt32LE(end + 16);
  const files: ZipFile[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > data.length || data.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip file is damaged');
    const flags = data.readUInt16LE(p + 8);
    const method = data.readUInt16LE(p + 10);
    const crc = data.readUInt32LE(p + 16);
    const size = data.readUInt32LE(p + 20);
    const length = data.readUInt32LE(p + 24);
    const nameLength = data.readUInt16LE(p + 28);
    const extra = data.readUInt16LE(p + 30);
    const comment = data.readUInt16LE(p + 32);
    const local = data.readUInt32LE(p + 42);
    const name = data.toString(flags & 0x0800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLength).replace(/\\/g, '/');
    p += 46 + nameLength + extra + comment;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('Encrypted zip files are not supported');
    if (length > MAX_ZIP_ENTRY || (total += length) > MAX_ZIP_TOTAL) throw new Error('The zip file is too large');
    if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) throw new Error('The zip file is damaged');
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const body = data.subarray(start, start + size);
    if (body.length !== size) throw new Error('The zip file is damaged');
    let content: Buffer;
    if (method === 0) content = Buffer.from(body);
    else if (method === 8) {
      try {
        content = zlib.inflateRawSync(body, { maxOutputLength: MAX_ZIP_ENTRY });
      } catch {
        throw new Error('The zip file is damaged');
      }
    } else throw new Error(`Unsupported compression in the zip file (method ${method})`);
    if (content.length !== length || crc32(content) !== crc) throw new Error('The zip file is damaged');
    files.push({ name, data: content });
  }
  return files;
}
