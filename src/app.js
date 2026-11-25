import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { parseInstagramMediaUrl, parseInstagramProfileUrl, UrlValidationError } from './instagram-url.js';
import { ProviderError } from './provider.js';

const mediaBodySchema = z.object({ url: z.string().min(1).max(2048), confirmRights: z.literal(true) }).strict();
const profileBodySchema = z.object({ url: z.string().min(1).max(2048), confirmAccess: z.literal(true) }).strict();
const mediaMimeTypes = new Set(['video/mp4']);
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function publicError(error) {
  if (error instanceof UrlValidationError || error instanceof ProviderError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error?.message === 'Origin is not permitted by FRONTEND_ORIGINS') {
    return { status: 403, code: 'CORS_ORIGIN_DENIED', message: 'هذا النطاق غير مسموح له باستدعاء الخدمة.' };
  }
  if (error?.type === 'entity.too.large') {
    return { status: 413, code: 'REQUEST_TOO_LARGE', message: 'حجم الطلب يتجاوز الحد المسموح.' };
  }
  if (error?.type === 'entity.parse.failed') {
    return { status: 400, code: 'INVALID_JSON', message: 'تعذر قراءة JSON المرسل.' };
  }
  if (error?.name === 'ZodError') {
    return { status: 400, code: 'INVALID_REQUEST', message: 'تحقق من الحقول المطلوبة. يجب تأكيد حق الوصول أو حقوق التنزيل.' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'حدث خطأ داخلي. أعد المحاولة لاحقاً.' };
}

function safeContentDisposition(filename) {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'download.mp4';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function validateRemoteUrl(value, allowedHosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid media URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error('Media host is not allow-listed');
  }
  return url;
}

async function openAllowedMedia(initialUrl, allowedHosts, timeoutMs) {
  let currentUrl = validateRemoteUrl(initialUrl, allowedHosts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: { accept: 'video/mp4,image/jpeg,image/png,image/webp,application/octet-stream' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw new Error('Too many media redirects');
        currentUrl = validateRemoteUrl(new URL(location, currentUrl).toString(), allowedHosts);
        continue;
      }
      return { response, controller, timer };
    }
    throw new Error('Too many media redirects');
  } catch (error) {
    clearTimeout(timer);
    controller.abort();
    throw error;
  }
}

export function createApp({ config, provider, downloadStore }) {
  const app = express();
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    const started = Date.now();
    res.on('finish', () => {
      process.stdout.write(`${JSON.stringify({ level: 'info', requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started })}\n`);
    });
    next();
  });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({
    origin: config.allowAllOrigins ? '*' : (origin, callback) => {
      if (!origin || config.frontendOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Origin is not permitted by FRONTEND_ORIGINS'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
    maxAge: 600,
  }));
  app.use(express.json({ limit: '16kb', strict: true }));

  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'تم تجاوز الحد المؤقت للطلبات. أعد المحاولة لاحقاً.' } },
  });
  const operationLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'عدد عمليات الاستخراج مرتفع. انتظر دقيقة ثم أعد المحاولة.' } },
  });
  app.use(generalLimiter);

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', providerConfigured: provider.configured }));

  app.post('/api/v1/extract', operationLimiter, async (req, res, next) => {
    try {
      const body = mediaBodySchema.parse(req.body);
      const parsed = parseInstagramMediaUrl(body.url);
      const result = await provider.extractMedia({ url: parsed.canonicalUrl, mediaType: parsed.mediaType, requestId: req.requestId });
      return res.status(200).json({ ok: true, requestId: req.requestId, ...result });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/profile', operationLimiter, async (req, res, next) => {
    try {
      const body = profileBodySchema.parse(req.body);
      const parsed = parseInstagramProfileUrl(body.url);
      const result = await provider.getProfile({ url: parsed.canonicalUrl, username: parsed.username, requestId: req.requestId });
      return res.status(200).json({ ok: true, requestId: req.requestId, ...result });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/v1/download/:id', async (req, res, next) => {
    let opened;
    try {
      const item = downloadStore.get(req.params.id);
      if (!item) return res.status(404).json({ error: { code: 'DOWNLOAD_LINK_EXPIRED', message: 'انتهت صلاحية رابط التنزيل أو لم يعد موجوداً. أعد طلب الرابط.' } });
      opened = await openAllowedMedia(item.url, config.allowedMediaHosts, 30000);
      const { response } = opened;
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new Error('Media provider returned a non-200 response');
      }
      const actualMime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const allowedTypes = item.mimeType === 'video/mp4' ? mediaMimeTypes : imageMimeTypes;
      if (!allowedTypes.has(actualMime)) {
        await response.body.cancel();
        throw new Error('Downloaded media type did not match the expected type');
      }
      const maxBytes = item.mimeType === 'video/mp4' ? config.maxVideoBytes : config.maxImageBytes;
      const announcedSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(announcedSize) && announcedSize > maxBytes) {
        await response.body.cancel();
        return res.status(413).json({ error: { code: 'MEDIA_TOO_LARGE', message: 'حجم الملف يتجاوز الحد المسموح.' } });
      }
      res.status(200);
      res.setHeader('content-type', actualMime);
      res.setHeader('content-disposition', safeContentDisposition(item.filename));
      res.setHeader('cache-control', 'private, no-store, max-age=0');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('accept-ranges', 'none');
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          this.bytesSeen = (this.bytesSeen || 0) + chunk.length;
          if (this.bytesSeen > maxBytes) return callback(new Error('Media size limit exceeded'));
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), limiter, res);
      return undefined;
    } catch (error) {
      if (opened) {
        clearTimeout(opened.timer);
        opened.controller.abort();
      }
      if (res.headersSent) {
        res.destroy(error);
        return undefined;
      }
      if (error?.name === 'AbortError') {
        return res.status(504).json({ error: { code: 'MEDIA_TIMEOUT', message: 'انتهت مهلة جلب الملف. أعد المحاولة.' } });
      }
      if (error?.message === 'Media size limit exceeded') {
        return res.status(413).json({ error: { code: 'MEDIA_TOO_LARGE', message: 'حجم الملف يتجاوز الحد المسموح.' } });
      }
      return next(new ProviderError('تعذّر جلب الملف من مضيف التنزيل المعتمد.', 502, 'MEDIA_FETCH_FAILED'));
    } finally {
      if (opened) {
        clearTimeout(opened.timer);
        opened.controller.abort();
      }
    }
  });

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'المسار غير موجود.' } }));
  app.use((error, req, res, _next) => {
    const result = publicError(error);
    if (result.status >= 500) {
      process.stderr.write(`${JSON.stringify({ level: 'error', requestId: req.requestId, code: result.code })}\n`);
    }
    res.status(result.status).json({ error: { code: result.code, message: result.message }, requestId: req.requestId });
  });
  return app;
}
