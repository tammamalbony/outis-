import {browser} from 'wxt/browser';
import {DEFAULT_TIMING_SETTINGS,readTimingSettings,type TimingSettings} from './timing-settings';

export const timingSettingsStorageKey='agentsync.timing-settings.v1';
export const pageStatusRailStorageKey='agentsync.page-status-rail.v1';
export const chatTestConversationStorageKey='agentsync.chatgpt-test.saved-conversation.v1';

export async function loadPageStatusRailEnabled():Promise<boolean>{
  try{const stored=await browser.storage.local.get(pageStatusRailStorageKey);return stored[pageStatusRailStorageKey]===true;}catch{return false;}
}

export async function savePageStatusRailEnabled(enabled:boolean):Promise<void>{
  await browser.storage.local.set({[pageStatusRailStorageKey]:enabled});
}

export async function loadTimingSettings():Promise<TimingSettings>{
  try{
    const stored=await browser.storage.local.get(timingSettingsStorageKey);
    return readTimingSettings(stored[timingSettingsStorageKey]);
  }catch{return {...DEFAULT_TIMING_SETTINGS};}
}

export async function saveTimingSettings(settings:TimingSettings):Promise<void>{
  await browser.storage.local.set({[timingSettingsStorageKey]:settings});
}

export async function clearTimingSettings():Promise<void>{
  await browser.storage.local.remove([timingSettingsStorageKey,pageStatusRailStorageKey,chatTestConversationStorageKey]);
}
