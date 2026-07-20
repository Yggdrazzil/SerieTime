import React from 'react';
import { StyleSheet } from 'react-native';
import { goBack } from '@/lib/nav';
import { SPACE } from '@/lib/theme';
import { IconAction, ScreenHeader, ScreenShell } from '@/components/prisme';
import { FriendsTab } from './social';

// Écran poussé « Amis » (refonte Communauté 2026-07-20) : recherche de
// profils + mes abonnements. Ouvert par la loupe de l'onglet Communauté ;
// l'onglet lui-même n'a plus de segment « recherche d'amis ».
export default function FriendsScreen() {
  return (
    <ScreenShell contentContainerStyle={styles.content}>
      <ScreenHeader
        title="Amis"
        style={styles.header}
        leading={
          <IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/community')} />
        }
      />
      <FriendsTab />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  // FriendsTab gère ses propres gouttières (cartes avec marges SPACE.md) :
  // on neutralise le padding horizontal du shell pour ne pas les doubler.
  content: { paddingHorizontal: 0, paddingBottom: 0 },
  header: { paddingHorizontal: SPACE.md },
});
