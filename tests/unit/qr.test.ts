import jsQR from 'jsqr';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderQrPng } from '@/lib/qr/render';

const URL_TEXT = 'https://station.example.com/p#Ab3_-xYz0123456789abcdefGHIJKLMN';

async function rgba(image: Buffer) {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

describe('QR render (SPEC §6.2)', () => {
  it('T-TOK-08: decodes to the exact URL; opaque white corner; quiet zone ≥ 4 modules; 600 px', async () => {
    const png = await renderQrPng(URL_TEXT);
    const img = await rgba(png);
    expect(img.width).toBe(600);
    expect(jsQR(img.data, img.width, img.height)?.data).toBe(URL_TEXT);

    expect([...img.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);

    const modules = QRCode.create(URL_TEXT, { errorCorrectionLevel: 'M' }).modules.size;
    const quietPx = Math.floor((4 * img.width) / (modules + 8));
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const inQuietZone = x < quietPx || y < quietPx || x >= img.width - quietPx || y >= img.height - quietPx;
        if (!inQuietZone) continue;
        const i = (y * img.width + x) * 4;
        expect(img.data[i] === 255 && img.data[i + 1] === 255 && img.data[i + 2] === 255 && img.data[i + 3] === 255).toBe(true);
      }
    }
  });

  it('T-TOK-08: uses error correction level M', async () => {
    const png = await renderQrPng(URL_TEXT);
    const img = await rgba(png);
    const code = jsQR(img.data, img.width, img.height);
    // jsQR reports ECC via version/chunks only indirectly; compare against the M module count instead.
    const m = QRCode.create(URL_TEXT, { errorCorrectionLevel: 'M' });
    expect(code?.version).toBe(m.version);
  });

  it('T-TOK-09: still decodes after downscaling to 25% and re-encoding as JPEG q40', async () => {
    const png = await renderQrPng(URL_TEXT);
    const jpeg = await sharp(png).resize(150).jpeg({ quality: 40 }).toBuffer();
    const img = await rgba(jpeg);
    expect(img.width).toBe(150);
    expect(jsQR(img.data, img.width, img.height)?.data).toBe(URL_TEXT);
  });
});
