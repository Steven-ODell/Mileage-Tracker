import { requireNativeModule } from 'expo';

export type ControlsSpec = {
  title: string;
  body: string;
  channelId: string;
  // Android 16 Live Update: pinned expanded at the top of the shade and lock
  // screen, with a status bar chip. Ignored on older Android.
  promote: boolean;
  chipText: string | null;
  // Tapping one opens the app with mileagelog://action/<id>?n=<posted at>.
  actions: { id: string; title: string }[];
};

type Native = {
  show(spec: ControlsSpec): boolean;
  hide(): void;
};

export default requireNativeModule<Native>('TrackingNotification');
