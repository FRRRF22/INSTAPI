const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const RESERVED_USERNAMES = new Set([
  'about', 'accounts', 'api', 'developer', 'direct', 'explore', 'graphql', 'legal',
  'p', 'privacy', 'reel', 'reels', 'stories', 'static', 'terms', 'tv', 'web',
]);
const SHORTCODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

export class UrlValidationError extends Error {
  constructor(message, code = 'INVALID_INSTAGRAM_URL') {
    super(message);
    this.name = 'UrlValidationError';
    this.code = code;
    this.status = 400;
  }
}

function parseSafeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new UrlValidationError('أدخل رابط Instagram صالحاً لا يتجاوز 2048 حرفاً.');
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UrlValidationError('تعذر قراءة الرابط. استخدم رابطاً كاملاً يبدأ بـ https://.');
  }
  if (url.protocol !== 'https:' || !INSTAGRAM_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new UrlValidationError('الرابط المقبول يجب أن يكون HTTPS على instagram.com أو www.instagram.com فقط.');
  }
  return url;
}

export function parseInstagramMediaUrl(value) {
  const url = parseSafeUrl(value);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new UrlValidationError('يدعم هذا المسار روابط Reel أو فيديو أو IGTV منفرداً، لا صفحات الملفات الشخصية أو المجموعات.');
  }
  const [rawType, shortcode] = segments;
  const route = rawType.toLowerCase();
  const typeMap = new Map([
    ['reel', 'reel'],
    ['reels', 'reel'],
    ['p', 'video'],
    ['tv', 'igtv'],
  ]);
  const mediaType = typeMap.get(route);
  if (!mediaType || !SHORTCODE_RE.test(shortcode)) {
    throw new UrlValidationError('الرابط غير مدعوم. أرسل Reel أو فيديو أو IGTV عاماً.');
  }
  const canonicalUrl = `https://www.instagram.com/${route}/${shortcode}/`;
  return { kind: 'media', mediaType, shortcode, canonicalUrl };
}

export function parseInstagramProfileUrl(value) {
  const url = parseSafeUrl(value);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) {
    throw new UrlValidationError('أرسل رابط ملف شخصي واحداً فقط، وليس رابط منشور أو قصة.');
  }
  const username = segments[0];
  if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username.toLowerCase())) {
    throw new UrlValidationError('اسم الملف الشخصي غير صالح أو غير مدعوم.');
  }
  return { kind: 'profile', username, canonicalUrl: `https://www.instagram.com/${username}/` };
}
