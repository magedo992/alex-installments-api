#!/usr/bin/env node

/**
 * سكربت خارجي مستقل لتنشيط السيرفر (Keep-Alive Pinger)
 * الاستخدام:
 *   node scripts/ping-server.js https://your-app.onrender.com
 * أو تعيين متغير البيئة SERVER_URL أو RENDER_EXTERNAL_URL:
 *   npm run keep-alive
 */

require('dotenv').config();

const rawUrl = process.argv[2] || process.env.SERVER_URL || process.env.RENDER_EXTERNAL_URL;

if (!rawUrl) {
  console.error('❌ يرجى تحديد رابط السيرفر كمعامل أو عبر متغير البيئة SERVER_URL');
  console.error('مثال: node scripts/ping-server.js https://alex-installments-api.onrender.com');
  process.exit(1);
}

const base = rawUrl.replace(/\/+$/, '');
const targetUrl = base.endsWith('/health') ? base : `${base}/health`;
const INTERVAL_MS = 10 * 60 * 1000; // 10 دقائق

console.log(`🚀 بدء تشغيل خدمة التنشيط الخارجي...`);
console.log(`📍 الرابط المستهدف: ${targetUrl}`);
console.log(`⏱️ التكرار: كل ${INTERVAL_MS / 60000} دقائق`);

async function sendPing() {
  const time = new Date().toLocaleTimeString('ar-EG', { hour12: true });
  try {
    const startTime = Date.now();
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Alex-Project-External-Pinger/1.0' },
    });
    const duration = Date.now() - startTime;
    console.log(`[${time}] ✅ تم إرسال الطلب بنجاح: ${response.status} ${response.statusText} (${duration}ms)`);
  } catch (error) {
    console.error(`[${time}] ⚠️ خطأ في الاتصال: ${error.message}`);
  }
}

// تنفيذ فحص فوري
sendPing();

// جدولة التكرار كل 10 دقائق
setInterval(sendPing, INTERVAL_MS);
