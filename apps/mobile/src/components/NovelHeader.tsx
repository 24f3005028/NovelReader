import type { ComponentProps, ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { Novel } from '@novelreader/shared';
import { palette, s } from '../theme';

type Icon = ComponentProps<typeof Ionicons>['name'];

export function NovelAction({
  label,
  icon,
  primary,
  disabled,
  onPress,
}: {
  label: string;
  icon: Icon;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.primary,
        (disabled || pressed) && styles.dimmed,
      ]}
    >
      <Ionicons name={icon} size={20} color={primary ? '#051628' : '#8ac8ff'} />
      <Text style={[styles.actionLabel, primary && styles.primaryLabel]}>{label}</Text>
    </Pressable>
  );
}

export function NovelHeader({
  novel,
  cover,
  count,
  saved,
  rating,
  children,
}: {
  novel: Novel;
  cover: ReactNode;
  count: number;
  saved: number;
  rating: number | null | undefined;
  children: ReactNode;
}) {
  const stats: { icon: Icon; value: string; label: string }[] = [
    { icon: 'star', value: rating?.toFixed(1) ?? '—', label: 'Rating' },
    { icon: 'layers-outline', value: count.toLocaleString(), label: 'Chapters' },
    { icon: 'cloud-download-outline', value: saved.toLocaleString(), label: 'Offline' },
  ];
  return (
    <View style={styles.hero}>
      {novel.cover && (
        <Image source={{ uri: novel.cover }} blurRadius={22} style={styles.backdrop} />
      )}
      <LinearGradient colors={['#0b1828d9', '#0a101b', '#090d16']} style={styles.content}>
        <View style={styles.identity}>
          {cover}
          <View style={styles.titleBlock}>
            <Text style={s.section}>{novel.genres[0]?.toUpperCase() || 'LIGHT NOVEL'}</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {novel.title}
            </Text>
            <View style={styles.author}>
              <Ionicons name="person-outline" size={15} color={palette.muted} />
              <Text style={[s.muted, { flexShrink: 1 }]}>{novel.author || 'Unknown author'}</Text>
            </View>
          </View>
        </View>
        <View style={styles.stats}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Ionicons name={stat.icon} size={19} color="#60b5ff" />
              <Text style={styles.value}>{stat.value}</Text>
              <Text style={s.small}>{stat.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.actions}>{children}</View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#20334c',
    marginTop: 14,
  },
  backdrop: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  content: { padding: 16, gap: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  titleBlock: { flex: 1, gap: 8 },
  title: { color: palette.text, fontSize: 23, fontWeight: '800', lineHeight: 29 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stats: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#24344b',
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  value: { color: palette.text, fontSize: 16, fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#13253b',
    borderRadius: 12,
  },
  primary: { backgroundColor: '#59b1ff' },
  actionLabel: { color: '#cce7ff', fontSize: 14, fontWeight: '700' },
  primaryLabel: { color: '#051628' },
  dimmed: { opacity: 0.45 },
});
