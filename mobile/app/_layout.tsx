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
import { COLORS } from '@/lib/theme';

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
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.white } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="setup" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="show/[id]" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="social" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="user/[id]" />
            <Stack.Screen name="profile/edit" />
            <Stack.Screen name="profile/cover" />
            <Stack.Screen name="import" />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
