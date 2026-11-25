# واجهة خلفية عامة لاستخراج Instagram

حزمة API عامة قابلة لإعادة الاستخدام من مواقع متعددة، ولا ترتبط بأي نطاق واجهة أمامية محدد. تدعم فقط روابط **Reels** و**الفيديو/IGTV**، وقراءة بيانات **ملف شخصي عام**. شغّلها على خادم Node.js ثم وجّه أي واجهة مستقبلية إلى عنوان الـ API.

## تنبيه مهم قبل التشغيل

هذه الخلفية لا تتضمن كاشطاً غير رسمي لـ Instagram ولا تتجاوز تسجيل الدخول أو إعدادات الخصوصية. لا يمكن إجراء استخراج فيديو فعلي من رابط عام بمجرد إنشاء API: يلزم تهيئة مزوّد استخراج **مرخّص ومصرّح لك باستخدامه**. الحزمة تدمج هذا المزوّد عبر عقد HTTP موثّق أدناه، وتحمي مفتاحه في الخادم. إذا لم تُضف بيانات المزوّد، يعيد `/api/v1/extract` الخطأ `PROVIDER_NOT_CONFIGURED` بدلاً من الادعاء بأن التنزيل يعمل.

ملفات Profile خاصة غير مدعومة. أرسل فقط محتوى تملك حقوقه أو لديك تفويض للوصول إليه وتنزيله. وجود رابط عام لا يعني وحده امتلاك حقوق إعادة استخدام المحتوى.

## المتطلبات والتشغيل

- Node.js 20.19 أو أحدث (يفضّل Node.js 22).
- عنوان HTTPS لخدمة مزوّد الاستخراج المرخّص.
- اسم المضيف أو المضيفات الدقيقة التي يستخدمها CDN الخاص بالمزوّد للملفات.

```bash
cp .env.example .env
# عدّل .env محلياً، وأضف بيانات المزوّد ومضيفات CDN المسموح بها
npm install
npm test
npm run check
npm start
```

الخادم يستمع على `0.0.0.0:3000` افتراضياً. نقطة الصحة `GET /health` لا تتطلب تسجيل دخول وتُظهر فقط حالة التشغيل وما إذا كان المزوّد مهيّأً. لا ترفع ملف `.env` إلى Git ولا تضع مفتاح المزوّد في متصفح المستخدم.

## إعداد مزوّد الاستخراج

أضف القيم على بيئة الخادم (أو انسخ `.env.example` إلى `.env` للتطوير):

- `EXTRACTOR_API_BASE_URL`: عنوان HTTPS الأساسي، بلا مسار نهائي أو بيانات اعتماد.
- `EXTRACTOR_API_KEY`: مفتاح سري؛ يرسل للخدمة كـ `Authorization: Bearer …` من الخادم فقط.
- `EXTRACTOR_EXTRACT_PATH` و`EXTRACTOR_PROFILE_PATH`: مسارا الطرفين، الافتراضيان `/v1/extract` و`/v1/profile`.
- `ALLOWED_MEDIA_HOSTS`: قائمة مضيفات CDN دقيقة ومفصولة بفواصل. لا تقبل Wildcards أو منافذ. أضف فقط النطاقات التي أكدها مزودك.
- `FRONTEND_ORIGINS`: افتراضياً `*` للسماح لأي Origin؛ ضع قائمة Origins مفصولة بفواصل إذا أردت تقييد الاستدعاءات.

### عقد طلب المزوّد

استخراج Reel أو فيديو أو IGTV:

```http
POST /v1/extract
Authorization: Bearer <server-side-key>
Content-Type: application/json
```

```json
{"url":"https://www.instagram.com/reel/SHORTCODE/","mediaType":"reel"}
```

استجابة ناجحة:

```json
{
  "status":"ready",
  "media":{
    "url":"https://cdn.provider.example/path/signed-file.mp4?signature=…",
    "filename":"reel.mp4",
    "mimeType":"video/mp4",
    "sizeBytes":18392012
  },
  "attribution":"اختياري"
}
```

يجب أن يكون رابط الملف HTTPS وعلى أحد مضيفات `ALLOWED_MEDIA_HOSTS`، وأن يكون الملف MP4. يمكن للمزوّد استخدام رابط قصير الصلاحية. الـ API ينشئ رابط تنزيل داخلياً مؤقتاً (افتراضياً 10 دقائق)، ثم يمرر الملف streaming دون حفظه على القرص. يُسمح بثلاثة تحويلات فقط، ويُفحص كل مضيف في مسار التحويل.

قراءة ملف عام:

```http
POST /v1/profile
Authorization: Bearer <server-side-key>
Content-Type: application/json
```

```json
{"url":"https://www.instagram.com/username/","username":"username"}
```

استجابة ناجحة:

```json
{
  "status":"ready",
  "profile":{
    "username":"username",
    "fullName":"اسم اختياري",
    "biography":"نبذة اختيارية",
    "isPrivate":false,
    "followersCount":123,
    "avatar":{
      "url":"https://cdn.provider.example/avatar.jpg?signature=…",
      "filename":"profile.jpg",
      "mimeType":"image/jpeg",
      "sizeBytes":123456
    },
    "recentMedia":[
      {"url":"https://www.instagram.com/reel/SHORTCODE/","mediaType":"reel","shortcode":"SHORTCODE"}
    ]
  }
}
```

