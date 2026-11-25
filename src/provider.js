import { parseInstagramMediaUrl } from './instagram-url.js';

export class ProviderError extends Error {
  constructor(message, status = 502, code = 'EXTRACTOR_ERROR') {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
  }
}

export function createProvider(config, downloadStore) {
  const configured = Boolean(config.extractorBaseUrl && config.extractorApiKey);

  async function call(path, payload, requestId) {
    if (!configured) {
      throw new ProviderError('خدمة الاستخراج غير مهيّأة. أضف بيانات مزوّد مرخّص إلى متغيرات البيئة على الخادم.', 503, 'PROVIDER_NOT_CONFIGURED');
    }
    if (config.allowedMediaHosts.size === 0) {
      throw new ProviderError('لم تُضف مضيفات CDN المعتمدة إلى ALLOWED_MEDIA_HOSTS.', 503, 'MEDIA_HOSTS_NOT_CONFIGURED');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.extractorTimeoutMs);
    try {
      const response = await fetch(`${config.extractorBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.extractorApiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'x-request-id': requestId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        throw new ProviderError(`خدمة الاستخراج ردّت برمز HTTP ${response.status}.`, 502, 'UPSTREAM_FAILURE');
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new ProviderError('استجابة خدمة الاستخراج ليست JSON.', 502, 'INVALID_UPSTREAM_RESPONSE');
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new ProviderError('تعذّر تحليل استجابة خدمة الاستخراج.', 502, 'INVALID_UPSTREAM_RESPONSE');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ProviderError('تنسيق استجابة خدمة الاستخراج غير صالح.', 502, 'INVALID_UPSTREAM_RESPONSE');
      }
      return data;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error?.name === 'AbortError') {
        throw new ProviderError('انتهت مهلة خدمة الاستخراج.', 504, 'UPSTREAM_TIMEOUT');
      }
      throw new ProviderError('تعذّر الاتصال بخدمة الاستخراج.', 502, 'UPSTREAM_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  async function extractMedia({ url, mediaType, requestId }) {
    const data = await call(config.extractorExtractPath, { url, mediaType }, requestId);
    if (data.status !== 'ready' || !data.media || typeof data.media !== 'object') {
      throw new ProviderError('لم يُرجع المزوّد ملفاً جاهزاً للتنزيل.', 422, 'MEDIA_UNAVAILABLE');
    }
    const mimeType = String(data.media.mimeType || '').split(';')[0].trim().toLowerCase();
    if (mimeType !== 'video/mp4') {
      throw new ProviderError('المزوّد لم يُرجع فيديو MP4 صالحاً.', 422, 'UNSUPPORTED_MEDIA_TYPE');
    }
    let link;
    try {
      link = downloadStore.issue({
        url: data.media.url,
        filename: data.media.filename || `${mediaType}-${Date.now()}.mp4`,
        mimeType,
        sizeBytes: data.media.sizeBytes,
      });
    } catch {
      throw new ProviderError('رابط الملف من المزوّد غير آمن أو مضيفه غير مسموح.', 502, 'MEDIA_HOST_NOT_ALLOWED');
    }
    return {
      mediaType,
      filename: data.media.filename || `${mediaType}.mp4`,
      mimeType,
      sizeBytes: Number.isSafeInteger(data.media.sizeBytes) ? data.media.sizeBytes : null,
      downloadUrl: `/api/v1/download/${link.id}`,
      expiresAt: link.expiresAt,
      attribution: typeof data.attribution === 'string' ? data.attribution.slice(0, 300) : null,
    };
  }

  async function getProfile({ url, username, requestId }) {
    const data = await call(config.extractorProfilePath, { url, username }, requestId);
    const profile = data.profile;
    if (data.status !== 'ready' || !profile || typeof profile !== 'object') {
      throw new ProviderError('تعذّر العثور على الملف الشخصي أو أن المزوّد لا يدعمه.', 404, 'PROFILE_UNAVAILABLE');
    }
    if (profile.isPrivate !== false) {
      throw new ProviderError('لا يمكن التحقق من أن الملف عام؛ الملفات الخاصة أو غير المؤكدة غير مدعومة.', 403, 'PRIVATE_PROFILE_NOT_ALLOWED');
    }
    const returnedUsername = typeof profile.username === 'string' ? profile.username : username;
    if (returnedUsername.toLowerCase() !== username.toLowerCase()) {
      throw new ProviderError('استجابة الملف الشخصي لا تطابق الرابط المطلوب.', 502, 'PROFILE_MISMATCH');
    }
    const safeProfile = {
      username: returnedUsername.slice(0, 30),
      fullName: typeof profile.fullName === 'string' ? profile.fullName.slice(0, 100) : null,
      biography: typeof profile.biography === 'string' ? profile.biography.slice(0, 500) : null,
      isPrivate: false,
      followersCount: Number.isSafeInteger(profile.followersCount) && profile.followersCount >= 0 ? profile.followersCount : null,
      avatarDownloadUrl: null,
    };
    const avatar = profile.avatar;
    if (avatar && typeof avatar.url === 'string') {
      const mimeType = String(avatar.mimeType || '').split(';')[0].trim().toLowerCase();
      if (['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        try {
          const link = downloadStore.issue({
            url: avatar.url,
            filename: avatar.filename || `profile-${safeProfile.username}.jpg`,
            mimeType,
            sizeBytes: avatar.sizeBytes,
          });
          safeProfile.avatarDownloadUrl = `/api/v1/download/${link.id}`;
        } catch {
          // Omit an optional avatar whose host is not allow-listed; do not expose an untrusted URL.
        }
      }
    }
    const recentMedia = Array.isArray(profile.recentMedia)
      ? profile.recentMedia.slice(0, 12).flatMap((item) => {
          if (!item || typeof item !== 'object' || typeof item.url !== 'string') return [];
          try {
            const parsed = parseInstagramMediaUrl(item.url);
            return [{
              url: parsed.canonicalUrl,
              mediaType: parsed.mediaType,
              shortcode: parsed.shortcode,
            }];
          } catch {
            return [];
          }
        })
      : [];
    return { profile: safeProfile, recentMedia };
  }

  return { configured, extractMedia, getProfile };
}
