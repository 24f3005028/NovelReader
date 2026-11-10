import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Chapter } from '@novelreader/shared';
import { palette, s } from '../theme';

function ChapterSheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Modal animationType="slide" onRequestClose={close}>
      <SafeAreaView style={[s.container, styles.sheet]}>
        <View style={[s.row, styles.heading]}>
          <Text accessibilityRole="header" style={[s.heading, styles.grow]}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            onPress={close}
          >
            <Ionicons name="close" size={28} color={palette.text} />
          </Pressable>
        </View>
        {children}
      </SafeAreaView>
    </Modal>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.button, s.secondary, selected && styles.selected]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}

export function DownloadRange({
  chapters,
  savedIds,
  currentId,
  close,
  download,
}: {
  chapters: Chapter[];
  savedIds: string[];
  currentId?: string;
  close: () => void;
  download: (chapters: Chapter[]) => void;
}) {
  const first =
    Math.max(
      0,
      chapters.findIndex((chapter) => chapter.id === currentId),
    ) + 1;
  const [from, setFrom] = useState(String(first));
  const [to, setTo] = useState(String(Math.min(chapters.length, first + 9)));
  const start = Number(from);
  const end = Number(to);
  const valid =
    /^\d+$/.test(from) && /^\d+$/.test(to) && start >= 1 && end >= start && end <= chapters.length;
  const selection = valid ? chapters.slice(start - 1, end) : [];
  const saved = new Set(savedIds);
  const remaining = selection.filter((chapter) => !saved.has(chapter.id)).length;
  const selectRange = (start: number, end: number) => {
    setFrom(String(start));
    setTo(String(end));
  };
  return (
    <ChapterSheet title="Download chapters" close={close}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={s.body}>
          Choose a range in reading order. There are {chapters.length} chapters available.
        </Text>
        <View style={[s.row, styles.fields]}>
          <View style={styles.grow}>
            <Text style={s.label}>From</Text>
            <TextInput
              style={s.input}
              accessibilityLabel="First chapter position"
              keyboardType="number-pad"
              value={from}
              onChangeText={setFrom}
            />
          </View>
          <View style={styles.grow}>
            <Text style={s.label}>Through</Text>
            <TextInput
              style={s.input}
              accessibilityLabel="Last chapter position"
              keyboardType="number-pad"
              value={to}
              onChangeText={setTo}
            />
          </View>
        </View>
        <View style={[s.row, styles.filters]}>
          <Choice
            label="Next 10"
            onPress={() => selectRange(first, Math.min(chapters.length, first + 9))}
          />
          <Choice label="All chapters" onPress={() => selectRange(1, chapters.length)} />
        </View>
        <View style={s.panel}>
          <Text accessibilityLiveRegion="polite" style={s.body}>
            {valid
              ? `${remaining} to download · ${selection.length - remaining} already saved`
              : `Enter a range from 1 to ${chapters.length}.`}
          </Text>
          {valid && (
            <Text style={s.muted} numberOfLines={3}>
              {selection[0].title}
              {start !== end ? ` → ${selection.at(-1)?.title}` : ''}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !remaining }}
          disabled={!remaining}
          onPress={() => download(selection)}
          style={[s.button, !remaining && styles.disabled]}
        >
          <Text style={s.buttonText}>
            {remaining
              ? `Download ${remaining} ${remaining === 1 ? 'chapter' : 'chapters'}`
              : 'Download chapters'}
          </Text>
        </Pressable>
      </ScrollView>
    </ChapterSheet>
  );
}

const rowHeight = 64;
type Filter = 'All' | 'Saved' | 'Bookmarked';

export function ChapterPicker({
  chapters,
  currentId,
  savedIds,
  bookmarks,
  close,
  open,
}: {
  chapters: Chapter[];
  currentId: string;
  savedIds: string[];
  bookmarks: string[];
  close: () => void;
  open: (chapter: Chapter) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const search = query.trim().toLowerCase();
  const saved = useMemo(() => new Set(savedIds), [savedIds]);
  const marked = useMemo(() => new Set(bookmarks), [bookmarks]);
  const matches = chapters.filter(
    (chapter) =>
      (filter !== 'Saved' || saved.has(chapter.id)) &&
      (filter !== 'Bookmarked' || marked.has(chapter.id)) &&
      `${chapter.ordinal} ${chapter.number ?? ''} ${chapter.title}`.toLowerCase().includes(search),
  );
  const initialIndex =
    search || filter !== 'All'
      ? 0
      : Math.max(0, matches.findIndex((chapter) => chapter.id === currentId) - 2);
  return (
    <ChapterSheet title="Chapter list" close={close}>
      <TextInput
        accessibilityLabel="Search chapters"
        style={s.input}
        placeholder="Chapter number or title"
        placeholderTextColor={palette.muted}
        value={query}
        onChangeText={setQuery}
      />
      <View style={[s.row, styles.filters]}>
        {(['All', 'Saved', 'Bookmarked'] as const).map((choice) => (
          <Choice
            key={choice}
            label={choice}
            selected={filter === choice}
            onPress={() => setFilter(choice)}
          />
        ))}
      </View>
      <FlatList
        key={`${filter}:${search}`}
        data={matches}
        keyExtractor={(chapter) => chapter.id}
        initialScrollIndex={matches.length ? initialIndex : undefined}
        getItemLayout={(_, index) => ({ length: rowHeight, offset: rowHeight * index, index })}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={s.muted}>No chapters match this view.</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: item.id === currentId }}
            onPress={() => open(item)}
            style={[styles.chapter, item.id === currentId && styles.selected]}
          >
            <Text style={s.gold}>{item.number ?? item.ordinal}</Text>
            <Text style={[s.body, styles.grow]} numberOfLines={2}>
              {item.title}
            </Text>
            {marked.has(item.id) && <Ionicons name="bookmark" size={16} color={palette.blue} />}
            {saved.has(item.id) && (
              <Ionicons name="checkmark-circle" size={18} color={palette.blue} />
            )}
          </Pressable>
        )}
      />
    </ChapterSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20 },
  heading: { marginVertical: 18 },
  grow: { flex: 1 },
  fields: { alignItems: 'flex-end' },
  filters: { flexWrap: 'wrap', marginBottom: 12 },
  selected: { backgroundColor: '#122842' },
  disabled: { opacity: 0.45 },
  chapter: {
    flexDirection: 'row',
    alignItems: 'center',
    height: rowHeight,
    gap: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
});
