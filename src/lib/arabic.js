const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toAsciiDigits(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const i = ARABIC_DIGITS.indexOf(ch);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(ch));
  });
}

/**
 * Normalizes Arabic text for consistent search & storage.
 * Matches import-helpers.ts normalization rules.
 */
function normalizeArabic(s) {
  if (typeof s !== 'string') return '';
  return toAsciiDigits(s)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  toAsciiDigits,
  normalizeArabic,
};
