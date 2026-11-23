import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';

export function renderEconomyPanel(request, workspaceId = 'world',
  {sourceFile = new URL('../../src/console/client.js', import.meta.url), storage = new Map()} = {}) {
  const source = readFileSync(sourceFile, 'utf8');
  const component = source.slice(source.indexOf('function EconomyPanel('), source.indexOf('function LifePage('));
  const hooks = [];
  let cursor, mount;
  const h = (type, props, ...children) => ({type, props, children});
  const EconomyPanel = runInNewContext(`(${component.trim()})`, {
    h, Card: 'card', React: {Fragment: 'fragment', useEffect(effect) {mount = effect;}},
    facts: () => null,
    field: (label, props) => h('field', {...props, label}),
    fields: (...children) => h('fields', null, ...children),
    details: (label, ...children) => h('details', {label}, ...children),
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], next => {hooks[index] = typeof next === 'function' ? next(hooks[index]) : next;}];
    },
    useRef(initial) {return hooks[cursor++] ??= {current:initial};},
    AbortController, crypto: {randomUUID},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
  });
  return {
    mount: () => mount(),
    render() {
      cursor = 0;
      return EconomyPanel({workspaceId, request});
    },
  };
}

export function panelNodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => panelNodes(child, predicate));
  if (!node?.children) return [];
  return [...(predicate(node) ? [node] : []), ...panelNodes(node.children, predicate)];
}
