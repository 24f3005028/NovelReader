import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Novel } from '@novelreader/shared';
import { normalizeNovelTitle } from '@novelreader/shared';
import { palette, s } from '../theme';

export const shelves = ['Want to read', 'Reading', 'Finished', 'Archived'] as const;
export type Shelf = (typeof shelves)[number];
export type LibraryEntry = { shelf?: Shelf; favorite?: boolean };
export type ReadingPosition = {
  chapterId: string;
  offset: number;
  title: string;
  completed?: boolean;
  updatedAt?: number;
};
export type ChapterNotes = Record<string, string>;

export const libraryKey = (novel: Novel) =>
  novel.catalogKey || normalizeNovelTitle(novel.title) || novel.id;

export function LibraryChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.genreChip, selected && s.genreActive]}
    >
      <Text style={selected ? s.link : s.small}>{label}</Text>
    </Pressable>
  );
}

export function LibraryActions({
  entry,
  inferredShelf,
  onChange,
}: {
  entry: LibraryEntry;
  inferredShelf: Shelf;
  onChange: (entry: LibraryEntry) => void;
}) {
  return (
    <View style={s.panel}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.heading}>Reading shelf</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={entry.favorite ? 'Remove favorite' : 'Add favorite'}
          accessibilityState={{ selected: !!entry.favorite }}
          onPress={() => onChange({ ...entry, favorite: !entry.favorite })}
        >
          <Ionicons
            name={entry.favorite ? 'heart' : 'heart-outline'}
            size={24}
            color={palette.blue}
          />
        </Pressable>
      </View>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        {shelves.map((shelf) => (
          <LibraryChip
            key={shelf}
            label={shelf}
            selected={(entry.shelf || inferredShelf) === shelf}
            onPress={() => onChange({ ...entry, shelf: entry.shelf === shelf ? undefined : shelf })}
          />
        ))}
      </View>
    </View>
  );
}

export function LibraryBrowser({
  novels,
  entries,
  progress,
  downloads,
  onOpen,
  onResume,
  cover,
}: {
  novels: Novel[];
  entries: Record<string, LibraryEntry>;
  progress: Record<string, ReadingPosition>;
  downloads: Record<string, string[]>;
  onOpen: (novel: Novel) => void;
  onResume: (novel: Novel) => void;
  cover: (novel: Novel) => ReactNode;
}) {
  const filters = ['All', 'Favorites', ...shelves] as const;
  const [filter, setFilter] = useState<(typeof filters)[number]>('All');
  const [sort, setSort] = useState<'Recent' | 'A–Z' | 'Author'>('Recent');
  const [query, setQuery] = useState('');
  const recent = novels
    .filter(
      (novel) =>
        progress[novel.id] &&
        !['Archived', 'Finished'].includes(entries[libraryKey(novel)]?.shelf || ''),
    )
    .sort((a, b) => (progress[b.id]?.updatedAt ?? 0) - (progress[a.id]?.updatedAt ?? 0));
  const search = query.trim().toLowerCase();
  const visible = novels
    .filter((novel) => {
      const entry = entries[libraryKey(novel)];
      const shelf = entry?.shelf || (progress[novel.id] ? 'Reading' : 'Want to read');
      const matchesShelf =
        filter === 'All'
          ? shelf !== 'Archived'
          : filter === 'Favorites'
            ? Boolean(entry?.favorite && shelf !== 'Archived')
            : filter === shelf;
      return matchesShelf && `${novel.title} ${novel.author}`.toLowerCase().includes(search);
    })
    .sort((a, b) =>
      sort === 'Recent'
        ? (progress[b.id]?.updatedAt ?? 0) - (progress[a.id]?.updatedAt ?? 0)
        : sort === 'Author'
          ? a.author.localeCompare(b.author) || a.title.localeCompare(b.title)
          : a.title.localeCompare(b.title),
    );
  return (
    <>
      <Text style={s.hero}>Library</Text>
      {recent.length > 0 && !search && filter === 'All' && (
        <View style={s.panel}>
          <Text style={s.heading}>Continue reading</Text>
          {recent.slice(0, 3).map((novel) => (
            <Pressable
              key={novel.id}
              accessibilityRole="button"
              onPress={() => onResume(novel)}
              style={[s.row, { justifyContent: 'space-between' }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.link} numberOfLines={1}>
                  {novel.title}
                </Text>
                <Text style={s.small} numberOfLines={1}>
                  {progress[novel.id].title}
                </Text>
              </View>
              <Ionicons name="play-circle-outline" size={24} color={palette.blue} />
            </Pressable>
          ))}
        </View>
      )}
      <TextInput
        accessibilityLabel="Search library"
        value={query}
        onChangeText={setQuery}
        placeholder="Search your library"
        placeholderTextColor={palette.muted}
        style={s.input}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={[s.row, { flexWrap: 'nowrap' }]}>
          {filters.map((option) => (
            <LibraryChip
              key={option}
              label={option}
              selected={filter === option}
              onPress={() => setFilter(option)}
            />
          ))}
        </View>
      </ScrollView>
      <View style={s.row}>
        <Text style={s.small}>Sort by</Text>
        {(['Recent', 'A–Z', 'Author'] as const).map((option) => (
          <LibraryChip
            key={option}
            label={option}
            selected={sort === option}
            onPress={() => setSort(option)}
          />
        ))}
      </View>
      {visible.map((novel) => (
        <Pressable
          key={novel.id}
          accessibilityRole="button"
          onPress={() => onOpen(novel)}
          style={s.libraryRow}
        >
          <View style={{ width: 62 }}>{cover(novel)}</View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.bookTitle} numberOfLines={2}>
              {novel.title}
            </Text>
            <Text style={s.small} numberOfLines={1}>
              {novel.author}
            </Text>
            <Text style={s.small}>
              {progress[novel.id]?.title || (entries[libraryKey(novel)]?.shelf ?? 'Want to read')}
            </Text>
            {!!downloads[novel.id]?.length && (
              <Text style={s.gold}>{downloads[novel.id].length} saved offline</Text>
            )}
          </View>
          {entries[libraryKey(novel)]?.favorite && (
            <Ionicons name="heart" size={17} color={palette.blue} />
          )}
        </Pressable>
      ))}
      {!visible.length && (
        <Text style={[s.body, { marginTop: 18 }]}>
          {novels.length
            ? 'No books match this view.'
            : 'Open a novel in Discover to add it to your library.'}
        </Text>
      )}
    </>
  );
}
