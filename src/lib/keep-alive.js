/**
 * خدمة الحفاظ على نشاط السيرفر (Keep-Alive Service)
 * مصممة للاستضافات المجانية مثل Render التي تدخل في وضع الخمول (Sleep) بعد 15 دقيقة من عدم النشاط.
 * تقوم بإرسال طلب فحص (Health Check Ping) دورياً كل 10 دقائق لإبقاء السيرفر نشطاً.
 */

function startKeepAlive(options = {}) {
  const url = options.url || process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
  const intervalMs = options.intervalMs || 10 * 60 * 1000; // 10 دقائق

  if (!url) {
    console.log('[KeepAlive] لم يتم تفعيل خدمة التنشيط التلقائي لعدم تعيين RENDER_EXTERNAL_URL أو SERVER_URL.');
    return null;
  }

  const base = url.replace(/\/+$/, '');
  const targetUrl = `${base}/health`;

  console.log(`[KeepAlive] تم تفعيل التنشيط الذاتي للسيرفر: ${targetUrl} (كل ${Math.round(intervalMs / 60000)} دقائق)`);

  const ping = async () => {
    try {
      const res = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Alex-Project-KeepAlive/1.0' },
      });
      console.log(`[KeepAlive] نتيجة الفحص الدوري (${targetUrl}): ${res.status} ${res.statusText} في ${new Date().toISOString()}`);
    } catch (err) {
      console.warn(`[KeepAlive] تعذر إرسال الفحص في ${new Date().toISOString()}: ${err.message}`);
    }
  };

  // تنفيذ أول فحص بعد دقيقة واحدة من بدء التشغيل
  const initialTimeout = setTimeout(ping, 60 * 1000);
  const intervalId = setInterval(ping, intervalMs);

  return {
    stop() {
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    },
  };
}

module.exports = { startKeepAlive };
