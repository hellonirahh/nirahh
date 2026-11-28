(function () {
  'use strict';

  // Only photos that require conversion go through canvas. The ordinary path
  // preserves the source bytes, including the orientation tag for the server.
  var MiB = 1024 * 1024;
  var supported = ['image/jpeg', 'image/png', 'image/webp'];
  function fail(code) { throw Object.assign(new Error(code), { code: code }); }

  function detectedType(header, bytes, file) {
    if (header.startsWith('\xff\xd8\xff')) return 'image/jpeg';
    if (header.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
    if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
    if (header.slice(4, 8) !== 'ftyp') return '';
    // A still HEIF container can carry its HEVC brand as a compatible brand.
    var length = new DataView(bytes.buffer).getUint32(0);
    if (length < 16 || length > header.length) return '';
    var brands = [header.slice(8, 12)];
    for (var i = 16; i + 4 <= length; i += 4) brands.push(header.slice(i, i + 4));
    if (brands.some(function (b) { return ['msf1', 'hevc', 'hevx', 'hevm', 'hevs'].includes(b); })) fail('PHOTO_STILL_REQUIRED');
    if (brands.some(function (b) { return ['heic', 'heix', 'heim', 'heis'].includes(b); })) return 'image/heic';
    if (brands.includes('mif1') && !brands.includes('avif') && !brands.includes('avis') &&
        (/^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name))) return 'image/heif';
    return '';
  }

  async function checkStillPNG(file) {
    // Animated PNG declares acTL before its first IDAT. Skip large metadata
    // chunks by offset without reading their contents into memory.
    var offset = 8;
    for (var i = 0; i < 256 && offset + 8 <= file.size; i++) {
      var buffer = await file.slice(offset, offset + 8).arrayBuffer();
      var name = String.fromCharCode.apply(null, new Uint8Array(buffer, 4, 4));
      if (name === 'IDAT') return;
      if (name === 'acTL') fail('PHOTO_STILL_REQUIRED');
      offset += new DataView(buffer).getUint32(0) + 12;
    }
    fail('PHOTO_UNSUPPORTED');
  }

  async function prepare(file, limits, signal) {
    var byteLimit = limits.max_upload_bytes || 10 * MiB;
    var pixelLimit = limits.max_image_pixels || 40000000;
    if (file.size > 64 * MiB) fail('PHOTO_DEVICE_LIMIT');
    var bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    var header = String.fromCharCode.apply(null, bytes);
    var kind = detectedType(header, bytes, file);
    var direct = supported.includes(kind);
    if (!kind) fail('PHOTO_UNSUPPORTED');
    var named = file.type === kind ? file : new File([file], file.name, { type: kind });
    var image = new Image();
    var url = URL.createObjectURL(named);
    var canvas;
    try {
      // Let the browser read the image dimensions and apply its native
      // orientation. Rasterization is only required for the canvas path.
      var loaded = await new Promise(function (resolve) {
        image.onload = function () { resolve(true); };
        image.onerror = function () { resolve(false); };
        image.src = url;
      });
      if (!loaded) {
        if (!direct) fail('PHOTO_EXPORT_JPEG');
        if (named.size <= byteLimit) return named; // backend validates the original
        fail('PHOTO_DEVICE_LIMIT');
      }
      var width = image.naturalWidth, height = image.naturalHeight;
      var scale = Math.min(1, 8192 / Math.max(width, height), Math.sqrt(pixelLimit / (width * height)));
      if (direct && scale === 1 && named.size <= byteLimit) return named;
      if (width * height > 64000000) fail('PHOTO_DEVICE_LIMIT');
      if (kind === 'image/png') await checkStillPNG(file);
      if (kind === 'image/webp' && header.slice(12, 16) === 'VP8X' && (bytes[20] & 2)) fail('PHOTO_STILL_REQUIRED');
      var target = Math.min(byteLimit, 7 * MiB - 1);
      canvas = document.createElement('canvas');
      for (var pass = 0; pass < 5; pass++) {
        if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
        canvas.width = Math.max(1, Math.floor(width * scale));
        canvas.height = Math.max(1, Math.floor(height * scale));
        if (Math.min(canvas.width, canvas.height) < 256) fail('PHOTO_UNSUITABLE');
        var ctx = canvas.getContext('2d');
        if (!ctx) { scale *= 0.7; continue; }
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        var encoded = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.95); });
        if (encoded && encoded.type === 'image/jpeg' && encoded.size > 0 && encoded.size <= target) {
          return new File([encoded], 'try-on-photo.jpg', { type: 'image/jpeg' });
        }
        // Some mobile canvases have a smaller area limit than the backend.
        // Draw again from the original after either that limit or the byte cap.
        scale *= encoded && encoded.size > target ? Math.sqrt(target / encoded.size) * 0.96 : 0.7;
      }
      fail('PHOTO_DEVICE_LIMIT');
    } catch (err) {
      if (typeof err.code === 'string' || err.name === 'AbortError') throw err;
      fail('PHOTO_DEVICE_LIMIT');
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
    }
  }

  window.NirahhTryOnPhoto = { prepare: prepare };
})();
