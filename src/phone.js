export function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "8") digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length === 11 && digits[0] === "7" ? digits : "";
}

export function formatPhone(raw) {
  const normalized = normalizePhone(raw);
  if (!normalized) return String(raw || "").trim();
  const local = `8${normalized.slice(1)}`;
  return `${local[0]}-${local.slice(1, 4)}-${local.slice(4, 7)}-${local.slice(7, 9)}-${local.slice(9, 11)}`;
}

export function formatPhoneForExcel(raw) {
  return formatPhone(raw);
}
