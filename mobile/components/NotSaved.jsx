import { useEffect, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getNotSaved, removeNotSaved, getWaiting, readNotices, subscribeQueue } from '../lib/offlineQueue';
import { subscribeSession } from '../lib/authState';
import { loadQueueHoldEnabled } from '../lib/cache';
import {
  notSavedBanner,
  reasonText,
  kindLabel,
  waitingLine,
  preUpdateLine,
  waitedLine,
  deletedAccountLine,
} from '../lib/queueRules';
import { useTheme } from '../lib/ThemeContext';

// What the offline queue has to tell the person holding the phone (docs/PROPOSAL_OFFLINE_QUEUE.md):
//
//   NotSavedBanner — "1 item wasn't saved — tap to see why", for the signed-in person's own turned-down
//     saves. On the map and Books, and also on the screens a refusal can put in their place (Not assigned
//     to this campaign, the organization picker, the menu), because the common reasons take those away.
//   NotSavedSheet — each one: the house (from the cached books, when they're here — the phone stores no
//     address with a save), what was recorded, when, why, and Remove. Nothing is resent from the phone.
//   QueueLines — someone else's saves waiting on this phone, saves from before the app update, and the
//     notices owed after a removal (a deleted account's saves, someone's that waited 30 days) — those only
//     on the sign-in screen and in the menu, until the next sign-in.

const rowStyle = (bg) => ({
  backgroundColor: bg,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 7,
  marginHorizontal: 12,
  marginTop: 6,
});

// Re-read on every queue write, sign-in change and return to the app.
export const useQueueView = () => {
  const [view, setView] = useState({ notSaved: [], waiting: { others: [], unstamped: 0 }, notices: { deleted: null, waited: [] }, holdOn: true });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [notSaved, waiting, notices, holdOn] = await Promise.all([
          getNotSaved(),
          getWaiting(),
          readNotices(),
          loadQueueHoldEnabled().catch(() => true),
        ]);
        if (alive) setView({ notSaved, waiting, notices, holdOn });
      } catch {
        // keep the last view
      }
    };
    load();
    const unQueue = subscribeQueue(load);
    const unSession = subscribeSession(load);
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => {
      alive = false;
      unQueue();
      unSession();
      appSub.remove();
    };
  }, []);
  return view;
};

const whenText = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// The house's address from the cached books, when this person still has it — never stored with the save.
const houseLine = (bootstrap, householdId) => {
  const h = (bootstrap?.households || []).find((x) => String(x._id) === String(householdId));
  if (!h) return null;
  return [h.addressLine1, h.addressLine2].filter(Boolean).join(' ') || null;
};

export const NotSavedSheet = ({ visible, onClose, entries }) => {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const bootstrap = qc.getQueryData(['bootstrap']);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.backdrop }}>
        <View
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '80%',
            paddingBottom: insets.bottom + 12,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.textPrimary }} accessibilityRole="header">
              Not saved
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.brand }}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>
              Doorline couldn&apos;t accept these when they uploaded. Knock the door again if you can.
            </Text>
            {entries.map((e) => {
              const house = houseLine(bootstrap, e.householdId);
              return (
                <View
                  key={e.id}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 4 }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
                    {house ? `${house} · ${kindLabel(e)}` : `${kindLabel(e)} · a door you recorded`}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>{whenText(e.tapAt || e.refusedAt)}</Text>
                  <Text style={{ fontSize: 14, color: colors.textPrimary }}>{reasonText(e)}</Text>
                  <Pressable
                    onPress={() => removeNotSaved(e.id).catch(() => {})}
                    hitSlop={8}
                    style={{ alignSelf: 'flex-end', paddingTop: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${kindLabel(e)}`}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>Remove</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const NotSavedBanner = () => {
  const { colors } = useTheme();
  const { notSaved } = useQueueView();
  const [open, setOpen] = useState(false);
  // Removing the last entry hides the banner but keeps it mounted: close the sheet, or the next refusal
  // would bring the banner back with its sheet already open.
  useEffect(() => {
    if (!notSaved.length) setOpen(false);
  }, [notSaved.length]);
  if (!notSaved.length) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [rowStyle(colors.warnBg), { opacity: pressed ? 0.8 : 1 }]}
        accessibilityRole="button"
        accessibilityHint="Shows what wasn't saved and why"
      >
        <Text style={{ color: colors.warnFg, fontSize: 13, fontWeight: '600' }}>{notSavedBanner(notSaved.length)}</Text>
      </Pressable>
      <NotSavedSheet visible={open} onClose={() => setOpen(false)} entries={notSaved} />
    </>
  );
};

// The lines about saves that aren't this person's (the sign-in screen, the menu, Books). `notices: false`
// leaves out the removal notices (Books: they belong to the sign-in screen and the menu).
export const QueueLines = ({ style, textStyle, boxed = false, notices: withNotices = true }) => {
  const { colors } = useTheme();
  const { waiting, notices, holdOn } = useQueueView();
  const lines = [];
  if (holdOn) {
    for (const w of waiting.others) lines.push(waitingLine({ count: w.count, name: w.name }));
    if (waiting.unstamped) lines.push(preUpdateLine(waiting.unstamped));
  }
  if (withNotices) {
    if (notices.deleted?.count) lines.push(deletedAccountLine(notices.deleted.count));
    for (const w of notices.waited) lines.push(waitedLine(w));
  }
  if (!lines.length) return null;
  return (
    // boxed: a card behind the lines where they float over a map (Books).
    <View style={[{ gap: 6 }, boxed && rowStyle(colors.card), style]}>
      {lines.map((l) => (
        <Text key={l} style={[{ fontSize: 13, color: colors.textSecondary }, textStyle]}>
          {l}
        </Text>
      ))}
    </View>
  );
};
