import { config } from "../config/env.ts";

export type WhatsAppPermissionResult = {
  allowed: boolean;
  phoneE164: string;
  phoneDigits: string;
  reason?: string;
  permission: "full" | "view_only" | "blocked" | "none";
  role: "owner" | "admin" | "user" | "none";
  nickname: string;
};

function normalize(phone: string) {
  const digits = (phone || "").replace(/\D/g, "");
  // السودان: لو بدا بـ 0 شيلها وخلي 249
  let d = digits;
  if (d.startsWith("0") && d.length === 10) d = "249" + d.slice(1);
  return { e164: "+" + d, digits: d };
}

export function checkWhatsAppPermission(phone: string, _required: string = "authorized"): WhatsAppPermissionResult {
  const { e164, digits } = normalize(phone);

  const ownerPhoneRaw = (config as any).ownerPhone
    || (config as any).adminPhone
    || process.env.OWNER_PHONE
    || process.env.ADMIN_PHONE
    || process.env.WHATSAPP_OWNER_PHONE
    || "";
  const owner = normalize(String(ownerPhoneRaw));

  // المالك دايماً مسموح ليهو
  if (owner.digits && digits === owner.digits) {
    return { allowed: true, phoneE164: e164, phoneDigits: digits, permission: "full", role: "owner", nickname: "المالك" };
  }

  // أرقام مصرح ليها من الـ ENV (افصل بينهم بفاصلة)
  const authorizedList = (process.env.AUTHORIZED_PHONES || "")
    .split(",")
    .map((p) => normalize(p).digits)
    .filter(Boolean);

  if (authorizedList.includes(digits)) {
    return { allowed: true, phoneE164: e164, phoneDigits: digits, permission: "full", role: "admin", nickname: digits };
  }

  // لو ما لقى مالك مضبوط في الـ ENV، اسمح لأي رقم عشان البوت ما يقيف
  // وبعد ما يشتغل، بتضبط الأرقام من لوحة التحكم
  if (!owner.digits) {
    return { allowed: true, phoneE164: e164, phoneDigits: digits, permission: "full", role: "owner", nickname: digits };
  }

  return { allowed: false, phoneE164: e164, phoneDigits: digits, reason: "غير مصرح له", permission: "none", role: "none", nickname: digits };
}

export default checkWhatsAppPermission;
