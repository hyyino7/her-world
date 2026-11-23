import {equal, deepEqual, throws} from 'node:assert/strict';
import test from 'node:test';
import {desktopAppearanceDefaults, parseDesktopAppearance} from '../../src/desktop/appearance.js';
import {DEFAULT_COMPANION_SETTINGS, parseCompanionConfiguration, parseCompanionSettings} from '../../src/core/companion-settings.js';

test('desktop defaults and complete upstream pools refer to shipped media', () => {
  const defaults = desktopAppearanceDefaults();
  deepEqual(parseDesktopAppearance(defaults), defaults);
  const animations = defaults.animations as {clicks: string[]; moves: {actions: unknown[]}; events: {balance: string[]; whisper: string[]}; categories: unknown[]};
  equal(animations.clicks.length, 5);
  equal(animations.moves.actions.length, 3);
  equal(animations.categories.length, 5);
  equal(animations.events.balance.length, 6);
  equal(animations.events.whisper.length, 3);
});

test('appearance accepts localized asset names, partial overrides and rejects unknown or unusable assets', () => {
  const result = parseDesktopAppearance({animations:{clicks:['点击回应-元气挥手']},position:{corner:'top-left'},font:{size:40}});
  deepEqual((result.animations as {clicks:string[]}).clicks, ['wave']);
  equal((result.font as {size:number}).size, 40);
  equal((result.position as {corner:string}).corner, 'top-left');
  throws(() => parseDesktopAppearance({animations:{clicks:['fake']}}));
  throws(() => parseDesktopAppearance({position:{corner:'center'}}));
  throws(() => parseDesktopAppearance({font:{size:9000}}));
  throws(() => parseDesktopAppearance({physics:{restitution:-1}}));
  throws(() => parseDesktopAppearance({sleepEndTexts:[]}));
});

test('portable Desktop fields keep old omissions, bounds and localized appearance in Core', () => {
  equal(DEFAULT_COMPANION_SETTINGS.desktopClickSound,true);
  equal(DEFAULT_COMPANION_SETTINGS.desktopSize,232);
  const prior = {desktopSize:96,desktopFixed:true,desktopSleepTalkSeconds:86400,
    desktopAppearance:{animations:{clicks:['点击回应-元气挥手']}}};
  const saved = parseCompanionConfiguration(prior);
  equal(saved.desktopClickSound,null);
  equal(saved.desktopFixed,true);
  equal(saved.desktopSize,96);
  equal(saved.desktopSleepTalkSeconds,86400);
  deepEqual((saved.desktopAppearance?.animations as {clicks:string[]}).clicks,['wave']);
  equal(parseCompanionSettings(prior).desktopClickSound,false);
  equal(parseCompanionSettings({}).desktopSize,232);
  equal(parseCompanionConfiguration({desktopSize:512}).desktopSize,512);
  throws(()=>parseCompanionConfiguration({desktopSize:513}),/Invalid desktopSize/);
  throws(()=>parseCompanionConfiguration({desktopFixed:1}),/Invalid Desktop switch/);
  throws(()=>parseCompanionConfiguration({desktopAppearance:{animations:{clicks:['unknown']}}}),/Unknown desktop animation/);
});
