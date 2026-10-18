export const DISPLAY_FONT = "Didot,'Bodoni 72','Bodoni MT',Georgia,serif"
export const BODY_FONT = "Georgia,serif"

// Direction A ("The envelope"): oxblood card with a gold double border.
// `inner` is a run of <tr> rows placed inside the card.
export function envelopeLayout(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Chris &amp; Miriam</title>
</head>
<body style="margin:0;padding:0;background:#140504;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#140504;">
<tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#3d0b0c;border:1px solid #8f6a2e;">
<tr><td style="padding:6px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #5e2a1c;">
${inner}
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

export function displayRow(
  content: string,
  style: { color: string; size: number; spacing?: number; top: number }
): string {
  const spacing = style.spacing ? `letter-spacing:${style.spacing}px;` : ""
  return `<tr><td align="center" style="padding:${style.top}px 22px 0;font-family:${DISPLAY_FONT};color:${style.color};font-size:${style.size}px;${spacing}line-height:1.2;">${content}</td></tr>`
}

export function bodyRow(
  content: string,
  style: { color: string; size: number; top: number; bottom?: number }
): string {
  return `<tr><td align="center" style="padding:${style.top}px 22px ${style.bottom ?? 0}px;font-family:${BODY_FONT};color:${style.color};font-size:${style.size}px;line-height:1.6;">${content}</td></tr>`
}

export function monogramRow(top: number, size: number): string {
  return displayRow("C | M", { color: "#d9a84c", size, spacing: 6, top })
}

export function pillRow(label: string): string {
  return `<tr><td align="center" style="padding:22px 22px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #d9a84c;border-radius:999px;">
<tr><td style="padding:9px 22px;font-family:${BODY_FONT};color:#f0ce83;font-size:14px;letter-spacing:1px;">${label}</td></tr>
</table>
</td></tr>`
}

export function buttonsRow(
  buttons: { label: string; href: string; primary: boolean }[]
): string {
  const cells = buttons
    .map(({ label, href, primary }) => {
      const tdStyle = primary
        ? "background:#d9a84c;border-radius:6px;"
        : "border:1px solid #d9a84c;border-radius:6px;"
      const color = primary ? "#2a0707" : "#f0ce83"
      return `<tr><td align="center" style="${tdStyle}"><a href="${href}" style="display:block;padding:11px 20px;font-family:${BODY_FONT};font-size:14px;color:${color};text-decoration:none;">${label}</a></td></tr>`
    })
    .join('<tr><td height="10"></td></tr>')
  return `<tr><td align="center" style="padding:24px 22px 34px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells}</table>
</td></tr>`
}
