export type TimingSettings={
  pageSettleMs:number;
  sessionReadyTimeoutMs:number;
  sessionStableMs:number;
  composerTextTimeoutMs:number;
  sendControlTimeoutMs:number;
  submissionTimeoutMs:number;
  conversationLinkGraceMs:number;
  conversationLinkStableMs:number;
  conversationLinkTimeoutMs:number;
  tabReadyTimeoutMs:number;
  bridgeReadyTimeoutMs:number;
  pollIntervalMs:number;
  assistantStableMs:number;
  snapshotDebounceMs:number;
  chatSnapshotPollMs:number;
  setupReplyTimeoutMs:number;
  a0ResponseTimeoutMs:number;
  githubRequestTimeoutMs:number;
};

export const DEFAULT_TIMING_SETTINGS:TimingSettings={
  pageSettleMs:5_000,
  sessionReadyTimeoutMs:20_000,
  sessionStableMs:3_000,
  composerTextTimeoutMs:4_000,
  sendControlTimeoutMs:5_000,
  submissionTimeoutMs:10_000,
  conversationLinkGraceMs:5_000,
  conversationLinkStableMs:1_500,
  conversationLinkTimeoutMs:30_000,
  tabReadyTimeoutMs:30_000,
  bridgeReadyTimeoutMs:15_000,
  pollIntervalMs:500,
  assistantStableMs:1_500,
  snapshotDebounceMs:700,
  chatSnapshotPollMs:5_000,
  setupReplyTimeoutMs:120_000,
  a0ResponseTimeoutMs:180_000,
  githubRequestTimeoutMs:20_000,
};

const ranges:Record<keyof TimingSettings,{min:number;max:number}>={
  pageSettleMs:{min:0,max:60_000},
  sessionReadyTimeoutMs:{min:1_000,max:180_000},
  sessionStableMs:{min:0,max:30_000},
  composerTextTimeoutMs:{min:0,max:60_000},
  sendControlTimeoutMs:{min:0,max:60_000},
  submissionTimeoutMs:{min:1_000,max:120_000},
  conversationLinkGraceMs:{min:0,max:120_000},
  conversationLinkStableMs:{min:0,max:30_000},
  conversationLinkTimeoutMs:{min:1_000,max:180_000},
  tabReadyTimeoutMs:{min:1_000,max:180_000},
  bridgeReadyTimeoutMs:{min:1_000,max:120_000},
  pollIntervalMs:{min:100,max:10_000},
  assistantStableMs:{min:0,max:30_000},
  snapshotDebounceMs:{min:0,max:10_000},
  chatSnapshotPollMs:{min:1_000,max:60_000},
  setupReplyTimeoutMs:{min:1_000,max:900_000},
  a0ResponseTimeoutMs:{min:1_000,max:1_800_000},
  githubRequestTimeoutMs:{min:1_000,max:180_000},
};

export function validateTimingSettings(value:Record<string,unknown>):TimingSettings{
  const next={} as TimingSettings;
  for(const key of Object.keys(DEFAULT_TIMING_SETTINGS) as (keyof TimingSettings)[]){
    const item=value[key],range=ranges[key];
    if(typeof item!=='number'||!Number.isSafeInteger(item)||item<range.min||item>range.max)throw new Error(`${key} must be a whole number from ${range.min} to ${range.max}.`);
    next[key]=item;
  }
  return next;
}

export function readTimingSettings(value:unknown):TimingSettings{
  if(!value||typeof value!=='object'||Array.isArray(value))return {...DEFAULT_TIMING_SETTINGS};
  const input=value as Record<string,unknown>;
  const next={...DEFAULT_TIMING_SETTINGS};
  for(const key of Object.keys(DEFAULT_TIMING_SETTINGS) as (keyof TimingSettings)[]){
    const item=input[key],range=ranges[key];
    if(typeof item==='number'&&Number.isSafeInteger(item)&&item>=range.min&&item<=range.max)next[key]=item;
  }
  return next;
}
