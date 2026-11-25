import { randomUUID } from 'node:crypto';

export function createDownloadStore({ ttlSeconds, allowedHosts, maxEntries = 1000 }) {
  const entries = new Map();

  function validateRemoteUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('المزوّد أعاد رابط ملف غير صالح.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.has(url.hostname.toLowerCase())) {
      throw new Error('مضيف الملف غير موجود في قائمة ALLOWED_MEDIA_HOSTS.');
    }
    return url.toString();
  }

  function sweep(now = Date.now()) {
    for (const [id, item] of entries) {
      if (item.expiresAt <= now) entries.delete(id);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (!oldest) break;
      entries.delete(oldest);
    }
  }

  function issue({ url, filename, mimeType, sizeBytes }) {
    sweep();
    const safeUrl = validateRemoteUrl(url);
    const id = randomUUID();
    const expiresAt = Date.now() + ttlSeconds * 1000;
    entries.set(id, {
      url: safeUrl,
      filename: sanitizeFilename(filename),
      mimeType,
      sizeBytes: Number.isSafeInteger(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
      expiresAt,
    });
    return { id, expiresAt: new Date(expiresAt).toISOString() };
  }

  function get(id) {
    sweep();
    return entries.get(id) || null;
  }

  return { issue, get, validateRemoteUrl };
}

export function sanitizeFilename(value, fallback = 'instagram-media.mp4') {
  const input = typeof value === 'string' ? value : '';
  const leaf = input.split(/[\\/]/).pop() || fallback;
  const clean = leaf.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120);
  return clean || fallback;
}
