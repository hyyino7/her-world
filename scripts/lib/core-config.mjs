import assert from 'node:assert/strict';
import {existsSync, lstatSync, readFileSync, realpathSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve, sep} from 'node:path';
import {isDeepStrictEqual, parseArgs} from 'node:util';

// Mirror the actual CoreConfig surface. Model routes belong to native DSH,
// and binding selection belongs to the saved workspace preferences.
const fields=Object.freeze(['dataDir','companionId','scopeId','ownerActorId','displayName','character','conversation','memory']);

/** Combine trusted setup layers without reviving retired Core driver fields. */
export function prepareCoreConfiguration(...layers) {
  const result={};
  for(const layer of layers) {
    if(layer===undefined)continue;
    assert.ok(layer&&typeof layer==='object'&&!Array.isArray(layer),'Core configuration must be an object');
    for(const key of fields)if(Object.hasOwn(layer,key)&&layer[key]!==undefined)result[key]=structuredClone(layer[key]);
  }
  if(result.conversation&&typeof result.conversation==='object'&&!Array.isArray(result.conversation))
    delete result.conversation.maxHistoryMessages;
  return result;
}

const corePackage = 'her-world';
const bundledMemoryEntry = join('src', 'memory', 'main.py');
const bundledMemoryFiles = [bundledMemoryEntry, 'src/memory/provider.py'];
const defaultMemoryEntry = entry => entry == null || entry === '';

function regularFile(path) {
  const stat = lstatSync(path, {throwIfNoEntry: false});
  return stat?.isFile() && stat.nlink === 1;
}

function isManagedMemoryServiceEntry(entry, roots) {
  const path = resolve(entry);
  const root = resolve(dirname(path), '../..');
  if (path !== join(root, bundledMemoryEntry)) return false;
  try {
    if (roots.some(known => path === join(known, bundledMemoryEntry)
      || existsSync(known) && path === join(realpathSync(known), bundledMemoryEntry))) return true;
    // An older package or checkout needs both matching program files and its manifest.
    const manifest = join(root, 'package.json');
    return regularFile(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === corePackage
      && roots.some(known => bundledMemoryFiles.every(file => regularFile(join(root, file)) && regularFile(join(known, file))
        && readFileSync(join(root, file)).equals(readFileSync(join(known, file)))));
  } catch { return false; }
}

/** Setup can select a local entry explicitly. Migration can also retain a
 * regular custom program already recorded in the effective configuration. */
export function prepareMemoryServiceEntry(memory, {args, managedRoots = [], preserveCustom = false} = {}) {
  // The binding step reads its own option from the CLI arguments with the same
  // value semantics as the initial syntax check.
  const choice = args && parseArgs({args, options: {'memory-service-entry': {type: 'string'}}, strict: false}).values['memory-service-entry'];
  const invalidChoice = 'memory-service-entry-choice-invalid';
  requireSetup(choice === undefined || typeof choice === 'string' && choice, invalidChoice,
    'Provide --memory-service-entry bundled or an absolute custom entry');
  if (!memory) {
    requireSetup(choice === undefined || choice === 'bundled', invalidChoice, 'Configure Memory before selecting a custom service entry');
    return undefined;
  }
  const next = structuredClone(memory), entry = next.serviceEntry;
  if (choice !== undefined && choice !== 'bundled') {
    requireSetup(absolute(choice), invalidChoice, 'Memory service entry must be an absolute custom path or bundled');
    requireSetup(checkedSetup(invalidChoice, () => regularFile(choice)), invalidChoice,
      'Explicit Memory service entry must be an existing regular local file');
    next.serviceEntry = resolve(choice);
    return next;
  }
  if (choice === 'bundled' || defaultMemoryEntry(entry) || absolute(entry) && isManagedMemoryServiceEntry(entry, managedRoots)) {
    delete next.serviceEntry;
    return next;
  }
  const reason = 'memory-service-entry-unverified';
  requireSetup(preserveCustom && absolute(entry) && !resolve(entry).endsWith(sep + bundledMemoryEntry)
    && checkedSetup(reason, () => regularFile(entry)), reason,
    'Inherited Memory service entry is unverified; select --memory-service-entry bundled or an absolute custom entry explicitly');
  return next;
}

export const coreEntry = Object.freeze({id: '00-Core', name: `${corePackage}/00-Core`});
const identityFields = ['companionId', 'scopeId', 'ownerActorId'];
const mapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const absolute = value => typeof value === 'string' && isAbsolute(value) && !value.includes('\0');

export class SetupError extends Error {
  constructor(reason, {message = reason, cause} = {}) {
    super(message, {cause});
    this.reason = reason;
  }
}

export function requireSetup(condition, reason, message) {
  if (!condition) throw new SetupError(reason, {message});
}

export function checkedSetup(reason, action) {
  try { return action(); }
  catch (error) { if (error instanceof SetupError) throw error; throw new SetupError(reason); }
}

export function coreConfiguration(config) {
  if (config == null || mapping(config) && Object.keys(config).length === 0) return undefined;
  requireSetup(mapping(config) && absolute(config.dataDir) && identityFields.every(key =>
    typeof config[key] === 'string' && config[key].length > 0 && config[key].length <= 32_768)
    && typeof config.displayName === 'string' && config.displayName.length <= 256 && !/[\r\n]/.test(config.displayName)
    && typeof config.character === 'string' && config.character.length <= 32_768, 'core-config-invalid');
  if (config.memory != null) {
    const {memory} = config;
    requireSetup(mapping(memory) && absolute(memory.python) && absolute(memory.dataDir)
      && ['runtimeRoot', 'serviceEntry'].every(key => memory[key] == null || memory[key] === '' || absolute(memory[key])), 'memory-binding-invalid');
  }
  const prepared = prepareCoreConfiguration(config);
  if (prepared.memory == null) delete prepared.memory;
  return prepared;
}

export function sameCoreBinding(before, after, managedRoots) {
  if (!['dataDir', ...identityFields].every(key => isDeepStrictEqual(before[key], after[key]))) return false;
  if (isDeepStrictEqual(before.memory, after.memory)) return true;
  if (!managedRoots || !before.memory || !after.memory) return false;
  const {serviceEntry: beforeEntry, ...beforeMemory} = before.memory;
  const {serviceEntry: afterEntry, ...afterMemory} = after.memory;
  const usesBundledEntry = entry => defaultMemoryEntry(entry) || absolute(entry) && isManagedMemoryServiceEntry(entry, managedRoots);
  return isDeepStrictEqual(beforeMemory, afterMemory) && usesBundledEntry(beforeEntry) && usesBundledEntry(afterEntry);
}

function entries(rows) {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? entries(row.config) : [])]);
}

