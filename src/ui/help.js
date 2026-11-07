/**
 * Keyboard map panel (F4 IA) — a utility surface, not onboarding.
 *
 * `?` (or the header button) opens a static list of the instrument's real
 * shortcuts; Escape closes it and focus returns to where it came from. This is
 * the one place the key map is declared, so a new control has to extend it.
 */

export function createHelpPanel(deps) {
  const { panel, button, closeButton } = deps;
  let open = false;
  let returnFocus = null;

  function show() {
    if (open) return;
    open = true;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : button;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    closeButton.focus();
  }

  function hide(refocus = true) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) {
      const target = returnFocus && document.contains(returnFocus) ? returnFocus : button;
      target.focus();
    }
    returnFocus = null;
  }

  function toggle() {
    if (open) hide();
    else show();
  }

  button.addEventListener("click", toggle);
  closeButton.addEventListener("click", () => hide());

  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "?") return;
    const target = event.target;
    if (target && (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.closest?.("#nibs"))) {
      return;
    }
    event.preventDefault();
    toggle();
  });

  return { show, hide, toggle, isOpen: () => open };
}
