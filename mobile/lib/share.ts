import { Platform, Share } from 'react-native';

// Partage cross-plateforme : web = Web Share API (ou copie presse-papier), natif = Share RN.
export function shareMedia(title: string, url?: string): void {
  const message = `Regarde « ${title} » — sur PlotTime 📺`;
  if (Platform.OS === 'web') {
    const nav =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { share?: (d: object) => Promise<void> })
        : undefined;
    if (nav?.share) {
      nav.share({ title: 'PlotTime', text: message, url }).catch(() => undefined);
    } else if (nav?.clipboard) {
      nav.clipboard.writeText(`${message}${url ? ` ${url}` : ''}`).catch(() => undefined);
    }
    return;
  }
  Share.share({ message }).catch(() => undefined);
}
