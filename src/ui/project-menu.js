/**
 * Project menu (F5) — save, open and reset as one explicit menu.
 *
 * Same interaction contract as the copy menu: opening moves focus into the
 * `role="menu"`, arrows/Home/End move, Enter activates, Escape or an outside
 * click closes and returns focus, and the button reports `aria-expanded`.
 */

export function createProjectMenu(deps) {
  const { button, items } = deps;

  const menu = document.createElement("div");
  menu.className = "project-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "project document");

  const buttons = items.map((item) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "op";
    el.setAttribute("role", "menuitem");
    el.setAttribute("tabindex", "-1");
    el.textContent = item.label;
    el.title = item.title || item.label;
    el.addEventListener("click", () => {
      close(false);
      item.onSelect();
    });
    menu.appendChild(el);
    return el;
  });
  document.body.appendChild(menu);

  let open = false;

  function position() {
    menu.hidden = false;
    const rect = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function focusItem(index) {
    const n = buttons.length;
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
