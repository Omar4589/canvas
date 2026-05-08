import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

export default function OrganizationsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations'],
    queryFn: () => api('/super-admin/organizations'),
  });

  const createMut = useMutation({
    mutationFn: (body) => api('/super-admin/organizations', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
      setShowCreate(false);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) =>
      api(`/super-admin/organizations/${id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin', 'organizations'] }),
  });

  const orgs = orgsQ.data?.organizations || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Control Room</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Organizations</Text>
        <Pressable onPress={() => setShowCreate(true)} hitSlop={8}>
          <Text style={styles.headerAction}>+ New</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        {orgsQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : orgs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No organizations yet. Tap "+ New" to create one.
            </Text>
          </View>
        ) : (
          orgs.map((o) => (
            <View key={o.id} style={styles.orgCard}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orgName}>{o.name}</Text>
                  <Text style={styles.orgSlug}>{o.slug}</Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    o.isActive ? styles.statusActive : styles.statusInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      o.isActive ? styles.statusActiveText : styles.statusInactiveText,
                    ]}
                  >
                    {o.isActive ? 'active' : 'inactive'}
                  </Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{o.memberCount}</Text>
                  <Text style={styles.statLabel}>Members</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{o.campaignCount}</Text>
                  <Text style={styles.statLabel}>Campaigns</Text>
                </View>
              </View>
              <Pressable
                onPress={() => toggleMut.mutate({ id: o.id, isActive: !o.isActive })}
                disabled={toggleMut.isPending}
                style={[
                  styles.toggleBtn,
                  o.isActive ? styles.toggleBtnDeactivate : styles.toggleBtnActivate,
                ]}
              >
                <Text
                  style={[
                    styles.toggleBtnText,
                    o.isActive
                      ? styles.toggleBtnTextDeactivate
                      : styles.toggleBtnTextActivate,
                  ]}
                >
                  {o.isActive ? 'Deactivate' : 'Reactivate'}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Modal
        transparent
        visible={showCreate}
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setShowCreate(false)}>
            <Pressable style={styles.formSheet} onPress={(e) => e.stopPropagation()}>
              <CreateOrgForm
                onSubmit={(body) => createMut.mutate(body)}
                onCancel={() => setShowCreate(false)}
                submitting={createMut.isPending}
                error={createMut.error}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function CreateOrgForm({ onSubmit, onCancel, submitting, error }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const valid = name.trim().length > 0;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.formTitle}>New organization</Text>

      <Text style={styles.formLabel}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Acme Campaigns LLC"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
        autoCapitalize="words"
      />

      <Text style={styles.formLabel}>
        Slug <Text style={{ color: colors.textMuted }}>(optional)</Text>
      </Text>
      <TextInput
        value={slug}
        onChangeText={setSlug}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="acme-campaigns"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      )}

      <View style={styles.formButtons}>
        <Pressable onPress={onCancel} style={[styles.formBtn, styles.formBtnSecondary]}>
          <Text style={styles.formBtnSecondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            onSubmit({ name: name.trim(), slug: slug.trim() || undefined })
          }
          disabled={!valid || submitting}
          style={[
            styles.formBtn,
            styles.formBtnPrimary,
            { opacity: valid && !submitting ? 1 : 0.5 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.formBtnPrimaryText}>Create</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  headerTitle: { ...type.h3 },
  headerAction: { color: colors.brand, fontWeight: '700', fontSize: 14 },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },

  orgCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  orgName: { ...type.h3, fontSize: 16 },
  orgSlug: { ...type.caption, fontSize: 11, marginTop: 1 },

  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statusActive: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  statusActiveText: { color: colors.success },
  statusInactive: { backgroundColor: colors.bg, borderColor: colors.border },
  statusInactiveText: { color: colors.textSecondary },

  statsRow: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.lg },
  statCell: { flex: 1 },
  statValue: { ...type.h2, fontSize: 18, fontVariant: ['tabular-nums'] },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  toggleBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  toggleBtnActivate: { borderColor: colors.successBorder, backgroundColor: colors.successBg },
  toggleBtnTextActivate: { color: colors.success, fontWeight: '700', fontSize: 13 },
  toggleBtnDeactivate: { borderColor: '#FCA5A5', backgroundColor: colors.dangerBg },
  toggleBtnTextDeactivate: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  toggleBtnText: {},

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  formSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '90%',
  },
  formTitle: { ...type.h2, fontSize: 18, marginBottom: 4 },
  formLabel: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  errorBox: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  errorText: { color: colors.danger, fontSize: 14 },
  formButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  formBtn: { flex: 1, paddingVertical: spacing.md + 2, borderRadius: radius.md, alignItems: 'center' },
  formBtnPrimary: { backgroundColor: colors.brand },
  formBtnPrimaryText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  formBtnSecondary: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formBtnSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
});
