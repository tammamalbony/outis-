import {browser} from 'wxt/browser';
import {DEFAULT_TIMING_SETTINGS,readTimingSettings,type TimingSettings} from './timing-settings';

export const timingSettingsStorageKey='agentsync.timing-settings.v1';

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
  await browser.storage.local.remove(timingSettingsStorageKey);
}
