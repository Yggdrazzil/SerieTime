import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type UserInfo = {
  id: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
};

type AppState = {
  serverUrl: string | null;
  token: string | null;
  user: UserInfo | null;
  hydrated: boolean;
  // Couverture choisie dans /profile/cover, récupérée par /profile/edit.
  coverPick: string | null;
  setServerUrl: (url: string) => void;
  setAuth: (token: string, user: UserInfo) => void;
  setCoverPick: (url: string | null) => void;
  logout: () => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      serverUrl: null,
      token: null,
      user: null,
      hydrated: false,
      coverPick: null,
      setServerUrl: (url) => set({ serverUrl: url.replace(/\/+$/, '') }),
      setAuth: (token, user) => set({ token, user }),
      setCoverPick: (url) => set({ coverPick: url }),
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: 'serietime-app',
      // Export web statique : pas de `window` pendant le rendu Node → stockage
      // inerte le temps du SSR (le vrai AsyncStorage prend le relais au chargement).
      storage: createJSONStorage(() =>
        typeof window === 'undefined'
          ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }
          : AsyncStorage,
      ),
      partialize: (s) => ({ serverUrl: s.serverUrl, token: s.token, user: s.user }),
      onRehydrateStorage: () => (state) => {
        useAppStore.setState({ hydrated: true });
      },
    },
  ),
);
