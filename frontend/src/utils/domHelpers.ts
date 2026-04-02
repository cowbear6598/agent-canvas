const EDITING_ELEMENT_TAGS: Set<string> = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

export function isEditingElement(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  const tagName = activeElement.tagName.toUpperCase();
  if (EDITING_ELEMENT_TAGS.has(tagName)) {
    return true;
  }

  return activeElement.getAttribute("contenteditable") === "true";
}

export function hasTextSelection(): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  return selection.toString().length > 0;
}

export function getPlatformModifierKey(): "metaKey" | "ctrlKey" {
  const userAgent = navigator.userAgent.toUpperCase();
  const isMac = userAgent.includes("MAC");
  return isMac ? "metaKey" : "ctrlKey";
}

export function isModifierKeyPressed(event: KeyboardEvent): boolean {
  const modifierKey = getPlatformModifierKey();
  return event[modifierKey];
}
