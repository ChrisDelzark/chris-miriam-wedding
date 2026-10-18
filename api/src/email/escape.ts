const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

// Header injection guard: a CR/LF in a subject could add headers such as Bcc.
export function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim()
}
