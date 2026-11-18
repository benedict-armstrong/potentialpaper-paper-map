/** A few DOM helpers: the plugin is plain TypeScript, no framework. */

type Props = Record<string, string | boolean | number>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') node.setAttribute('style', String(v));
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  node.append(...children);
  return node;
}

/** "Label: a · b · c", the current one marked and the others buttons, as acceptodds' map draws its switches. */
export function toggle<T extends string>(
  label: string,
  options: [T, string][],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const row = el('div', { className: 'toggle' }, `${label}: `);
  options.forEach(([v, text], k) => {
    if (k > 0) row.append(' · ');
    if (v === value) row.append(el('span', { className: 'on' }, text));
    else {
      const b = el('button', { type: 'button', className: 'link' }, text);
      b.addEventListener('click', () => onChange(v));
      row.append(b);
    }
  });
  return row;
}

/** A message in place of the map. */
export function note(root: HTMLElement, text: string) {
  root.classList.remove('map');
  root.removeAttribute('style');
  root.replaceChildren(el('p', { className: 'note' }, text));
}
