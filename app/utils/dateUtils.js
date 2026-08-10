// Formats a Date/date-like value as YYYY-MM-DD, used wherever a contract_requests
// date column needs to feed the New Request form's initial values.
export function toDateOnly(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
