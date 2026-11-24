/**
 * Returns the first day of the month as 'YYYY-MM-01'
 * Supports string dates ('YYYY-MM-DD') and Date objects.
 */
function firstOfMonth(d = new Date(), timeZone = 'Africa/Cairo') {
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})/.exec(d);
    if (!m) throw new Error(`Invalid date format: ${d}`);
    return `${m[1]}-${m[2]}-01`;
  }
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) {
    throw new Error(`Invalid date value: ${d}`);
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(dateObj);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}-01`;
}

module.exports = {
  firstOfMonth,
};
