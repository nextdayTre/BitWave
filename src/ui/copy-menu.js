/**
 * Explicit `copy to…` menu (F4 IA, DESIGN §8).
 *
 * Replaces the armed-mode button: opening the menu moves focus in, Escape or
 * an outside click closes it and returns focus, arrows move between the lane
 * items, and the copy itself is one `copyLane` transaction (the live region
 * reports the destination state). The copy belongs to the rack, not the lane.
 *
 * D43/D46: items are labelled and identified by their stable lane key, and the
 * list is built from the **live** lane set on every open (excluding the focused
 * lane itself), so adding or deleting lanes keeps the menu truthful. Copying
 * needs a distinct destination lane that already exists; duplicating creates a
 * new lane and lives in the frames view.
 */

import { S, liveLaneKeys } from "../state/instrument.ts";

export function createCopyMenu(deps) {
  const { store, button, onCopy } = deps;

  const menu = document.createElement("div");
  menu.className = "copy-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "copy the focused lane to");

  let items = [];
  let open = false;

  function rebuildItems() {
    menu.textContent = "";
    const destinations = liveLaneKeys().filter((key) => key !== S.laneKey);
    items = destinations.map((key) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "op";
      item.setAttribute("role", "menuitem");
      item.setAttribute("tabindex", "-1");
      item.dataset.lane = key;
      item.textContent = `lane ${key}`;
      item.title = `Copy lane ${S.laneKey} into lane ${key}`;
      item.addEventListener("click", () => activate(key));
      menu.appendChild(item);
      return item;
    });
    return destinations;
  }

  document.body.appendChild(menu);

  function position() {
    menu.hidden = false;
    const r = button.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function focusItem(index) {
    if (items.length === 0) return;
    const n = items.length;
    items[((index % n) + n) % n].focus();
  }

  function openMenu() {
    if (open) return;
    /* Nothing to copy into when the lane set holds a single lane. */
    if (rebuildItems().length === 0) return;
    open = true;
    store.patch(() => { S.copyArmed = true; });
    position();
    button.setAttribute("aria-expanded", "true");
    button.classList.add("on");
    focusItem(0);
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", onResize);
  }

  function closeMenu(refocus = true) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.classList.remove("on");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", onResize);
    if (S.copyArmed) store.patch(() => { S.copyArmed = false; });
    if (refocus) button.focus();
  }

  function activate(key) {
    const src = S.laneKey;
    closeMenu(false);
    if (key !== src) onCopy(src, key);
    button.focus();
  }

  function onOutside(event) {
    if (event.target === button || menu.contains(event.target)) return;
    closeMenu(false);
  }

  function onResize() {
    closeMenu(false);
  }

  menu.addEventListener("keydown", (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusItem(items.length - 1); }
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu(false);
    }
  });

  button.addEventListener("click", () => (open ? closeMenu(true) : openMenu()));

  return { open: openMenu, close: closeMenu, isOpen: () => open };
}
