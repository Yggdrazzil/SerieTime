import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COLORS } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

export default function RootLayout() {
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
