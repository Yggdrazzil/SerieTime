import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';
import { useAppStore } from '@/lib/store';
import { resolvedServerUrl } from '@/lib/api';

export default function TabsLayout() {
  const { token, hydrated } = useAppStore();
  // Ouverture directe d'un onglet sans session (web app épinglée, lien profond) :
  // retour à l'écran de connexion plutôt que des écrans vides.
  if (hydrated && (!token || !resolvedServerUrl())) return <Redirect href="/setup" />;
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Séries' }} />
      <Tabs.Screen name="movies" options={{ title: 'Films' }} />
      <Tabs.Screen name="games" options={{ title: 'Jeux' }} />
      <Tabs.Screen name="explore" options={{ title: 'Explorer' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