`recentMedia` اختيارية، وتُقص إلى 12 عنصراً ولا تنفّذ تنزيلات جماعية. يجب أن يرفض المزوّد الملف الخاص بإرجاع `isPrivate: true` أو خطأ مناسب. قيم `mediaType` المقبولة في قائمة الملف هي `reel` و`video` و`igtv`.

## نقاط API التي تستدعيها الواجهة

### استخراج رابط فيديو

```http
POST /api/v1/extract
Content-Type: application/json
```

```json
{"url":"https://www.instagram.com/reel/SHORTCODE/","confirmRights":true}
```

استجابة نموذجية:

```json
{
  "ok":true,
  "requestId":"UUID",
  "mediaType":"reel",
  "filename":"reel.mp4",
  "mimeType":"video/mp4",
  "sizeBytes":18392012,
  "downloadUrl":"/api/v1/download/UUID",
  "expiresAt":"2026-11-25T11:30:00.000Z",
  "attribution":null
}
```

يمكن للواجهة استخدام `downloadUrl` كما هو أو إلحاقه بنطاق API إذا كانت الواجهة والخلفية على نطاقين مختلفين.

### استعلام ملف شخصي

```http
POST /api/v1/profile
Content-Type: application/json
```

```json
{"url":"https://www.instagram.com/username/","confirmAccess":true}
```

يرجع الاسم والنبذة العامة وعدد المتابعين إذا أتاحها المزوّد، ورابطاً داخلياً مؤقتاً للصورة الشخصية عند صلاحيتها، وقائمة قصيرة اختيارية من روابط منشورات الفيديو العامة.

### تنزيل

```http
GET /api/v1/download/{downloadId}
```

الروابط مؤقتة وتُخزّن في الذاكرة فقط؛ إعادة تشغيل الخادم أو انتهاء مدة الصلاحية يبطلها. لا تُخزّن روابط Instagram الأصلية في سجلات الخادم. الاستجابة `private, no-store`.

## توصيل أي موقع

في معالج زر التنزيل بالواجهة الأمامية، استدعِ عنوان الخلفية:

```js
const response = await fetch(`${API_BASE_URL}/api/v1/extract`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: instagramUrl, confirmRights: true })
});
const result = await response.json();
if (!response.ok) throw new Error(result.error?.message || 'تعذر تجهيز التنزيل');
window.location.assign(new URL(result.downloadUrl, API_BASE_URL));
```

لصفحات Profile استخدم `/api/v1/profile` مع `confirmAccess: true`. لا تضمّن `EXTRACTOR_API_KEY` في كود الواجهة. `API_BASE_URL` عنوان الخادم الذي تنشر عليه هذه الحزمة.

## الحماية وحدود التصميم

- السماح حصراً بـ `instagram.com` و`www.instagram.com` عبر HTTPS؛ لا يُسمح بروابط حسابات خاصة أو Stories أو صفحات غير مطلوبة.
- قبول المسارات `/reel/`, `/reels/`, `/p/`, و`/tv/` (IGTV) أو مسار ملف شخصي عام واحد.
- تحقق من موافقة المستخدم على حقوق التنزيل أو الوصول إلى الملف العام.
- CORS عام افتراضياً عبر `FRONTEND_ORIGINS=*` (دون cookies أو credentials)؛ يمكن إعادته إلى قائمة Origins محددة، مع Helmet وحدود لحجم JSON والطلبات.
- حد افتراضي 60 طلباً لكل 15 دقيقة لكل IP، و10 عمليات استخراج/ملفات شخصية في الدقيقة، مع استجابة 429 عند التجاوز.
- تحقق SSRF: عناوين CDN يجب أن تكون HTTPS على قائمة سماح دقيقة، دون credentials أو منافذ، مع تحقق في كل تحويلة.
- حد حجم الفيديو 250 MiB والصورة 12 MiB افتراضياً؛ البث لا يحمّل الملف كاملاً إلى ذاكرة الخادم.
- لا توجد قاعدة بيانات أو تخزين دائم للوسائط. السجلات لا تحتوي أجسام الطلبات أو روابط الفيديو أو مفاتيح المزود.

إذا كان التطبيق خلف Proxy موثوق، اضبط `TRUST_PROXY_HOPS` على عدد القفزات المعروف فقط (عادةً 1 عند Proxy واحد). لا تستخدم `true` أو قيمة واسعة غير متحققة.

## اختبار الربط من الطرفية

```bash
curl -i http://localhost:3000/health
curl -i -X POST http://localhost:3000/api/v1/extract \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.instagram.com/reel/SHORTCODE/","confirmRights":true}'
```

من دون مزوّد مرخّص يعيد الطلب الثاني `503 PROVIDER_NOT_CONFIGURED` عمداً. لا يكفي إنشاء الخلفية وحده لتفعيل الاستخراج الفعلي؛ يجب إعداد حساب المزوّد ومفتاحه ومضيفات CDN، ثم نشر API وتوصيله بالواجهة.


## ما تم التحقق منه

`npm run check` يفحص صياغة ملفات JavaScript، و`npm test` يشغّل اختبارات الروابط ومسارات API وCORS. الاختبارات لا تستدعي Instagram أو مزوّداً خارجياً ولا تنزّل محتوى.


## إعداد نطاقات CORS

السماح من أي Origin هو الإعداد الافتراضي (`FRONTEND_ORIGINS=*`). راجع [تفاصيل تحديث CORS](README.cors-update.md)؛ هذا يسمح لأي موقع باستدعاء API من متصفح زواره، مع إبقاء credentials معطلة. إذا كان المطلوب مواقع محددة فقط، ضع قائمة Origins مفصولة بفواصل.
