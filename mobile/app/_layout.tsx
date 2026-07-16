import React from 'react';
import { View, ActivityIndicator, Text, TextInput } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
import { COLORS, IS_DARK, setThemeColorMeta } from '@/lib/theme';
import { GamificationToastHost } from '@/lib/useGamificationToasts';

// Web : le fond du document et la couleur des barres du navigateur suivent le
// thème (sinon bandes blanches autour de l'app en sombre/Sunset). Le
// `color-scheme` de la racine pilote aussi la barre de gestes Android en PWA
// installée (elle restait blanche en sombre sans lui).
if (typeof document !== 'undefined') {
  document.body.style.backgroundColor = COLORS.bg;
  document.documentElement.style.colorScheme = IS_DARK ? 'dark' : 'light';
  setThemeColorMeta(COLORS.bg);
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

// Rendu identique pour tous (règle « copie fidèle de TV Time ») : le réglage
// système « taille de police » ne doit pas gonfler nos textes — TV Time
// l'ignore aussi, et c'était une des causes du texte « trop gros » constaté.
type ScalableText = typeof Text & { defaultProps?: { allowFontScaling?: boolean } };
(Text as ScalableText).defaultProps = { ...(Text as ScalableText).defaultProps, allowFontScaling: false };
(TextInput as ScalableText).defaultProps = { ...(TextInput as ScalableText).defaultProps, allowFontScaling: false };

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
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white }}>
        <ActivityIndicator color={COLORS.black} />
      </View>
    );
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={IS_DARK ? 'light' : 'dark'} />
          {/* Transitions natives (iOS/Android) : glissement fluide entre écrans.
              Sur le web, ces options sont ignorées → l'animation « Pop » au montage
              de chaque page prend le relais. */}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.white }, animation: 'slide_from_right' }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="setup" />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            {/* La fiche « pop » depuis le bas, comme l'ouverture d'une fiche TV Time. */}
            <Stack.Screen name="show/[id]" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="settings" />
            <Stack.Screen name="social" />
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
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
