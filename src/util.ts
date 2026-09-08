export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}
