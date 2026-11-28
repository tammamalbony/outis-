import {browser} from 'wxt/browser';
import type {ChatSnapshot} from './agent-bridge';

export type RepositoryWizardChatKind='check'|'initialize';
export type RepositoryWizardProgress={
  repository:string;
  phase:'idle'|'checking'|'initializing'|'initialized'|'needs_initialization'|'needs_confirmation';
  checkChatUrl?:string;
  initializeChatUrl?:string;
  lastReply?:string;
  checkedAt?:string;
  selectedBatchId?:string;
  selectedTeamId?:string;
  stageChecks?:Partial<Record<2|3|4,string>>;
  lastHandledMessageId?:string;
};
export type RepositoryWizardWatch={repository:string;kind:RepositoryWizardChatKind};

const progressKey='agentsync.repository-wizard.v1';
const watchesKey='agentsync.repository-wizard-watches.v1';
const snapshotsKey='agentsync.repository-wizard-snapshots.v1';

export function emptyRepositoryWizardProgress(repository:string):RepositoryWizardProgress{return {repository,phase:'idle',stageChecks:{}};}
export async function loadRepositoryWizardProgress(repository:string):Promise<RepositoryWizardProgress>{
  try{const stored=await browser.storage.local.get(progressKey);const all=stored[progressKey] as Record<string,RepositoryWizardProgress>|undefined;const current=all?.[repository];return current?.repository===repository?current:emptyRepositoryWizardProgress(repository);}catch{return emptyRepositoryWizardProgress(repository);}
}
export async function saveRepositoryWizardProgress(progress:RepositoryWizardProgress):Promise<void>{
  const stored=await browser.storage.local.get(progressKey);const all=(stored[progressKey] as Record<string,RepositoryWizardProgress>|undefined)??{};await browser.storage.local.set({[progressKey]:{...all,[progress.repository]:progress}});
}
export async function resetRepositoryWizardProgress(repository:string):Promise<void>{
  const stored=await browser.storage.local.get([progressKey,watchesKey,snapshotsKey]);
  const all=(stored[progressKey] as Record<string,RepositoryWizardProgress>|undefined)??{};
  const watches=(stored[watchesKey] as Record<string,RepositoryWizardWatch>|undefined)??{};
  const snapshots=(stored[snapshotsKey] as Record<string,ChatSnapshot>|undefined)??{};
  for(const [url,watch] of Object.entries(watches))if(watch.repository===repository){delete watches[url];delete snapshots[url];}
  await browser.storage.local.set({[progressKey]:{...all,[repository]:emptyRepositoryWizardProgress(repository)},[watchesKey]:watches,[snapshotsKey]:snapshots});
}
export async function clearAllRepositoryWizardData():Promise<void>{await browser.storage.local.remove([progressKey,watchesKey,snapshotsKey]);}
export async function registerRepositoryWizardChat(repository:string,kind:RepositoryWizardChatKind,url:string):Promise<void>{
  const stored=await browser.storage.local.get(watchesKey);const watches=(stored[watchesKey] as Record<string,RepositoryWizardWatch>|undefined)??{};watches[url]={repository,kind};await browser.storage.local.set({[watchesKey]:watches});
}
export async function removeRepositoryWizardChat(repository:string,url?:string):Promise<void>{
  const stored=await browser.storage.local.get([watchesKey,snapshotsKey]);const watches=(stored[watchesKey] as Record<string,RepositoryWizardWatch>|undefined)??{};const snapshots=(stored[snapshotsKey] as Record<string,ChatSnapshot>|undefined)??{};
  for(const [chatUrl,watch] of Object.entries(watches))if(watch.repository===repository&&(!url||chatUrl===url)){delete watches[chatUrl];delete snapshots[chatUrl];}
  await browser.storage.local.set({[watchesKey]:watches,[snapshotsKey]:snapshots});
}
export async function repositoryWizardWatchForChat(url:string):Promise<RepositoryWizardWatch|undefined>{const stored=await browser.storage.local.get(watchesKey);const watches=stored[watchesKey] as Record<string,RepositoryWizardWatch>|undefined;return watches?.[url];}
export async function saveRepositoryWizardChatSnapshot(url:string,snapshot:ChatSnapshot):Promise<void>{const stored=await browser.storage.local.get(snapshotsKey);const snapshots=(stored[snapshotsKey] as Record<string,ChatSnapshot>|undefined)??{};const previous=snapshots[url];if(!previous||Date.parse(snapshot.observedAt)>Date.parse(previous.observedAt)){snapshots[url]=snapshot;await browser.storage.local.set({[snapshotsKey]:snapshots});}}
export async function loadRepositoryWizardChatSnapshot(url:string):Promise<ChatSnapshot|undefined>{const stored=await browser.storage.local.get(snapshotsKey);const snapshots=stored[snapshotsKey] as Record<string,ChatSnapshot>|undefined;return snapshots?.[url];}
