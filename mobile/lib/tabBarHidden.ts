import { useEffect } from 'react';
import { create } from 'zustand';

// La tab bar est FLOTTANTE (posée au-dessus des écrans) : les sheets qui
// montent du bas (détails/commentaires de l'Explorer…) passeraient dessous et
// leurs boutons seraient masqués. Ce store compte les overlays ouverts — la
// barre se cache tant qu'il y en a au moins un. Compteur (pas booléen) : deux
// sheets peuvent se chevaucher, fermer l'un ne doit pas réafficher la barre
// sous l'autre.
type TabBarHiddenState = {
  count: number;
  push: () => void;
  pop: () => void;
};

export const useTabBarHiddenStore = create<TabBarHiddenState>((set) => ({
  count: 0,
  push: () => set((s) => ({ count: s.count + 1 })),
  pop: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

export function useTabBarHidden(): boolean {
  return useTabBarHiddenStore((s) => s.count > 0);
}

// À poser dans un composant d'overlay : cache la tab bar tant que `visible`
// est vrai (et la réaffiche au démontage, même en cas de fermeture brutale).
export function useHideTabBar(visible: boolean): void {
  const push = useTabBarHiddenStore((s) => s.push);
  const pop = useTabBarHiddenStore((s) => s.pop);
  useEffect(() => {
    if (!visible) return;
    push();
    return () => pop();
  }, [visible, push, pop]);
}
