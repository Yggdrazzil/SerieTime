import { create } from 'zustand';
import { router, type Href } from 'expo-router';
import { useAppStore } from '@/lib/store';

// Aperçu de profil en popup (feuille basse) : partout où un avatar/pseudo est
// visible, un tap ouvre ce résumé plutôt qu'une navigation directe. L'hôte
// unique (components/UserPreviewSheet.tsx, monté dans app/_layout.tsx) écoute
// `userId` — pattern identique à lib/tabBarHidden.ts (store zustand + hooks).
type UserPreviewState = {
  userId: string | null;
  open: (id: string) => void;
  close: () => void;
};

export const useUserPreviewStore = create<UserPreviewState>((set) => ({
  userId: null,
  open: (id) => {
    // Pas d'aperçu de soi-même : quand l'id courant est connu, on file
    // directement au profil public (qui gère déjà le cas isSelf).
    if (id && id === useAppStore.getState().user?.id) {
      router.push(('/user/' + id) as Href);
      return;
    }
    set({ userId: id });
  },
  close: () => set({ userId: null }),
}));

// À utiliser sur les call-sites : `const openUserPreview = useOpenUserPreview();`
export function useOpenUserPreview(): (id: string) => void {
  return useUserPreviewStore((s) => s.open);
}
