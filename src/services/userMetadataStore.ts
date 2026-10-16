import fs from 'fs';
import path from 'path';

export interface UserMetadata {
  twoFactorEnabled: boolean;
  twoFactorSecret?: string | null;
  isTwoFactorSetup?: boolean;
  imageUrl?: string;
  attachments?: any[];
}

const DATA_FILE = path.resolve(__dirname, '../../user_metadata_store.json');

// In-memory cache
const metadataMap = new Map<string, UserMetadata>();

// Load from file if exists
function loadFromFile() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      for (const [key, val] of Object.entries(parsed)) {
        metadataMap.set(key, val as UserMetadata);
      }
    }
  } catch (err) {
    console.warn('Could not read user_metadata_store.json:', err);
  }
}

// Persist to file
function saveToFile() {
  try {
    const obj: Record<string, UserMetadata> = {};
    metadataMap.forEach((v, k) => {
      obj[k] = v;
    });
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write user_metadata_store.json:', err);
  }
}

// Initialize on startup
loadFromFile();

export const getUserMetadata = (key: string): UserMetadata => {
  if (!key) return { twoFactorEnabled: true };
  const cleanKey = String(key).trim();
  const existing = metadataMap.get(cleanKey) || metadataMap.get(cleanKey.toLowerCase());
  if (existing) {
    return existing;
  }
  // Default: twoFactorEnabled is true for all accounts (can be toggled off)
  const defaultMeta: UserMetadata = {
    twoFactorEnabled: true,
    twoFactorSecret: null,
    isTwoFactorSetup: false,
    imageUrl: '',
    attachments: []
  };
  return defaultMeta;
};

export const setUserMetadata = (key: string, updates: Partial<UserMetadata>, aliasKey?: string) => {
  if (!key) return;
  const cleanKey = String(key).trim();
  const current = getUserMetadata(cleanKey);
  const updated: UserMetadata = {
    ...current,
    ...updates
  };
  
  metadataMap.set(cleanKey, updated);
  metadataMap.set(cleanKey.toLowerCase(), updated);

  if (aliasKey) {
    const cleanAlias = String(aliasKey).trim();
    metadataMap.set(cleanAlias, updated);
    metadataMap.set(cleanAlias.toLowerCase(), updated);
  }

  saveToFile();
  return updated;
};

export const resetUserTwoFactorSecret = (key: string, aliasKey?: string) => {
  return setUserMetadata(
    key,
    {
      twoFactorSecret: null,
      isTwoFactorSetup: false,
      twoFactorEnabled: true
    },
    aliasKey
  );
};
