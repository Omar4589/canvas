import { View, Text, StyleSheet } from 'react-native';
import Logo from './Logo';
import { spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// The admin Overview's top row: the logo on the left, the viewer's role on the right ("Team Lead",
// "Admin", "Admin · super"). Shared by the org Overview, the Overview's brief "deciding" state, and a
// team lead's embedded campaign home (components/CampaignHome.jsx), so the tab reads the same
// whichever of the three it shows. No caption → logo only (the role isn't read yet).
const AdminHeaderRow = ({ caption = null }) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <Logo size={26} />
      {caption ? <Text style={styles.label}>{caption}</Text> : null}
    </View>
  );
};

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    label: { ...type.caption, color: colors.textSecondary },
  });
}

export default AdminHeaderRow;
