// Små hjälpfunktioner för att bygga DOM utan innerHTML (användartext sätts alltid som textnoder).
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else if (['checked', 'disabled', 'selected', 'hidden', 'required', 'open'].includes(k)) el[k] = !!v;
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

let idSeq = 0;
/** Fält med synlig etikett kopplad till kontrollen. */
export function field(label, control, hint) {
  const id = control.id || `f${++idSeq}`;
  control.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, hint) : null),
    control);
}

export function checkbox(label, checked, extra = {}) {
  const id = extra.id ?? `c${++idSeq}`;
  const input = h('input', { type: 'checkbox', checked, ...extra, id });
  return { input, el: h('label', { class: 'check', for: id }, input, h('span', null, label)) };
}

export function option(value, label, selected) {
  return h('option', { value, selected }, label);
}

export function showError(container, err) {
  const msg = err && err.name === 'AppError' ? err.message : 'Något gick fel. Uppgifterna har inte sparats. Försök igen.';
  if (!(err && err.name === 'AppError')) console.error(err);
  container.replaceChildren(h('div', { class: 'card err', role: 'alert' }, msg));
  container.scrollIntoView?.({ block: 'nearest' });
}

export function clearNode(node) { node.replaceChildren(); }

let toastTimer;
export function toast(message) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.replaceChildren(h('div', null, message));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.replaceChildren(), 4000);
}

/** Modal dialog. build(dialog, close) fyller innehållet. Resolvar med värdet som skickas till close(). */
export function openDialog(build) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-modal': 'true' });
    let result;
    const close = (v) => { result = v; dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    build(dlg, close);
    document.body.append(dlg);
    dlg.showModal();
    (dlg.querySelector('[autofocus]') || dlg.querySelector('input, select, textarea, button'))?.focus();
  });
}

export function confirmDialog({ title, body, confirmLabel = 'OK', cancelLabel = 'Avbryt', danger = false }) {
  return openDialog((dlg, close) => {
    dlg.setAttribute('aria-labelledby', 'dlg-title');
    dlg.append(
      h('h2', { id: 'dlg-title' }, title),
      h('p', null, body),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' },
        h('button', { type: 'button', class: 'btn quiet', onclick: () => close(false), autofocus: true }, cancelLabel),
        h('button', { type: 'button', class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, confirmLabel)),
    );
  }).then((v) => v === true);
}

/** Skydd mot dubbelklick: kör bara en åtgärd åt gången. */
export function guarded(fn) {
  let busy = false;
  return async (...args) => {
    if (busy) return;
    busy = true;
    try { return await fn(...args); } finally { busy = false; }
  };
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
