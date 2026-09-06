import { ActionSheetIOS, Alert, Linking, Platform, Pressable, StyleSheet, Text } from 'react-native';
import {
  addressQuery,
  androidAlertOrder,
  canGetDirections,
  directionsOptions,
  googleSearchUrl,
} from '../lib/mapsLinks';
import { useThemedStyles } from '../lib/useThemedStyles';

// "Directions →" beside a door's address: hands the ADDRESS (never our pin — see
// lib/mapsLinks.js) to whichever maps app the canvasser picks. Renders as a brand-colored
// link in the "Fix pin location →" grammar, on all six surfaces that show a door address.
//
// Every open is openURL().catch(fallback) and NEVER canOpenURL: the probe needs native
// config this build doesn't carry, so it would answer false for geo:/waze:// and hide
// working options. The fallback is the Google https search URL, which resolves for anyone
// with a browser.
export default function DirectionsButton({ household, style }) {
  const styles = useThemedStyles(makeStyles);
  if (!canGetDirections(household)) return null;

  const open = (url) => {
    Linking.openURL(url).catch(() => {
      // Nothing handled the scheme (no Waze, no maps app for geo:). The https Google URL
      // resolves for anyone with a browser.
      Linking.openURL(googleSearchUrl(household)).catch(() => {});
    });
  };

  const onPress = () => {
    const options = directionsOptions(household, Platform.OS);
    const title = addressQuery(household);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [...options.map((o) => o.label), 'Cancel'],
          cancelButtonIndex: options.length,
        },
        (i) => {
          if (i >= 0 && i < options.length) open(options[i].url);
        }
      );
      return;
    }

    // Android's Alert caps at three buttons, which is exactly two rows + Cancel — and the
    // ORDER here is not the order Android draws. RN assigns the slots by popping from the
    // END of the array (Alert.js: positive = pop(), negative = pop(), neutral = pop()), and
    // Android renders neutral | negative | positive left-to-right with positive emphasized.
    // So Cancel must come FIRST to land in the leftmost neutral slot, and the primary
    // destination LAST to land in the emphasized one. Listing Cancel last would put it under
    // the thumb, dismissing the dialog where the user expects Google Maps. `style: 'cancel'`
    // does not save us — the Android branch never reads it. Same ordering as the repo's other
    // three-button alert in admin/notes.jsx.
    Alert.alert('Directions', title, [
      { text: 'Cancel', style: 'cancel' },
      ...androidAlertOrder(options).map((o) => ({ text: o.label, onPress: () => open(o.url) })),
    ]);
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Directions to ${addressQuery(household)}`}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }, style]}
    >
      <Text style={styles.linkText}>Directions →</Text>
    </Pressable>
  );
}

function makeStyles(t) {
  const { colors } = t;
  return StyleSheet.create({
    // The link sits in column layouts, where a Pressable would otherwise stretch the full
    // row width and swallow taps well to the right of the words.
    link: { alignSelf: 'flex-start' },
    linkText: { color: colors.brand, fontSize: 13, fontWeight: '700' },
  });
}
