export const SMS_SEGMENT_LIMIT = 160
export const SMS_MAX_LENGTH = 306 // 2 GSM-7 segments (153 chars each with UDH headers)

/**
 * SMS segment estimation (GSM 03.38 vs UCS-2) — mirrors
 * backend/app/utils/segments.py; keep them in sync.
 *
 * GSM-7 applies only when every character is in the GSM 03.38 charset:
 * 160 septets single / 153 per concatenated segment, extension chars cost 2.
 * Anything else (emoji, smart quotes, most non-Latin scripts) forces UCS-2:
 * 70 UTF-16 code units single / 67 per segment.
 */
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
)
const GSM7_EXTENSION = new Set('\f^{}\\[~]|€')

export function estimateSmsSegments(text: string): number {
  if (!text) return 1

  let gsm = true
  let septets = 0
  for (const char of text) {
    if (GSM7_EXTENSION.has(char)) septets += 2
    else if (GSM7_BASIC.has(char)) septets += 1
    else { gsm = false; break }
  }

  if (gsm) {
    if (septets <= 160) return 1
    return Math.ceil(septets / 153)
  }

  // UCS-2: text.length already counts UTF-16 code units (emoji = 2)
  const units = text.length
  if (units <= 70) return 1
  return Math.ceil(units / 67)
}
