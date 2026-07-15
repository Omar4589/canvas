import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Text } from 'react-native';
import * as Location from 'expo-location';
import {
  getLocationGateStatus,
  promptEnableServices,
  subscribeGateBlock,
} from '../lib/location';

// "Location required to canvass" notice for the field map. Renders nothing when GPS is
// healthy. Advisory only — the hard enforcement is the tap-time gate in recordAction.js;
// this just tells the canvasser BEFORE they walk a block that recording will be blocked.
//
// Two signals feed it: a proactive probe (services + permission + Android precise) run on
// mount and whenever the app returns to the foreground (the user may have just come back
// from Settings), and the gate's own block reports — which is the only way to learn about
// iOS PRECISE_OFF, since that state is undetectable until a fix comes back coarse.

const COPY = {
  PERMISSION_DENIED: 'Location is required to canvass — tap to enable it for Doorline.',
  SERVICES_OFF: "Your phone's location is off — canvassing is paused until it's on. Tap to fix.",
  PRECISE_OFF: 'Precise Location is off for Doorline — turn it on in Settings to canvass.',
};

// Same soft red tint as the paused-account banner (light ground, dark text, both themes).
const TONE = { bg: '#FEE2E2', fg: '#991B1B' };

export default function LocationBlockedBanner() {
  const [blockCode, setBlockCode] = useState(null);

  useEffect(() => {
    let alive = true;
    const probe = () => {
      getLocationGateStatus()
        .then((code) => {
          if (alive) setBlockCode(code);
        })
        .catch(() => {});
    };
    probe();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') probe();
    });
    // Tap-time gate results override the probe: they surface iOS PRECISE_OFF and NO_FIX,
    // and a successful fix (null) clears the banner immediately.
    const unsub = subscribeGateBlock((code) => {
      if (!alive) return;
      // NO_FIX is transient (canyon, cold GPS) — the per-tap alert covers it; a
      // persistent banner would just be noise on every bad-signal block.
      if (code === 'NO_FIX') return;
      setBlockCode(code);
    });
    return () => {
      alive = false;
      sub.remove();
      unsub();
    };
  }, []);

  if (!blockCode) return null;

  async function onPress() {
    if (blockCode === 'PERMISSION_DENIED') {
      const resp = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (resp?.status === 'granted') {
        setBlockCode(null);
        return;
      }
      if (resp && resp.canAskAgain === false) Linking.openSettings().catch(() => {});
    } else if (blockCode === 'SERVICES_OFF' && Platform.OS === 'android') {
      promptEnableServices().then(() => setBlockCode(null), () => {});
    } else {
      Linking.openSettings().catch(() => {});
    }
  }

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: TONE.bg,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 7,
        marginHorizontal: 12,
        marginTop: 6,
      }}
    >
      <Text style={{ color: TONE.fg, fontSize: 13, fontWeight: '600' }}>
        {COPY[blockCode] || COPY.PERMISSION_DENIED}
      </Text>
    </Pressable>
  );
}
