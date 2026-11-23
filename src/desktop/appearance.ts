import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { check } from '../core/storage.js';
import { CORNER_SET } from './upstream/host/config/constants.js';
import { topFieldValid } from './upstream/host/config/validate.js';

type Settings = Record<string, unknown>;
const assets = join(dirname(createRequire(import.meta.url).resolve('her-world/package.json')), 'src', 'desktop', 'assets');
const defaults: Settings = JSON.parse(readFileSync(join(assets, 'interaction.json'), 'utf8'));
const catalog: { actions: {id: string; label: string}[] } = JSON.parse(readFileSync(join(assets, 'catalog.json'), 'utf8'));
const mediaIds = new Map(catalog.actions.flatMap(({id, label}) => [[id, id], [label, id]]));

export function desktopAppearanceDefaults(): Settings {
  return structuredClone(defaults);
}

function record(value: unknown): value is Settings {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function action(value: unknown): string {
  const id = typeof value === 'string' && mediaIds.get(value);
  check(id, 'Unknown desktop animation: ' + String(value));
  return id;
}

function names(value: unknown): string[] {
  check(Array.isArray(value), 'Invalid desktop animation pool');
  return value.map(action);
}

function moveParameters(value: unknown): Settings {
  check(record(value), 'Invalid desktop movement');
  for (const [key, number] of Object.entries(value)) {
    check(['minDist', 'maxDist', 'margin', 'leadSec', 'tailSec'].includes(key) &&
      typeof number === 'number' && Number.isFinite(number) && number >= 0, 'Invalid desktop movement parameter');
  }
  return value;
}

function animationSettings(value: Settings): Settings {
  const moves = value.moves, categories = value.categories, events = value.events;
  check(record(moves) && Array.isArray(moves.actions) && Array.isArray(categories) && record(events), 'Invalid desktop animations');
  const result: Settings = { ...value };
  for (const key of ['idle', 'turn', 'drag', 'clicks']) result[key] = names(value[key]);
  result.moves = { default: moveParameters(moves.default), actions: moves.actions.map(move => {
    check(record(move), 'Invalid desktop movement animation');
    return {name: action(move.name), ...(move.params === undefined ? {} : {params: moveParameters(move.params)})};
  }) };
  result.categories = categories.map(category => {
    check(record(category) && typeof category.id === 'string' && category.id.length > 0 &&
      typeof category.weight === 'number' && Number.isFinite(category.weight) && category.weight >= 0 &&
      (category.noMirror === undefined || typeof category.noMirror === 'boolean'), 'Invalid desktop animation category');
    return {...category, actions: names(category.actions)};
  });
  result.events = Object.fromEntries(Object.entries(events).map(([key, slots]) => {
    check(Array.isArray(slots), 'Invalid desktop event animations');
    return [key, slots.map(slot => Array.isArray(slot) ? names(slot) : action(slot))];
  }));
  if (Array.isArray(result.sleep)) result.sleep = result.sleep.map(set => ({
    start: names(set.start), loop: names(set.loop), end: names(set.end),
  }));
  if (result.baifan !== undefined) result.baifan = names(result.baifan);
  return result;
}

// Every supplied section replaces the packaged section after validation.
// Object sections also accept just the values being overridden.
export function parseDesktopAppearance(...input: [] | [raw: unknown]): Settings {
  if (!input.length) return desktopAppearanceDefaults();
  const [raw] = input;
  check(record(raw), 'Invalid desktop appearance');
  const result: Settings = {};
  for (const [key, override] of Object.entries(raw)) {
    check(Object.hasOwn(defaults, key), 'Unknown desktop appearance setting: ' + key);
    const base = defaults[key];
    const value = record(base) && record(override) ? {...base, ...override} : override;
    if (key === 'position') {
      check(record(value) && typeof value.corner === 'string' && CORNER_SET.has(value.corner) &&
        typeof value.marginX === 'number' && Number.isFinite(value.marginX) &&
        typeof value.marginY === 'number' && Number.isFinite(value.marginY), 'Invalid desktop home position');
    } else {
      check(topFieldValid(key, value), 'Invalid desktop appearance setting: ' + key);
    }
    result[key] = key === 'animations' && record(value) ? animationSettings(value) : value;
  }
  return result;
}
