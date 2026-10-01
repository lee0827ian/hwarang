// 화면 템플릿 해석기. index.html의 <template> 안에 있는 {{ 경로 }} / <sc-for> / <sc-if> / on* 를 값으로 바꿔 그린다.
// (휘슬 FC 사이트에서 쓰는 것과 같은 코드)
// ── 템플릿 렌더러 ──
const SVG_NS = 'http://www.w3.org/2000/svg';
const HOLE = /\{\{\s*([\w$.]+)\s*\}\}/g;
const WHOLE = /^\s*\{\{\s*([\w$.]+)\s*\}\}\s*$/;

function lookup(scope, path) {
  if (path === 'true') return true;
  if (path === 'false') return false;
  if (path === 'null') return null;
  let cur = scope;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function interpolate(str, scope) {
  return str.replace(HOLE, (_, path) => {
    const v = lookup(scope, path);
    return v == null ? '' : String(v);
  });
}

function pathOf(attr) {
  return (attr || '').replace(/[{}\s]/g, '');
}

function renderNodes(parent, nodes, scope) {
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.nodeValue.includes('{{') ? interpolate(node.nodeValue, scope) : node.nodeValue));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();

    if (tag === 'sc-for') {
      const list = lookup(scope, pathOf(node.getAttribute('list'))) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, index) => {
        const inner = Object.create(scope);
        inner[as] = item;
        inner.$index = index;
        renderNodes(parent, node.childNodes, inner);
      });
      continue;
    }
    if (tag === 'sc-if') {
      if (lookup(scope, pathOf(node.getAttribute('value')))) renderNodes(parent, node.childNodes, scope);
      continue;
    }

    const inSvg = tag === 'svg' || parent.namespaceURI === SVG_NS;
    const el = inSvg ? document.createElementNS(SVG_NS, node.tagName) : document.createElement(tag);
    let pendingValue;
    for (const { name, value } of Array.from(node.attributes)) {
      if (name.startsWith('hint-')) continue;
      const whole = WHOLE.exec(value);
      if (name.startsWith('on') && whole) {
        const fn = lookup(scope, whole[1]);
        if (typeof fn === 'function') el.addEventListener(name.slice(2), fn);
        continue;
      }
      if (name === 'value' && whole) { pendingValue = lookup(scope, whole[1]); continue; }
      el.setAttribute(name, value.includes('{{') ? interpolate(value, scope) : value);
    }
    renderNodes(el, node.childNodes, scope);
    if (pendingValue !== undefined) el.value = pendingValue;
    parent.appendChild(el);
  }
}
