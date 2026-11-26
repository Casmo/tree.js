// Lets three's GLTFExporter run in Node for tests: it writes buffers through FileReader and images through a
// canvas (OffscreenCanvas), which plain Node lacks. The canvas here only does what the exporter asks of it for a
// DataTexture (putImageData, then a PNG blob); drawn images are not supported.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA pixels (rows top to bottom) as a PNG file. */
export function encodePng(width: number, height: number, rgba: ArrayLike<number>): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = rgba[y * stride + i]!;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

class NodeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

class NodeOffscreenCanvas {
  private pixels: Uint8ClampedArray | null = null;
  private flipped = false;
  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext() {
    return {
      translate: () => undefined,
      scale: (_x: number, y: number) => void (this.flipped = y < 0),
      putImageData: (image: NodeImageData) => {
        const { width, height, data } = image;
        const rows = new Uint8ClampedArray(data.length);
        for (let y = 0; y < height; y++) rows.set(data.subarray(y * width * 4, (y + 1) * width * 4), (this.flipped ? height - 1 - y : y) * width * 4);
        this.pixels = rows;
      },
    };
  }

  convertToBlob(): Promise<Blob> {
    const pixels = this.pixels ?? new Uint8ClampedArray(this.width * this.height * 4);
    return Promise.resolve(new Blob([new Uint8Array(encodePng(this.width, this.height, pixels))], { type: 'image/png' }));
  }
}

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((b) => ((this.result = b), this.onloadend?.()));
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    });
  }
}

/** Installs the FileReader, OffscreenCanvas and ImageData GLTFExporter needs (only those missing); returns an uninstall. */
export function installGltfExporterGlobals(): () => void {
  const globals = globalThis as Record<string, unknown>;
  const added = Object.entries({ FileReader: NodeFileReader, OffscreenCanvas: NodeOffscreenCanvas, ImageData: NodeImageData }).filter(([name]) => !(name in globals));
  for (const [name, value] of added) globals[name] = value;
  return () => {
    for (const [name] of added) delete globals[name];
  };
}
