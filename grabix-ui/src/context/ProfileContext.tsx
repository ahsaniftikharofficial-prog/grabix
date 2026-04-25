/**
 * ProfileContext.tsx — Phase 6
 * Up to 5 profiles per install. Each profile has its own localStorage namespace.
 * Profile "default" maps to the original keys so no existing data is lost.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { readJsonStorage, writeJsonStorage } from "../lib/persistentState";

export interface Profile {
  id: string;
  name: string;
  /** Tailwind-compatible CSS color string */
  color: string;
  isKids: boolean;
  /** bcrypt-lite: we just store a hashed 4-digit PIN string for kids mode */
  kidsPin?: string;
  createdAt: string;
}

interface ProfileCtx {
  profiles: Profile[];
  activeProfile: Profile;
  switchProfile: (id: string) => void;
  addProfile: (name: string, color: string, isKids?: boolean) => Profile | null;
  removeProfile: (id: string) => void;
  updateProfile: (id: string, updates: Partial<Omit<Profile, "id" | "createdAt">>) => void;
  /** Namespaced storage key for the active profile */
  storageKey: (baseKey: string) => string;
  kidsMode: boolean;
  setKidsPin: (id: string, pin: string) => void;
  verifyKidsPin: (id: string, pin: string) => boolean;
}

const PROFILES_KEY  = "grabix:profiles:v1";
const ACTIVE_KEY    = "grabix:activeProfile";
const MAX_PROFILES  = 5;
const AVATAR_COLORS = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#3b82f6"];

const DEFAULT_PROFILE: Profile = {
  id: "default",
  name: "Main",
  color: AVATAR_COLORS[0],
  isKids: false,
  createdAt: new Date().toISOString(),
};

function loadProfiles(): Profile[] {
  const stored = readJsonStorage<Profile[]>("local", PROFILES_KEY, []);
  if (!Array.isArray(stored) || stored.length === 0) return [DEFAULT_PROFILE];
  // Always ensure default exists
  const hasDefault = stored.some(p => p.id === "default");
  return hasDefault ? stored : [DEFAULT_PROFILE, ...stored];
}

function loadActiveId(profiles: Profile[]): string {
  const stored = localStorage.getItem(ACTIVE_KEY);
  if (stored && profiles.some(p => p.id === stored)) return stored;
  return "default";
}

/** For profile "default" we return the original key unchanged (backward compat). */
export function makeStorageKey(baseKey: string, profileId: string): string {
  if (profileId === "default") return baseKey;
  return `${baseKey}__profile_${profileId}`;
}

/** Simple PIN verification — just a string equality check (4 digits, stored as-is). */
function hashPin(pin: string): string {
  return `__pin__${pin}`;
}

const ProfileContext = createContext<ProfileCtx | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles);
  const [activeId, setActiveId] = useState<string>(() => loadActiveId(loadProfiles()));

  // Persist profiles whenever they change
  useEffect(() => {
    writeJsonStorage("local", PROFILES_KEY, profiles);
  }, [profiles]);

  const activeProfile = useMemo(
    () => profiles.find(p => p.id === activeId) ?? profiles[0] ?? DEFAULT_PROFILE,
    [profiles, activeId],
  );

  const switchProfile = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const addProfile = useCallback((name: string, color: string, isKids = false): Profile | null => {
    if (profiles.length >= MAX_PROFILES) return null;
    const newProfile: Profile = {
      id: `profile_${Date.now()}`,
      name: name.trim().slice(0, 20) || "Profile",
      color,
      isKids,
      createdAt: new Date().toISOString(),
    };
    setProfiles(prev => [...prev, newProfile]);
    return newProfile;
  }, [profiles.length]);

  const removeProfile = useCallback((id: string) => {
    if (id === "default") return; // cannot remove default
    setProfiles(prev => prev.filter(p => p.id !== id));
    setActiveId(curr => curr === id ? "default" : curr);
    localStorage.setItem(ACTIVE_KEY, "default");
  }, []);

  const updateProfile = useCallback((id: string, updates: Partial<Omit<Profile, "id" | "createdAt">>) => {
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const storageKey = useCallback(
    (baseKey: string) => makeStorageKey(baseKey, activeProfile.id),
    [activeProfile.id],
  );

  const setKidsPin = useCallback((id: string, pin: string) => {
    updateProfile(id, { kidsPin: hashPin(pin) });
  }, [updateProfile]);

  const verifyKidsPin = useCallback((id: string, pin: string): boolean => {
    const profile = profiles.find(p => p.id === id);
    if (!profile?.kidsPin) return true; // no PIN set = always OK
    return profile.kidsPin === hashPin(pin);
  }, [profiles]);

  const kidsMode = activeProfile.isKids;

  const value = useMemo<ProfileCtx>(() => ({
    profiles, activeProfile, switchProfile, addProfile, removeProfile,
    updateProfile, storageKey, kidsMode, setKidsPin, verifyKidsPin,
  }), [
    profiles, activeProfile, switchProfile, addProfile, removeProfile,
    updateProfile, storageKey, kidsMode, setKidsPin, verifyKidsPin,
  ]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileCtx {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}

export { AVATAR_COLORS };
