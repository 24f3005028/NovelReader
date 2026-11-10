import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { s } from './src/theme';
import { router, useLocalSearchParams } from 'expo-router';
import {
  clearDownloadQueue,
  deleteSavedChapters,
  loadDownloads,
  pauseDownloads,
  startDownloads,
  useDownloads,
} from './src/downloads';
import type {
  Chapter,
  ChapterContent,
  Novel,
  NovelDetail,
  DiscoveryFeed,
  RatingSummary,
  RedditDiscussion,
} from '@novelreader/shared';
import { deduplicateNovels, normalizeNovelTitle } from '@novelreader/shared';
import { api, readerMessage } from './src/api';
import { fetchChapterOnDemand } from './src/chapter-service';
import { DiscoveryShelves, RatingPanel, DiscussionPanel } from './src/components/Community';
import { ChapterPicker, DownloadRange } from './src/components/ChapterTools';
import { NovelAction, NovelHeader } from './src/components/NovelHeader';
import {
  defaults,
  localChapter,
  presets,
  read,
  ReaderSettings,
  saveDetail,
  write,
} from './src/storage';

type Tab = 'Discover' | 'Library' | 'Downloads' | 'Settings';
const colors = ['#122747', '#1b2444', '#102c3b', '#23213f', '#112940'];
const demoCovers: Record<string, number> = {
  'the-last-starkeeper': require('./assets/covers/starkeeper.png'),
  'a-teahouse-between-worlds': require('./assets/covers/teahouse.png'),
  'ink-and-thunder': require('./assets/covers/ink.png'),
};
const message = readerMessage;
function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && { opacity: 0.4 }]}
    >
      <Text style={[s.buttonText, secondary && { color: '#bfd8ff' }]}>{label}</Text>
    </Pressable>
  );
}
function Cover({ novel, large = false }: { novel: Novel; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <View
      style={[
        s.cover,
        { backgroundColor: colors[novel.title.length % colors.length] },
        large && { width: 108, height: 152 },
      ]}
    >
      {(novel.cover || demoCovers[novel.id]) && !failed ? (
        <Image
          source={demoCovers[novel.id] || { uri: novel.cover }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <Text style={s.coverMark}>N / R</Text>
          <Text style={s.coverTitle}>{novel.title}</Text>
          <View style={s.coverLine} />
          <Text style={s.coverAuthor}>{novel.author}</Text>
        </>
      )}
    </View>
  );
}

function Main() {
  const params = useLocalSearchParams<{ section: string; novel?: string; chapter?: string }>();
  const tabs: Tab[] = ['Discover', 'Library', 'Downloads', 'Settings'];
  const tab = tabs.find((t) => t.toLowerCase() === params.section) || 'Discover';
  function setTab(next: Tab) {
    router.replace({ pathname: '/[section]', params: { section: next.toLowerCase() } });
  }
  function closeDetail() {
    chapterRequest.current++;
    setChapterLoading('');
    setBusy(false);
    setRetryChapter(null);
    setDetail(null);
    setChapter(null);
    router.setParams({ novel: undefined, chapter: undefined });
  }
  const [ready, setReady] = useState(false);
  const [readerId, setReaderId] = useState('');
  const [feed, setFeed] = useState<DiscoveryFeed>({
    top10: [],
    reddit: [],
    forYou: [],
    redditMode: 'curated',
  });
  const [rating, setRating] = useState<RatingSummary>({
    average: null,
    count: 0,
    userRating: null,
  });
  const [discussions, setDiscussions] = useState<RedditDiscussion[]>([]);
  const [novels, setNovels] = useState<Novel[]>([]),
    [library, setLibrary] = useState<Novel[]>([]),
    [query, setQuery] = useState('');
  const [genre, setGenre] = useState('All');
  const featured = novels.find((n) => n.id === 'the-last-starkeeper') || novels[0];
  const [detail, setDetail] = useState<NovelDetail | null>(null),
    [chapter, setChapter] = useState<ChapterContent | null>(null);
  const [chapterLoading, setChapterLoading] = useState('');
  const [chapterPicker, setChapterPicker] = useState(false);
  const [rangePicker, setRangePicker] = useState(false);
  const [readingPercent, setReadingPercent] = useState(0);
  const [retryChapter, setRetryChapter] = useState<Chapter | null>(null);
  const [chapterQuery, setChapterQuery] = useState('');
  const [detailTab, setDetailTab] = useState<'Chapters' | 'About' | 'Community'>('Chapters');
  const [chapterLimit, setChapterLimit] = useState(60);
  const chapterRequest = useRef(0);
  const [settings, setSettings] = useState<ReaderSettings>(defaults),
    [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [total, setTotal] = useState(0);
  const {
    saved: downloads,
    progress: downloadState,
    queue: remainingDownload,
    message: downloadMessage,
  } = useDownloads();
  const savedIds = detail ? downloads[detail.novel.id] || [] : [];
  const availableChapters =
    detail?.chapters.filter((c) => tab !== 'Downloads' || savedIds.includes(c.id)) || [];
  const chapterMatches = availableChapters.filter((c) =>
    `${c.ordinal} ${c.number ?? ''} ${c.title}`
      .toLowerCase()
      .includes(chapterQuery.trim().toLowerCase()),
  );
  const [progress, setProgress] = useState<
    Record<string, { chapterId: string; offset: number; title: string }>
  >({});
  const continuing = library.find((n) => progress[n.id]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null),
    offset = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const [lib, opts, { saved: dl }, prog, marks, cached] = await Promise.all([
          read<Novel[]>('library', []),
          read('settings', defaults),
          loadDownloads(),
          read<typeof progress>('progress', {}),
          read<string[]>('bookmarks', []),
          read<Novel[]>('catalog', []),
        ]);
        const preferred = new Map<string, Novel>();
        for (const novel of lib) {
          const key = novel.catalogKey || normalizeNovelTitle(novel.title);
          const old = preferred.get(key);
          const score = (n: Novel) => (dl[n.id]?.length ? 2 : 0) + (prog[n.id] ? 1 : 0);
          if (!old || score(novel) > score(old)) preferred.set(key, novel);
        }
        const cleaned = [...preferred.values()];
        setLibrary(cleaned);
        if (cleaned.length !== lib.length) await write('library', cleaned);
        setSettings(opts.background === '#111820' ? { ...opts, ...presets.night } : opts);
        setProgress(prog);
        setBookmarks(marks);
        setNovels(deduplicateNovels(cached));
        let identity = await read('readerId', '');
        if (!identity) {
          identity = `reader_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
          await write('readerId', identity);
        }
        setReaderId(identity);
      } catch (e) {
        setError(message(e));
      } finally {
        setReady(true);
      }
    })();
  }, []);
  const loadFirstPage = useEffectEvent(() => void loadNovels(1));
  const refreshFeed = useEffectEvent(() => void loadFeed());
  const communityNovelId = detail?.novel.id;
  useEffect(() => {
    if (ready) refreshFeed();
  }, [ready]);
  useEffect(() => {
    if (!communityNovelId || !readerId) return;
    let active = true;
    const id = communityNovelId;
    void Promise.allSettled([
      api<RatingSummary>(`/novels/${id}/ratings?readerId=${encodeURIComponent(readerId)}`),
      api<RedditDiscussion[]>(`/novels/${id}/discussions`),
    ]).then((results) => {
      if (!active) return;
      if (results[0].status === 'fulfilled') setRating(results[0].value);
      if (results[1].status === 'fulfilled') setDiscussions(results[1].value);
    });
    return () => {
      active = false;
    };
  }, [communityNovelId, readerId]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(loadFirstPage, 300);
    return () => clearTimeout(timer);
  }, [ready, query, genre]);
  useEffect(() => {
    if (!ready) return;
    if (!params.novel) {
      setDetail(null);
      setChapter(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        let d =
          detail?.novel.id === params.novel
            ? detail
            : await read<NovelDetail | null>(`novel:${params.novel}`, null);
        if (!d) d = await api<NovelDetail>(`/novels/${params.novel}`);
        if (!active) return;
        setDetail(d);
        await saveDetail(d);
        if (params.chapter && chapter?.id !== params.chapter) {
          const c =
            (await localChapter(params.chapter)) ||
            (await fetchChapterOnDemand(params.chapter, () => !active));
          if (active) {
            offset.current =
              progress[c.novelId]?.chapterId === c.id ? progress[c.novelId].offset : 0;
            setChapter(c);
          }
        } else if (!params.chapter) setChapter(null);
      } catch (e) {
        if (active) setError(message(e));
      }
    })();
    return () => {
      active = false;
    };
    // Route changes hydrate from local storage; in-flight imports update detail separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, params.novel, params.chapter]);
  useEffect(() => {
    if (!detail?.job || !['queued', 'running'].includes(detail.job.status)) return;
    const timer = setInterval(() => void refreshDetail(detail.novel.id), 1500);
    return () => clearInterval(timer);
  }, [detail?.novel.id, detail?.job]);
  const onHardwareBack = useEffectEvent(() => {
    if (showSettings) {
      setShowSettings(false);
      return true;
    }
    if (chapter) {
      closeChapter();
      return true;
    }
    if (detail) {
      closeDetail();
      return true;
    }
    return false;
  });
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => subscription.remove();
  }, []);
  async function loadNovels(next: number) {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ items: Novel[]; total: number; hasMore: boolean }>(
        `/novels?q=${encodeURIComponent(query)}&genre=${encodeURIComponent(genre === 'All' ? '' : genre)}&page=${next}`,
      );
      setNovels((old) => deduplicateNovels(next === 1 ? data.items : [...old, ...data.items]));
      setPage(next);
      setTotal(data.total);
      setHasMore(data.hasMore);
      if (next === 1 && !query && genre === 'All') await write('catalog', data.items);
    } catch (e) {
      setError(`${message(e)} · Saved books remain available offline.`);
    } finally {
      setBusy(false);
    }
  }
  async function loadFeed() {
    try {
      const genres = [...new Set(library.flatMap((n) => n.genres))].slice(0, 8).join(',');
      const data = await api<DiscoveryFeed>(`/discover?genres=${encodeURIComponent(genres)}`);
      setFeed(data);
      await write('discover', data);
    } catch {
      setFeed(
        await read<DiscoveryFeed>('discover', {
          top10: [],
          reddit: [],
          forYou: [],
          redditMode: 'curated',
        }),
      );
    }
  }
  async function rateNovel(value: number) {
    if (!detail || !readerId) return;
    try {
      const result = await api<RatingSummary>(`/novels/${detail.novel.id}/rating`, 'PUT', {
        readerId,
        value,
      });
      setRating(result);
      setDetail((d) =>
        d
          ? {
              ...d,
              novel: { ...d.novel, ratingAverage: result.average, ratingCount: result.count },
            }
          : d,
      );
      setNotice('Your rating was saved.');
      void loadFeed();
    } catch (e) {
      setError(message(e));
    }
  }
  async function keepNovel(n: Novel) {
    setLibrary((old) => {
      const next = deduplicateNovels([
        n,
        ...old.filter((x) => normalizeNovelTitle(x.title) !== normalizeNovelTitle(n.title)),
      ]);
      void write('library', next);
      return next;
    });
  }
  async function refreshDetail(id: string) {
    try {
      const d = await api<NovelDetail>(`/novels/${id}`);
      setDetail((current) => (current?.novel.id === id ? d : current));
      await saveDetail(d);
    } catch {}
  }
  async function openNovel(n: Novel) {
    setRetryChapter(null);
    setDetailTab('Chapters');
    setRating({ average: null, count: 0, userRating: null });
    setDiscussions([]);
    const previous = library.find(
      (book) => normalizeNovelTitle(book.title) === normalizeNovelTitle(n.title),
    );
    if (previous && (downloads[previous.id]?.length || progress[previous.id])) n = previous;
    setChapterQuery('');
    setChapterLimit(60);
    setError('');
    setBusy(true);
    setChapter(null);
    try {
      let d: NovelDetail;
      const saved = await read<NovelDetail | null>(`novel:${n.id}`, null);
      try {
        d = tab === 'Downloads' && saved ? saved : await api<NovelDetail>(`/novels/${n.id}`);
        await saveDetail(d);
      } catch (e) {
        const cached = await read<NovelDetail | null>(`novel:${n.id}`, null);
        if (!cached) throw e;
        d = cached;
      }
      setDetail(d);
      if (readerId)
        void api('/activity', 'POST', { novelId: d.novel.id, readerId, action: 'open' }).catch(
          () => {},
        );
      router.setParams({ novel: n.id, chapter: undefined });
      await keepNovel(d.novel);
      if (tab !== 'Downloads' && n.source !== 'demo' && (!d.job || d.job.status === 'cancelled'))
        await startImport(n.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function startImport(id: string) {
    try {
      const job = await api<NonNullable<NovelDetail['job']>>(`/novels/${id}/import`, 'POST', {
        mode: 'index',
      });
      setDetail((d) => (d?.novel.id === id ? { ...d, job } : d));
    } catch (e) {
      setError(message(e));
    }
  }
  async function openChapter(c: Chapter) {
    if (chapter?.id === c.id || chapterLoading) return;
    saveProgress();
    const request = ++chapterRequest.current;
    setRetryChapter(null);
    setChapterLoading(c.title);
    setBusy(true);
    setError('');
    try {
      const local = await localChapter(c.id);
      const value =
        local || (await fetchChapterOnDemand(c.id, () => request !== chapterRequest.current));
      if (request !== chapterRequest.current) return;
      const position = progress[c.novelId];
      offset.current = position?.chapterId === c.id ? position.offset : 0;
      setReadingPercent(0);
      setChapter(value);
      if (readerId)
        void api('/activity', 'POST', { novelId: c.novelId, readerId, action: 'read' }).catch(
          () => {},
        );
      router.setParams({ novel: c.novelId, chapter: c.id });
    } catch (e) {
      if (request === chapterRequest.current) {
        setRetryChapter(c);
        setError(message(e, 'Couldn’t open this chapter. Please try again.'));
      }
    } finally {
      if (request === chapterRequest.current) {
        setChapterLoading('');
        setBusy(false);
      }
    }
  }
  function saveProgress() {
    if (!chapter) return;
    const next = {
      ...progress,
      [chapter.novelId]: { chapterId: chapter.id, offset: offset.current, title: chapter.title },
    };
    setProgress(next);
    void write('progress', next);
  }
  function closeChapter() {
    saveProgress();
    chapterRequest.current++;
    setChapterLoading('');
    setBusy(false);
    setRetryChapter(null);
    setError('');
    setChapter(null);
    router.setParams({ chapter: undefined });
  }
  function changeSettings(patch: Partial<ReaderSettings>) {
    setSettings((old) => {
      const next = { ...old, ...patch };
      void write('settings', next);
      return next;
    });
  }
  async function downloadChapters(chapters: Chapter[]) {
    if (!detail) return;
    setError('');
    try {
      await startDownloads({
        novelId: detail.novel.id,
        title: detail.novel.title,
        ids: chapters.map((chapter) => chapter.id),
      });
    } catch (error) {
      setError(message(error, 'Couldn’t prepare the download. Please try again.'));
    }
  }
  async function deleteDownloads(n: Novel) {
    try {
      await deleteSavedChapters(n.id);
    } catch (error) {
      setError(message(error, 'Couldn’t remove the downloads. Please try again.'));
    }
  }
  const readerText = {
    color: settings.text,
    fontSize: settings.size,
    lineHeight: settings.size * settings.lineHeight,
    fontFamily:
      settings.font === 'serif'
        ? Platform.OS === 'ios'
          ? 'Georgia'
          : Platform.OS === 'android'
            ? 'serif'
            : 'Georgia'
        : undefined,
    textAlign: settings.align,
  };
  function settingsPanel() {
    return (
      <>
        <Text style={s.section}>MAKE IT YOURS</Text>
        <Text style={s.heading}>Reading preferences</Text>
        <Text style={s.muted}>Saved on this device. Available offline.</Text>
        <Text style={s.label}>Font size · {settings.size}px</Text>
        <View style={s.row}>
          <Button
            label="A −"
            secondary
            onPress={() => changeSettings({ size: Math.max(12, settings.size - 1) })}
          />
          <Button
            label="A +"
            secondary
            onPress={() => changeSettings({ size: Math.min(36, settings.size + 1) })}
          />
        </View>
        <Text style={s.label}>Line spacing · {settings.lineHeight.toFixed(1)}</Text>
        <View style={s.row}>
          {[1.4, 1.6, 1.8, 2, 2.2].map((v) => (
            <Button
              key={v}
              label={String(v)}
              secondary={settings.lineHeight !== v}
              onPress={() => changeSettings({ lineHeight: v })}
            />
          ))}
        </View>
        <Text style={s.label}>Typeface & alignment</Text>
        <View style={s.row}>
          <Button
            label="Serif"
            secondary={settings.font !== 'serif'}
            onPress={() => changeSettings({ font: 'serif' })}
          />
          <Button
            label="Sans"
            secondary={settings.font !== 'sans'}
            onPress={() => changeSettings({ font: 'sans' })}
          />
          <Button
            label={settings.align === 'left' ? 'Align left' : 'Justified'}
            secondary
            onPress={() =>
              changeSettings({ align: settings.align === 'left' ? 'justify' : 'left' })
            }
          />
        </View>
        <Text style={s.label}>Reading theme</Text>
        <View style={s.row}>
          {(['night', 'paper', 'sepia'] as const).map((theme) => (
            <Button
              key={theme}
              label={theme}
              secondary={theme !== settings.theme}
              onPress={() => changeSettings({ theme, ...presets[theme] })}
            />
          ))}
        </View>
        <Text style={s.label}>Background colour</Text>
        <View style={s.row}>
          {['#05070b', '#faf8f3', '#eee1c7', '#18271e', '#242034', '#000000'].map((color) => (
            <Pressable
              key={color}
              accessibilityLabel={`Background ${color}`}
              onPress={() => changeSettings({ background: color })}
              style={[
                s.swatch,
                {
                  backgroundColor: color,
                  borderColor: settings.background === color ? '#168bff' : '#59616b',
                },
              ]}
            />
          ))}
        </View>
        <Text style={s.label}>Text colour</Text>
        <View style={s.row}>
          {['#e5dfd3', '#292b30', '#4d3e30', '#b7cbb5', '#ffffff', '#cab8e4'].map((color) => (
            <Pressable
              key={color}
              accessibilityLabel={`Text ${color}`}
              onPress={() => changeSettings({ text: color })}
              style={[
                s.swatch,
                {
                  backgroundColor: color,
                  borderColor: settings.text === color ? '#168bff' : '#59616b',
                },
              ]}
            />
          ))}
        </View>
        <View
          style={{
            backgroundColor: settings.background,
            padding: 22,
            borderRadius: 14,
            marginVertical: 20,
          }}
        >
          <Text style={readerText}>The world is quiet here. Just one more chapter.</Text>
        </View>
        <Button label="Reset preferences" secondary onPress={() => changeSettings(defaults)} />
      </>
    );
  }
  if (!ready)
    return (
      <View style={s.loading}>
        <ActivityIndicator color="#168bff" />
      </View>
    );
  if (chapter) {
    const index = availableChapters.findIndex((c) => c.id === chapter.id);
    const previous = index > 0 ? availableChapters[index - 1] : undefined;
    const next = index >= 0 ? availableChapters[index + 1] : undefined;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: settings.background }}>
        <StatusBar style={settings.theme === 'night' ? 'light' : 'dark'} />
        <View style={s.readerTop}>
          <Pressable accessibilityLabel="Back to chapters" onPress={closeChapter}>
            <Text style={{ color: settings.text, fontSize: 24 }}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open chapter list"
            onPress={() => setChapterPicker(true)}
            style={{ flex: 1, marginHorizontal: 16, minHeight: 44, justifyContent: 'center' }}
          >
            <Text numberOfLines={1} style={{ color: settings.text, fontWeight: '700' }}>
              {chapterLoading
                ? 'Loading chapter…'
                : `Chapter ${chapter.number ?? chapter.ordinal} ▾`}
            </Text>
            <Text style={{ color: settings.text, opacity: 0.65, fontSize: 12 }}>
              {readingPercent}% read
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Bookmark chapter"
            onPress={() => {
              const next = bookmarks.includes(chapter.id)
                ? bookmarks.filter((id) => id !== chapter.id)
                : [...bookmarks, chapter.id];
              setBookmarks(next);
              void write('bookmarks', next);
            }}
          >
            <Text style={{ color: settings.text, fontSize: 21 }}>
              {bookmarks.includes(chapter.id) ? '★' : '☆'}
            </Text>
          </Pressable>
          <Pressable accessibilityLabel="Reading preferences" onPress={() => setShowSettings(true)}>
            <Text style={{ color: settings.text, fontSize: 21, marginLeft: 22 }}>Aa</Text>
          </Pressable>
        </View>
        <View style={s.readerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous chapter"
            disabled={!previous || !!chapterLoading}
            onPress={() => previous && void openChapter(previous)}
          >
            <Text style={{ color: settings.text, opacity: previous && !chapterLoading ? 1 : 0.35 }}>
              ‹ Previous
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save current chapter offline"
            disabled={savedIds.includes(chapter.id) || !!downloadState}
            onPress={() => void downloadChapters([chapter])}
          >
            <Text style={{ color: settings.text }}>
              {savedIds.includes(chapter.id) ? '✓ Saved' : '↓ Save'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next chapter"
            disabled={!next || !!chapterLoading}
            onPress={() => next && void openChapter(next)}
          >
            <Text
              style={{
                color: settings.text,
                opacity: next && !chapterLoading ? 1 : 0.35,
                fontWeight: '700',
              }}
            >
              Next ›
            </Text>
          </Pressable>
        </View>
        <View style={[s.track, { height: 2 }]}>
          <View style={[s.fill, { width: `${readingPercent}%` }]} />
        </View>
        <ScrollView
          key={chapter.id}
          ref={scroll}
          contentContainerStyle={s.reading}
          onContentSizeChange={() =>
            scroll.current?.scrollTo({ y: offset.current, animated: false })
          }
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            offset.current = Math.max(0, contentOffset.y);
            const length = contentSize.height - layoutMeasurement.height;
            setReadingPercent(
              length > 0 ? Math.min(100, Math.round((100 * offset.current) / length)) : 100,
            );
          }}
          scrollEventThrottle={200}
          onScrollEndDrag={saveProgress}
          onMomentumScrollEnd={saveProgress}
        >
          <Text
            style={[
              readerText,
              {
                fontSize: settings.size + 12,
                lineHeight: (settings.size + 12) * 1.4,
                marginBottom: 28,
              },
            ]}
          >
            {chapter.title}
          </Text>
          {chapter.paragraphs.map((p, i) => (
            <Text selectable key={i} style={[readerText, { marginBottom: settings.size }]}>
              {p}
            </Text>
          ))}
          <View style={s.row}>
            <Button
              label="← Previous"
              secondary
              disabled={!previous || !!chapterLoading}
              onPress={() => previous && void openChapter(previous)}
            />
            <Button
              label="Next chapter →"
              disabled={!next || !!chapterLoading}
              onPress={() => next && void openChapter(next)}
            />
          </View>
        </ScrollView>
        {!!error && (
          <View style={s.readerActions}>
            <Text style={[s.error, { flex: 1 }]}>{error}</Text>
            {retryChapter && (
              <Button label="Try again" secondary onPress={() => void openChapter(retryChapter)} />
            )}
          </View>
        )}
        {!!downloadState && (
          <View style={s.readerActions}>
            <Text style={s.gold}>{downloadState}</Text>
            <Button label="Pause" secondary onPress={pauseDownloads} />
          </View>
        )}
        {!downloadState && !!downloadMessage && <Text style={s.notice}>{downloadMessage}</Text>}
        {chapterPicker && (
          <ChapterPicker
            chapters={availableChapters}
            currentId={chapter.id}
            savedIds={savedIds}
            bookmarks={bookmarks}
            close={() => setChapterPicker(false)}
            open={(chosen) => {
              setChapterPicker(false);
              void openChapter(chosen);
            }}
          />
        )}
        <Modal
          visible={showSettings}
          animationType="slide"
          onRequestClose={() => setShowSettings(false)}
        >
          <SafeAreaView style={s.container}>
            <ScrollView contentContainerStyle={s.content}>
              <Button label="Done" onPress={() => setShowSettings(false)} />
              {settingsPanel()}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="light" />
      {rangePicker && !!detail?.chapters.length && (
        <DownloadRange
          chapters={detail.chapters}
          savedIds={savedIds}
          currentId={progress[detail.novel.id]?.chapterId}
          close={() => setRangePicker(false)}
          download={(selection) => {
            setRangePicker(false);
            void downloadChapters(selection);
          }}
        />
      )}
      {detail ? (
        <View style={s.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Back to ${tab}`}
            onPress={closeDetail}
            style={s.detailIconButton}
          >
            <Ionicons name="chevron-back" size={24} color="#d9e8ff" />
          </Pressable>
          <Text
            numberOfLines={1}
            style={[s.body, { flex: 1, marginHorizontal: 12, fontWeight: '700' }]}
          >
            {detail.novel.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Downloads"
            onPress={() => setTab('Downloads')}
            style={s.detailIconButton}
          >
            <Ionicons name="cloud-download-outline" size={22} color="#8ac8ff" />
          </Pressable>
        </View>
      ) : (
        <View style={s.top}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image
              source={require('./assets/brand/magic-book.png')}
              style={{ width: 42, height: 42, borderRadius: 12 }}
              accessibilityLabel="NovelReader magical book logo"
            />
            <View>
              <Text style={s.brand}>
                Novel<Text style={{ color: '#168bff' }}>Reader</Text>
              </Text>
              <Text style={s.tagline}>A universe in every chapter</Text>
            </View>
          </View>
          <Pressable
            accessibilityLabel="Open your library"
            onPress={() => setTab('Library')}
            style={s.avatar}
          >
            <Ionicons name="bookmark-outline" size={20} color="#d9e8ff" />
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {!!error && (
          <Pressable onPress={() => setError('')}>
            <Text style={s.error}>{error} ×</Text>
          </Pressable>
        )}
        {!!notice && (
          <Pressable onPress={() => setNotice('')}>
            <Text style={s.notice}>{notice} ×</Text>
          </Pressable>
        )}
        {!!downloadMessage && (detail || tab === 'Downloads') && (
          <Text style={s.notice}>{downloadMessage}</Text>
        )}
        {busy && <ActivityIndicator color="#168bff" style={{ margin: 10 }} />}
        {!!chapterLoading && (
          <Text style={s.notice}>
            Fetching {chapterLoading}… It will be cached for your next read.
          </Text>
        )}
        {detail ? (
          <>
            <NovelHeader
              novel={detail.novel}
              cover={<Cover novel={detail.novel} large />}
              count={detail.chapters.length}
              saved={savedIds.length}
              rating={rating.average ?? detail.novel.communityRating}
            >
              <NovelAction
                icon="book-outline"
                primary
                label={progress[detail.novel.id] ? 'Continue reading' : 'Start reading'}
                disabled={!availableChapters.length || !!chapterLoading}
                onPress={() => {
                  const chosen =
                    availableChapters.find(
                      (item) => item.id === progress[detail.novel.id]?.chapterId,
                    ) || availableChapters[0];
                  if (chosen) void openChapter(chosen);
                }}
              />
              {tab !== 'Downloads' && (
                <NovelAction
                  icon="download-outline"
                  label="Download range"
                  disabled={!detail.chapters.length || !!downloadState}
                  onPress={() => setRangePicker(true)}
                />
              )}
            </NovelHeader>
            {!!downloadState && (
              <View style={s.panel}>
                <View style={s.row}>
                  <Ionicons name="cloud-download-outline" size={20} color="#60b5ff" />
                  <Text style={s.gold}>{downloadState}</Text>
                </View>
                <NovelAction icon="pause-outline" label="Pause download" onPress={pauseDownloads} />
              </View>
            )}
            {!downloadState && remainingDownload?.novelId === detail.novel.id && (
              <NovelAction
                icon="play-outline"
                label={`Resume download (${remainingDownload.ids.length} left)`}
                onPress={() =>
                  void startDownloads(remainingDownload).catch((error) => setError(message(error)))
                }
              />
            )}
            {retryChapter && !chapterLoading && (
              <NovelAction
                icon="refresh-outline"
                label="Retry chapter"
                onPress={() => void openChapter(retryChapter)}
              />
            )}
            <View style={s.detailTabs} accessibilityRole="tablist">
              {(
                [
                  ['Chapters', 'list-outline'],
                  ['About', 'information-circle-outline'],
                  ['Community', 'chatbubbles-outline'],
                ] as const
              ).map(([label, icon]) => (
                <Pressable
                  key={label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: detailTab === label }}
                  onPress={() => setDetailTab(label)}
                  style={[s.detailTab, detailTab === label && s.detailTabActive]}
                >
                  <Ionicons
                    name={icon}
                    size={18}
                    color={detailTab === label ? '#6dbbff' : '#8998af'}
                  />
                  <Text style={detailTab === label ? s.link : s.small}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {detailTab === 'About' && (
              <View style={s.panel}>
                <Text style={s.heading}>Synopsis</Text>
                <Text style={s.body}>
                  {detail.novel.description || 'A synopsis is unavailable for this story.'}
                </Text>
                {!!detail.novel.genres.length && (
                  <View style={s.row}>
                    {detail.novel.genres.map((genre) => (
                      <Text style={s.genreTag} key={genre}>
                        {genre}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}
            {detailTab === 'Community' && (
              <>
                <RatingPanel
                  novel={detail.novel}
                  rating={rating}
                  onRate={(value) => void rateNovel(value)}
                />
                <DiscussionPanel threads={discussions} />
              </>
            )}
            {detailTab === 'Chapters' && (
              <>
                <View style={[s.row, { justifyContent: 'space-between', marginBottom: 12 }]}>
                  <Text style={s.heading}>
                    {tab === 'Downloads' ? 'Saved chapters' : 'Chapter list'}
                  </Text>
                  {tab !== 'Downloads' && detail.novel.source !== 'demo' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Refresh chapter list"
                      style={s.detailIconButton}
                      onPress={() => void startImport(detail.novel.id)}
                    >
                      <Ionicons name="refresh-outline" size={21} color="#60b5ff" />
                    </Pressable>
                  )}
                </View>
                {tab !== 'Downloads' &&
                  detail.job &&
                  ['queued', 'running', 'failed'].includes(detail.job.status) && (
                    <View style={s.panel}>
                      <View style={s.row}>
                        <Ionicons
                          name={
                            detail.job.status === 'failed' ? 'alert-circle-outline' : 'time-outline'
                          }
                          size={20}
                          color="#60b5ff"
                        />
                        <Text style={[s.body, { flex: 1 }]}>
                          {detail.job.status === 'failed'
                            ? 'Couldn’t update the chapter list. Tap refresh to retry.'
                            : `Updating chapter list${detail.job.total ? ` · ${detail.job.completed} / ${detail.job.total}` : '…'}`}
                        </Text>
                      </View>
                      {detail.job.status !== 'failed' && (
                        <View style={s.track}>
                          <View
                            style={[
                              s.fill,
                              {
                                width: `${detail.job.total ? Math.min(100, (100 * detail.job.completed) / detail.job.total) : 0}%`,
                              },
                            ]}
                          />
                        </View>
                      )}
                    </View>
                  )}
                <View style={s.search}>
                  <Ionicons name="search-outline" size={19} color="#8093ae" />
                  <TextInput
                    style={s.searchInput}
                    value={chapterQuery}
                    accessibilityLabel="Search chapter list"
                    placeholder="Chapter number or title"
                    placeholderTextColor="#8093ae"
                    onChangeText={(text) => {
                      setChapterQuery(text);
                      setChapterLimit(60);
                    }}
                  />
                </View>
                {chapterMatches.slice(0, chapterLimit).map((chapter) => {
                  const saved = savedIds.includes(chapter.id);
                  const marked = bookmarks.includes(chapter.id);
                  const current = progress[detail.novel.id]?.chapterId === chapter.id;
                  return (
                    <View key={chapter.id} style={[s.chapterRow, current && s.currentChapterRow]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Read ${chapter.title}`}
                        disabled={!!chapterLoading}
                        onPress={() => void openChapter(chapter)}
                        style={s.chapterLink}
                      >
                        <Text style={s.chapterNumber}>{chapter.number ?? chapter.ordinal}</Text>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={s.body} numberOfLines={2}>
                            {chapter.title}
                          </Text>
                          {current && <Text style={s.small}>Last read</Text>}
                        </View>
                        {marked && <Ionicons name="bookmark" size={16} color="#60b5ff" />}
                      </Pressable>
                      {saved ? (
                        <View accessibilityLabel="Available offline" style={s.detailIconButton}>
                          <Ionicons name="checkmark-circle" size={20} color="#60b5ff" />
                        </View>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Download ${chapter.title}`}
                          style={s.detailIconButton}
                          disabled={!!downloadState}
                          onPress={() => void downloadChapters([chapter])}
                        >
                          <Ionicons name="download-outline" size={20} color="#60b5ff" />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
                {!chapterMatches.length && !!chapterQuery && (
                  <Text style={s.muted}>No chapters match your search.</Text>
                )}
                {chapterMatches.length > chapterLimit && (
                  <Button
                    label={`Show more chapters (${chapterLimit} / ${chapterMatches.length})`}
                    secondary
                    onPress={() => setChapterLimit((count) => count + 60)}
                  />
                )}
              </>
            )}
          </>
        ) : tab === 'Discover' ? (
          <>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <View>
                <Text style={s.hero}>Discover</Text>
                <Text style={s.muted}>Your next obsession starts here.</Text>
              </View>
              <View style={s.liveBadge}>
                <View style={s.liveDot} />
                <Text style={s.liveText}>EXPLORE</Text>
              </View>
            </View>
            <View style={s.search}>
              <Ionicons name="search-outline" size={20} color="#72849e" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search titles, authors, genres…"
                placeholderTextColor="#777e89"
                style={s.searchInput}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 20 }}
            >
              <View style={[s.row, { flexWrap: 'nowrap', gap: 8 }]}>
                {['All', 'Fantasy', 'Adventure', 'Slice of life'].map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityLabel={`Genre ${item}`}
                    onPress={() => setGenre(item)}
                    style={[s.genreChip, genre === item && s.genreActive]}
                  >
                    <Text
                      style={{
                        color: genre === item ? '#74bcff' : '#8591a5',
                        fontSize: 12,
                        fontWeight: '600',
                      }}
                    >
                      {item === 'All' ? 'For you' : item}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            {!query && genre === 'All' && featured && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Read featured novel ${featured.title}`}
                onPress={() => void openNovel(featured)}
                style={s.feature}
              >
                <LinearGradient
                  colors={['#102950', '#071326', '#070c16']}
                  start={{ x: 1, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <View style={s.featureOrb} />
                <View style={s.featureCover}>
                  <Cover novel={featured} large />
                </View>
                <View style={s.featureCopy}>
                  <View style={s.featureBadge}>
                    <Ionicons name="sparkles" size={11} color="#5cb5ff" />
                    <Text style={s.featureEyebrow}>IN THE SPOTLIGHT</Text>
                  </View>
                  <Text style={s.featureTitle} numberOfLines={2}>
                    {featured.title}
                  </Text>
                  <Text style={s.featureDescription} numberOfLines={2}>
                    {featured.description}
                  </Text>
                  <View style={s.featureCta}>
                    <Text style={s.featureCtaText}>Start reading</Text>
                    <Ionicons name="arrow-forward" size={15} color="#fff" />
                  </View>
                </View>
                <View style={s.featureDots}>
                  <View style={s.featureDot} />
                  <View style={s.featureDotDim} />
                  <View style={s.featureDotDim} />
                </View>
              </Pressable>
            )}
            {!query && genre === 'All' && (
              <DiscoveryShelves
                feed={feed}
                onOpen={(n) => void openNovel(n)}
                renderCover={(n) => <Cover novel={n} />}
              />
            )}
            <View
              style={[s.row, { justifyContent: 'space-between', marginTop: 4, marginBottom: 12 }]}
            >
              <Text style={s.heading}>{query ? 'Search results' : 'Explore the collection'}</Text>
              <Pressable accessibilityLabel="Refresh novels" onPress={() => void loadNovels(1)}>
                <Ionicons name="refresh-outline" size={18} color="#168bff" />
              </Pressable>
            </View>

            <Text style={[s.small, { marginBottom: 14 }]}>
              {total} {total === 1 ? 'story' : 'stories'} to explore
            </Text>
            <View style={s.grid}>
              {novels.map((n) => (
                <Pressable key={n.id} style={s.bookCard} onPress={() => void openNovel(n)}>
                  <Cover novel={n} />
                  <Text style={s.bookTitle} numberOfLines={2}>
                    {n.title}
                  </Text>
                  <Text style={s.small}>
                    {n.genres[0] || (n.chapterCount ? `${n.chapterCount} chapters` : 'Light novel')}
                  </Text>
                </Pressable>
              ))}
            </View>
            {!novels.length && !busy && (
              <Text style={s.muted}>No stories found. Try another title or genre.</Text>
            )}
            {hasMore && (
              <Button
                label="Load more stories"
                secondary
                onPress={() => void loadNovels(page + 1)}
              />
            )}
            <Pressable onPress={() => setTab('Downloads')} style={s.offlineBanner}>
              <View style={s.offlineIcon}>
                <Ionicons name="cloud-download-outline" size={23} color="#168bff" />
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={{ color: '#eaf2ff', fontSize: 14, fontWeight: '600' }}>
                  Your stories. Anywhere.
                </Text>
                <Text style={s.small}>Download chapters for your next escape.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#168bff" />
            </Pressable>
          </>
        ) : tab === 'Library' ? (
          <>
            <Text style={s.section}>A COLLECTION OF YOUR OWN</Text>
            <Text style={s.hero}>Your library.</Text>
            <Text style={s.muted}>Every story you open finds a home here.</Text>
            {library.map((n) => (
              <Pressable key={n.id} onPress={() => void openNovel(n)} style={s.libraryRow}>
                <View style={{ width: 90 }}>
                  <Cover novel={n} />
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={s.heading}>{n.title}</Text>
                  <Text style={s.small}>
                    {progress[n.id]
                      ? `Continue · ${progress[n.id].title}`
                      : 'Ready for the first chapter'}
                  </Text>
                  <Text style={s.gold}>{downloads[n.id]?.length || 0} saved offline →</Text>
                </View>
              </Pressable>
            ))}
            {!library.length && (
              <Text style={s.body}>Open a story in Discover to add it to your library.</Text>
            )}
          </>
        ) : tab === 'Downloads' ? (
          <>
            <Text style={s.section}>TAKE YOUR STORIES WITH YOU</Text>
            <Text style={s.hero}>Offline shelf.</Text>
            <Text style={s.muted}>
              {Object.values(downloads).reduce((n, ids) => n + ids.length, 0)} chapters saved on
              this device
            </Text>
            {downloadState && (
              <View style={s.panel}>
                <Text style={s.gold}>{downloadState}</Text>
                <Button label="Pause download" onPress={pauseDownloads} />
              </View>
            )}
            {!downloadState && remainingDownload && (
              <View style={s.panel}>
                <Text style={s.heading}>{remainingDownload.title}</Text>
                <Text style={s.muted}>{remainingDownload.ids.length} chapters left</Text>
                <View style={s.row}>
                  <Button
                    label="Resume"
                    onPress={() =>
                      void startDownloads(remainingDownload).catch((e) => setError(message(e)))
                    }
                  />
                  <Button
                    label="Clear queue"
                    secondary
                    onPress={() => void clearDownloadQueue().catch((e) => setError(message(e)))}
                  />
                </View>
              </View>
            )}
            {library
              .filter((n) => downloads[n.id]?.length)
              .map((n) => (
                <View key={n.id} style={s.panel}>
                  <Text style={s.heading}>{n.title}</Text>
                  <Text style={s.muted}>{downloads[n.id].length} chapters · Available offline</Text>
                  <View style={s.row}>
                    <Button label="Read" onPress={() => void openNovel(n)} />
                    <Button
                      label="Remove downloads"
                      secondary
                      onPress={() => void deleteDownloads(n)}
                    />
                  </View>
                </View>
              ))}
            {!Object.keys(downloads).length && (
              <View style={s.panel}>
                <Text style={s.heading}>Pack a story for later.</Text>
                <Text style={s.body}>
                  Open a novel and choose Download range, or save individual chapters.
                </Text>
              </View>
            )}
          </>
        ) : (
          <>
            {settingsPanel()}
            <Text style={[s.section, { marginTop: 32 }]}>YOUR READING SPACE</Text>
            <View style={s.panel}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.body}>Your library</Text>
                <Text style={s.gold}>{library.length} stories</Text>
              </View>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.body}>Saved offline</Text>
                <Text style={s.gold}>
                  {Object.values(downloads).reduce((sum, ids) => sum + ids.length, 0)} chapters
                </Text>
              </View>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.body}>Bookmarks</Text>
                <Text style={s.gold}>{bookmarks.length}</Text>
              </View>
              <Button label="Manage downloads" secondary onPress={() => setTab('Downloads')} />
            </View>
            <Text style={[s.small, { textAlign: 'center', marginTop: 16 }]}>
              NovelReader · Version 1.0.0
            </Text>
          </>
        )}
        <Text style={s.footer}>ANOTHER WORLD IS ONE CHAPTER AWAY</Text>
      </ScrollView>
      {!detail && continuing && (
        <Pressable style={s.continueDock} onPress={() => void openNovel(continuing)}>
          <Ionicons name="book-outline" size={22} color="#168bff" />
          <View style={{ flex: 1 }}>
            <Text style={s.dockEyebrow}>CONTINUE READING</Text>
            <Text numberOfLines={1} style={{ color: '#e9f2ff', fontSize: 12, fontWeight: '600' }}>
              {continuing.title}
            </Text>
          </View>
          <View style={s.dockPlay}>
            <Ionicons name="play" size={17} color="#fff" />
          </View>
        </Pressable>
      )}
      <View style={s.nav}>
        {(['Discover', 'Library', 'Downloads', 'Settings'] as Tab[]).map((name, i) => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === name && !detail }}
            onPress={() => {
              setTab(name);
              setDetail(null);
              setError('');
            }}
            style={s.navItem}
          >
            <View style={[s.navIcon, tab === name && s.navIconActive]}>
              <Ionicons
                name={
                  (
                    [
                      'compass-outline',
                      'library-outline',
                      'cloud-download-outline',
                      'options-outline',
                    ] as const
                  )[i]
                }
                size={22}
                color={tab === name ? '#329eff' : '#626f85'}
              />
            </View>
            <Text
              style={[
                s.small,
                {
                  color: tab === name ? '#329eff' : '#626f85',
                  fontSize: 10,
                  fontWeight: tab === name ? '700' : '500',
                },
              ]}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}
