import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addressQuery,
  googleDirectionsUrl,
  googleSearchUrl,
  appleDirectionsUrl,
  wazeUrl,
  geoUrl,
  directionsOptions,
  canGetDirections,
  androidAlertOrder,
} from './mapsLinks.js';

// React Native's Android Alert branch, replicated from
// node_modules/react-native/Libraries/Alert/Alert.js: it slices to three buttons then pops
// from the END for positive, negative, neutral. Android draws them neutral | negative |
// positive, left to right, with positive emphasized (the one under the thumb).
const androidSlots = (labels) => {
  const v = labels.slice(0, 3);
  const positive = v.pop();
  const negative = v.pop();
  const neutral = v.pop();
  return { left: neutral, middle: negative, rightEmphasized: positive };
};

const DOOR = {
  addressLine1: '845 Collier Ct',
  addressLine2: 'Apt 2',
  city: 'Kissimmee',
  state: 'FL',
  zipCode: '34741',
  location: { coordinates: [-81.4, 28.3] },
};

test('addressQuery matches the web helper on the web helper\'s own fixture', () => {
  // client/src/lib/pinFixes.test.js pins this exact string for googleMapsUrl. The two
  // joins must not drift: same door, same query, web and mobile.
  assert.equal(addressQuery(DOOR), '845 Collier Ct, Kissimmee, FL 34741');
});

test('addressQuery omits the unit: a unit never changes the walking route and confuses geocoders', () => {
  assert.ok(!addressQuery(DOOR).includes('Apt 2'));
});

test('addressQuery drops whatever the voter file lacks, never renders "undefined"', () => {
  assert.equal(addressQuery({ addressLine1: '12 Elm St' }), '12 Elm St');
  assert.equal(addressQuery({ addressLine1: '12 Elm St', city: 'Ocala' }), '12 Elm St, Ocala');
  // state with no zip must not leave a trailing space inside the segment
  assert.equal(addressQuery({ addressLine1: '12 Elm St', city: 'Ocala', state: 'FL' }), '12 Elm St, Ocala, FL');
  // zip with no state is still a useful segment on its own
  assert.equal(addressQuery({ addressLine1: '12 Elm St', zipCode: '34471' }), '12 Elm St, 34471');
  assert.equal(addressQuery({}), '');
  assert.equal(addressQuery(), '');
  for (const q of [addressQuery({ addressLine1: '12 Elm St' }), addressQuery({})]) {
    assert.ok(!/undefined|null/.test(q), q);
  }
});

test('every URL carries the address encoded exactly once, and no pin coordinate', () => {
  const encoded = '845%20Collier%20Ct%2C%20Kissimmee%2C%20FL%2034741';
  for (const url of [
    googleDirectionsUrl(DOOR),
    googleSearchUrl(DOOR),
    appleDirectionsUrl(DOOR),
    wazeUrl(DOOR),
    geoUrl(DOOR),
  ]) {
    assert.ok(url.includes(encoded), url);
    assert.equal(url.split(encoded).length - 1, 1, `encoded once: ${url}`);
    // THE load-bearing assertion: the pin must never reach a maps app. A wrong pin is
    // the reason this feature exists.
    assert.ok(!url.includes('28.3') && !url.includes('81.4'), `no coordinates: ${url}`);
  }
});

test('the exact URL forms, so a silent edit to one of them fails here', () => {
  assert.equal(
    googleDirectionsUrl(DOOR),
    'https://www.google.com/maps/dir/?api=1&destination=845%20Collier%20Ct%2C%20Kissimmee%2C%20FL%2034741&travelmode=walking'
  );
  // byte-identical to client/src/lib/pinFixes.js googleMapsUrl
  assert.equal(
    googleSearchUrl(DOOR),
    'https://www.google.com/maps/search/?api=1&query=845%20Collier%20Ct%2C%20Kissimmee%2C%20FL%2034741'
  );
  // The LEGACY Apple form on purpose: Apple 301-rewrites it to the unified /directions
  // URL, and the unified form is documented only for iOS 18.4+. One URL, every iOS.
  assert.equal(
    appleDirectionsUrl(DOOR),
    'https://maps.apple.com/?daddr=845%20Collier%20Ct%2C%20Kissimmee%2C%20FL%2034741&dirflg=w'
  );
  assert.equal(
    wazeUrl(DOOR),
    'https://waze.com/ul?q=845%20Collier%20Ct%2C%20Kissimmee%2C%20FL%2034741&navigate=yes'
  );
  // 0,0 is Android's required placeholder point in the "show this address" form.
  assert.equal(geoUrl(DOOR), 'geo:0,0?q=845%20Collier%20Ct%2C%20Kissimmee%2C%20FL%2034741');
});

