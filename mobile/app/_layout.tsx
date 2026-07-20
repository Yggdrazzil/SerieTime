import React from 'react';
import { View, Image, Platform } from 'react-native';
import { enableScreens } from 'react-native-screens';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  Mulish_400Regular,
  Mulish_500Medium,
  Mulish_600SemiBold,
  Mulish_700Bold,
  Mulish_800ExtraBold,
} from '@expo-google-fonts/mulish';
import { COLORS, IS_DARK, THEME, THEME_COLOR_META, setThemeColorMeta } from '@/lib/theme';
import { GamificationToastHost } from '@/lib/useGamificationToasts';

// Web : le fond du document et la couleur des barres du navigateur suivent le
// thème (sinon bandes blanches autour de l'app en sombre/Sunset). Le
// `color-scheme` de la racine pilote aussi la barre de gestes Android en PWA
// installée (elle restait blanche en sombre sans lui).
if (typeof document !== 'undefined') {
  document.body.style.backgroundColor = COLORS.bg;
  document.documentElement.style.colorScheme = IS_DARK ? 'dark' : 'light';
  // Metas theme-color : couleur solide dédiée (en Glass, `bg` est un voile
  // translucide — les barres système n'acceptent pas d'alpha).
  setThemeColorMeta(THEME_COLOR_META);
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

// Glass : le conteneur React Navigation peint par défaut un gris OPAQUE
// (DefaultTheme, rgb(242,242,242)) qui masquerait le dégradé du document —
// on le rend transparent. Les autres thèmes gardent le thème par défaut
// (leurs écrans peignent des fonds opaques par-dessus).
const baseNavTheme = IS_DARK ? DarkTheme : DefaultTheme;
const navTheme =
  THEME === 'glass'
    ? { ...baseNavTheme, colors: { ...baseNavTheme.colors, background: 'transparent' } }
    : baseNavTheme;

// Glass (web) — correctif de la SUPERPOSITION des onglets. Sur web, les
// screens sont DÉSACTIVÉS par défaut (react-native-screens : ENABLE_SCREENS =
// plateforme native) et, screens désactivés, le fallback de
// @react-navigation/bottom-tabs rend chaque scène dans une View brute SANS
// AUCUN masquage : les onglets inactifs restent peints, seulement relégués en
// zIndex -1. Les fonds opaques des autres thèmes recouvrent ces scènes ; les
// voiles translucides de Glass les laissent transparaître (superposition, et
// pilule de nav « opaque » car le blur échantillonnait l'empilement des
// voiles). enableScreens(true) fait passer les onglets par Screen.web de
// react-native-screens, qui masque VRAIMENT les scènes inactives
// (display:none). Web + Glass uniquement : aucun impact natif, et les autres
// thèmes web gardent leur comportement actuel (scroll conservé entre onglets).
if (Platform.OS === 'web' && THEME === 'glass') enableScreens(true);

export default function RootLayout() {
  // Police de l'app (voir FONTS dans lib/theme.ts) — chargée avant tout rendu.
  const [fontsLoaded] = useFonts({
    Mulish_400Regular,
    Mulish_500Medium,
    Mulish_600SemiBold,
    Mulish_700Bold,
    Mulish_800ExtraBold,
  });
  if (!fontsLoaded) {
    // Écran de démarrage : logo sur le bleu nuit de la marque (l'icône étant
    // elle-même sur fond #0B075A, elle se fond dans la page — seul le motif
    // tricolore apparaît, comme sur le splash natif et le splash PWA).
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B075A' }}>
        <Image
          source={require('../assets/branding/pwa-icon-512.png')}
          style={{ width: 160, height: 160 }}
          resizeMode="contain"
        />
      </View>
    );
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navTheme}>
          <StatusBar style={IS_DARK ? 'light' : 'dark'} />
          {/* Transitions natives (iOS/Android) : glissement fluide entre écrans.
              Sur le web, ces options sont ignorées → l'animation « Pop » au montage
              de chaque page prend le relais. */}
          {/* Glass : cartes transparentes (le dégradé du document transparaît) —
              la superposition est neutralisée par enableScreens(true) ci-dessus. */}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: THEME === 'glass' ? 'transparent' : COLORS.white }, animation: 'slide_from_right' }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="setup" />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            {/* La fiche « pop » depuis le bas, comme l'ouverture d'une fiche TV Time. */}
            <Stack.Screen name="show/[id]" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="settings" />
            <Stack.Screen name="social" />
            <Stack.Screen name="friends" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="user/[id]" />
            <Stack.Screen name="profile/edit" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="profile/cover" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="library/shows" />
            <Stack.Screen name="library/movies" />
            <Stack.Screen name="library/favorite-shows" />
            <Stack.Screen name="library/favorite-movies" />
            <Stack.Screen name="import" />
            <Stack.Screen name="trophies" />
          </Stack>
          {/* Toast global de déblocage (niveau/badge) — monté une fois, visible
              quel que soit l'écran (spec 2026-07-16 §10). */}
          <GamificationToastHost />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
