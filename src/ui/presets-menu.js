/**
 * Presets menu (D54) — one-click analytical & LFO modulation patches.
 *
 * Follows the exact interaction and accessibility contract of `project-menu.js`:
 * opening moves focus into `role="menu"`, arrows / Home / End navigate, Enter
 * loads the patch, Escape or an outside click closes and returns focus to the
 * opener, and the button reports `aria-expanded`.
 */

export function createPresetsMenu(deps) {
  const { button, presets, onSelect } = deps;

  const menu = document.createElement("div");
  menu.className = "presets-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "analytical presets");

  const buttons = presets.map((preset) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "op preset-item";
    el.setAttribute("role", "menuitem");
    el.setAttribute("tabindex", "-1");
    el.dataset.patchPreset = preset.id;
    el.title = preset.description;

    const title = document.createElement("span");
    title.className = "preset-name";
    title.textContent = preset.name;

    const sub = document.createElement("span");
    sub.className = "preset-sub";
    sub.textContent = preset.summary;

    el.append(title, sub);
    el.addEventListener("click", () => {
      close(false);
      onSelect(preset);
    });
    menu.appendChild(el);
    return el;
  });
  (document.querySelector(".controls") || document.body).appendChild(menu);

  let open = false;

  function position() {
    menu.hidden = false;
    menu.scrollTop = 0;
    const rect = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 4);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function focusItem(index) {
    const n = buttons.length;
    if (n === 0) return;
    buttons[((index % n) + n) % n].focus();
  }

  function openMenu() {
    if (open) return;
    open = true;
    position();
    button.setAttribute("aria-expanded", "true");
    button.classList.add("on");
    focusItem(0);
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", onResize);
  }

  function close(refocus = true) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.classList.remove("on");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", onResize);
    if (refocus) button.focus();
  }

  function onOutside(event) {
    if (event.target === button || menu.contains(event.target)) return;
    close(false);
  }

  function onResize() {
    close(false);
  }

  menu.addEventListener("keydown", (event) => {
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusItem(buttons.length - 1); }
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  });

  button.addEventListener("click", () => (open ? close(true) : openMenu()));

  return { open: openMenu, close, isOpen: () => open };
}
