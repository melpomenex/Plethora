const EDITABLE_SELECTOR = "input,textarea,select,[contenteditable='true'],[contenteditable=''],[role='textbox'],[role='combobox']";
const FOCUS_OWNER_SELECTOR = "[role='dialog'],[aria-modal='true'],[data-command-palette],[data-vim-focus-owner],[data-browser-find]";

export function canActivateDocumentVim(event: KeyboardEvent, modalOpen = false): boolean {
  if (modalOpen || event.defaultPrevented || event.isComposing) return false;
  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (!target) return true;
  if (target.closest(EDITABLE_SELECTOR)) return false;
  const owner = target.closest(FOCUS_OWNER_SELECTOR);
  return !owner || Boolean(owner.closest("[data-document-reader]"));
}