const isCore = row => row.id === coreEntry.id || row.name === coreEntry.name;

export function readPatchList(text, yaml, schema) {
  if (text === undefined) return [];
  return checkedSetup('patch-invalid', () => {
    const patches = yaml.load(text, {schema});
    requireSetup(Array.isArray(patches) && patches.every(row => mapping(row) &&
      (row.insert === undefined || Array.isArray(row.insert) && row.insert.every(mapping))), 'patch-invalid');
    return patches;
  });
}

export function coreDeclaration(patches) {
  const found = entries(patches.flatMap(row => row.insert ?? [])).filter(isCore);
  requireSetup(found.length <= 1, 'core-duplicate');
  return found[0];
}

export function profileCoreOverride(patches) {
  requireSetup(!coreDeclaration(patches), 'core-duplicate');
  const found = patches.filter(row => !row.insert && isCore(row));
  requireSetup(found.length <= 1, 'core-duplicate');
  requireSetup(found.every(row => row.id === coreEntry.id && (!row.name || row.name === coreEntry.name)), 'core-entry-conflict');
  return found[0];
}

export function resolveCoreEntry(bundlePatches, profilePatches, homePatches, applyEntryPatches) {
  const declared = coreDeclaration([...bundlePatches, ...profilePatches, ...homePatches]);
  requireSetup(declared?.id === coreEntry.id && declared.name === coreEntry.name && !declared.group, 'core-entry-missing');
  const compose = patches => {
    const rows = applyEntryPatches([], patches, (_message, id) => requireSetup(id !== coreEntry.id, 'core-entry-conflict'));
    const found = entries(rows).filter(isCore);
    requireSetup(found.length === 1 && found[0].id === coreEntry.id && found[0].name === coreEntry.name && !found[0].group, 'core-entry-conflict');
    return found[0];
  };
  const profile = compose([...bundlePatches, ...profilePatches]);
  if (homePatches.length) requireSetup(isDeepStrictEqual(profile, compose([...bundlePatches, ...profilePatches, ...homePatches])), 'home-core-conflict');
  return profile;
}

export function patchWithCoreOverride(text, patches, override, config, yaml, schema, yamlDocument) {
  if (override && isDeepStrictEqual(coreConfiguration(override.config), config)) return text;
  const replacement = {...override, ...coreEntry, config};
  const fragment = yaml.dump([replacement], {schema, noRefs: true, lineWidth: -1});
  if (text === undefined) return fragment;

  // Read the resulting document with the loader's dialect to verify untouched entries and tags.
  const customTags = [{tag: 'tag:yaml.org,2002:js', resolve: value => value}];
  const doc = yamlDocument.parseDocument(text, {customTags});
  requireSetup(!doc.errors.length, 'patch-invalid');
  const entry = yamlDocument.parseDocument(fragment, {customTags}).get(0, true);
  const index = patches.indexOf(override);
  const expected = [...patches];
  if (override) {
    const current = doc.get(index, true);
    requireSetup(yamlDocument.isMap(current), 'core-entry-conflict');
    current.set('name', coreEntry.name);
    current.set('config', entry.get('config', true));
    expected[index] = replacement;
  } else {
    if (!patches.length) doc.contents.flow = false;
    doc.add(entry);
    expected.push(replacement);
  }
  const next = doc.toString({lineWidth: 0});
  requireSetup(isDeepStrictEqual(readPatchList(next, yaml, schema), expected), 'patch-edit-conflict');
  return next;
}