test('walking mode on every provider that takes one', () => {
  assert.ok(googleDirectionsUrl(DOOR).includes('travelmode=walking'));
  assert.ok(appleDirectionsUrl(DOOR).includes('dirflg=w'));
});

test('an ampersand in a street name cannot break out of the query', () => {
  const odd = { addressLine1: "12 O'Brien & Sons Rd", city: 'Ocala', state: 'FL', zipCode: '34471' };
  const url = googleDirectionsUrl(odd);
  // The & is the dangerous one: unencoded, everything after it reads as another URL
  // parameter and the destination is silently truncated to "12 O'Brien ".
  assert.ok(url.includes('%26'));
  assert.equal(url.split('&').length - 1, 2, 'only our own two separators remain');
  // The apostrophe passes through literally — encodeURIComponent leaves it alone, and it
  // is harmless in a query string. Pinned so nobody "fixes" it into %27 and breaks the
  // byte-for-byte match with the web helper.
  assert.ok(url.includes("O'Brien"));
});

test('iOS offers three named apps, Android two rows plus the OS chooser', () => {
  const ios = directionsOptions(DOOR, 'ios');
  assert.deepEqual(ios.map((o) => o.key), ['apple', 'google', 'waze']);
  assert.deepEqual(ios.map((o) => o.label), ['Apple Maps', 'Google Maps', 'Waze']);

  const android = directionsOptions(DOOR, 'android');
  assert.deepEqual(android.map((o) => o.key), ['google', 'other']);
  // Android's Alert caps at three buttons; two rows + Cancel is exactly the cap.
  assert.ok(android.length <= 2, 'two rows leaves room for Cancel within Android\'s 3-button cap');
  assert.equal(android[1].url, geoUrl(DOOR), '"Another maps app" hands off via geo:');
});

test('no option ever points at a custom scheme we would have to declare natively', () => {
  // comgooglemaps:// and waze:// would work with openURL but tempt a canOpenURL probe,
  // which needs Info.plist/manifest config = a fingerprint move = four store builds.
  for (const platform of ['ios', 'android']) {
    for (const o of directionsOptions(DOOR, platform)) {
      assert.ok(
        o.url.startsWith('https://') || o.url.startsWith('geo:'),
        `${platform}/${o.key} must be https or geo:, got ${o.url}`
      );
    }
  }
});

test('canGetDirections hides the affordance when there is no street line to geocode', () => {
  assert.equal(canGetDirections(DOOR), true);
  assert.equal(canGetDirections({ city: 'Kissimmee', state: 'FL' }), false);
  assert.equal(canGetDirections(null), false);
  assert.equal(canGetDirections(undefined), false);
});

test('Android: Cancel lands in the throwaway slot and Google Maps under the thumb', () => {
  const options = directionsOptions(DOOR, 'android');
  // exactly what components/DirectionsButton.jsx passes to Alert.alert
  const passed = ['Cancel', ...androidAlertOrder(options).map((o) => o.label)];
  const slots = androidSlots(passed);

  assert.equal(slots.left, 'Cancel');
  assert.equal(slots.middle, 'Another maps app');
  assert.equal(slots.rightEmphasized, 'Google Maps');

  // The regression this guards: passing the rows in the obvious order (rows then Cancel)
  // silently makes Cancel the emphasized button, so the tap that should open Google Maps
  // dismisses the dialog instead. RN's Android branch ignores style:'cancel' entirely.
  const naive = [...options.map((o) => o.label), 'Cancel'];
  assert.equal(androidSlots(naive).rightEmphasized, 'Cancel');
});

test('androidAlertOrder does not mutate the caller\'s array', () => {
  const options = directionsOptions(DOOR, 'android');
  const before = options.map((o) => o.key);
  androidAlertOrder(options);
  assert.deepEqual(options.map((o) => o.key), before);
});
