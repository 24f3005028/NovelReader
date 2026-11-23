import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
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
  CatalogSort,
  ImportJob,
  Novel,
  NovelDetail,
  DiscoveryFeed,
  RatingSummary,
  RedditDiscussion,
} from '@novelreader/shared';
import { chapterBatchSize, deduplicateNovels, normalizeNovelTitle } from '@novelreader/shared';
import { api, readerMessage } from './src/api';
import { fetchChapterOnDemand, requestChapterBatch } from './src/chapter-service';
import { DiscoveryShelves, RatingPanel, DiscussionPanel } from './src/components/Community';
import { ChapterPicker, DownloadRange } from './src/components/ChapterTools';
import { NovelAction, NovelHeader } from './src/components/NovelHeader';
import { Characters } from './src/components/Characters';
import { ChapterReader } from './src/components/ChapterReader';
import {
  LibraryActions,
  LibraryBrowser,
  libraryKey,
  type LibraryEntry,
  type ReadingPosition,
  type ChapterNotes,
} from './src/components/Library';
import {
  defaults,
  localChapter,
  presets,
  read,
  readDetail,
  ReaderSettings,
  saveDetail,
  write,
} from './src/storage';

type Tab = 'Discover' | 'Library' | 'Downloads' | 'Settings';
const sortOptions: [CatalogSort, string][] = [
  ['default', 'Default'],
  ['chapters', 'Most chapters'],
  ['title', 'Title A–Z'],
];
function resumeChapter(chapters: Chapter[], position?: ReadingPosition) {
  const index = chapters.findIndex((item) => item.id === position?.chapterId);
  if (index < 0) return chapters[0];
  return (position?.completed && chapters[index + 1]) || chapters[index];
}

function FilterChip({
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
      <Text style={{ color: selected ? '#74bcff' : '#8591a5', fontSize: 12, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
const colors = ['#122747', '#1b2444', '#102c3b', '#23213f', '#112940'];
const demoCovers: Record<string, number> = {
  'the-last-starkeeper': require('./assets/covers/starkeeper.png'),
  'a-teahouse-between-worlds': require('./assets/covers/teahouse.png'),
  'ink-and-thunder': require('./assets/covers/ink.png'),
};
const message = readerMessage;
async function loadNovelDetail(id: string, preferOffline: boolean) {
  if (preferOffline) {
    const cached = await readDetail(id);
    if (cached) return cached;
  }
  try {
    const detail = await api<NovelDetail>(`/novels/${id}`);
    void saveDetail(detail).catch(() => {});
    return detail;
  } catch (error) {
    const cached = await readDetail(id);
    if (!cached) throw error;
    return cached;
  }
}
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
  const [genre, setGenre] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [sort, setSort] = useState<CatalogSort>('default');
  const [completed, setCompleted] = useState(false);
  const [redditOnly, setRedditOnly] = useState(false);
  const [webnovelOnly, setWebnovelOnly] = useState(false);
  const [webnovelLink, setWebnovelLink] = useState('');
  const [addingBook, setAddingBook] = useState(false);
  const catalogKey = JSON.stringify([
    query.trim(),
    genre,
    sort,
    completed,
    redditOnly,
    webnovelOnly,
  ]);
  const homeCatalog =
    !query.trim() && !genre && sort === 'default' && !completed && !redditOnly && !webnovelOnly;
  const [loadedCatalog, setLoadedCatalog] = useState(catalogKey);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const catalogRequest = useRef(0);
  const featured = novels.find((n) => n.id === 'the-last-starkeeper') || novels[0];
  const [detail, setDetail] = useState<NovelDetail | null>(null),
    [chapter, setChapter] = useState<ChapterContent | null>(null);
  const [chapterLoading, setChapterLoading] = useState('');
  const [chapterPicker, setChapterPicker] = useState(false);
  const [rangePicker, setRangePicker] = useState(false);
  const [readingPercent, setReadingPercent] = useState(0);
  const lastPercent = useRef(0);
  const [readerControls, setReaderControls] = useState(false);
  const [retryChapter, setRetryChapter] = useState<Chapter | null>(null);
  const [chapterQuery, setChapterQuery] = useState('');
  const [detailTab, setDetailTab] = useState<
    'Chapters' | 'About' | 'Community' | 'Characters' | 'Notes'
  >('Chapters');
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
    progress: queueProgress,
    queue: remainingDownload,
    message: queueMessage,
    messageNovelId,
    removingNovelId,
  } = useDownloads();
  const downloadState = remainingDownload?.novelId === detail?.novel.id ? queueProgress : '';
  const downloadMessage = detail
    ? messageNovelId === detail.novel.id
      ? queueMessage
      : ''
    : queueMessage;
  const savedIds = detail ? downloads[detail.novel.id] || [] : [];
  const availableChapters =
    detail?.chapters.filter((c) => tab !== 'Downloads' || savedIds.includes(c.id)) || [];
  const chapterMatches = availableChapters.filter((c) =>
    `${c.ordinal} ${c.number ?? ''} ${c.title}`
      .toLowerCase()
      .includes(chapterQuery.trim().toLowerCase()),
  );
  const [progress, setProgress] = useState<Record<string, ReadingPosition>>({});
  const [libraryEntries, setLibraryEntries] = useState<Record<string, LibraryEntry>>({});
  const [notes, setNotes] = useState<ChapterNotes>({});
  const position = detail ? progress[detail.novel.id] : undefined;
  const lastChapter = detail?.chapters.find((item) => item.id === position?.chapterId);
  const readThrough = lastChapter
    ? Math.max(0, (lastChapter.number ?? lastChapter.ordinal) - (position?.completed ? 0 : 1))
    : 0;
  const continuing = library
    .filter(
      (n) =>
        progress[n.id] &&
        !['Archived', 'Finished'].includes(libraryEntries[libraryKey(n)]?.shelf || ''),
    )
    .sort((a, b) => (progress[b.id]?.updatedAt ?? 0) - (progress[a.id]?.updatedAt ?? 0))[0];
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const offset = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const [lib, opts, { saved: dl }, prog, marks, cached, entries, savedNotes] =
          await Promise.all([
            read<Novel[]>('library', []),
            read('settings', defaults),
            loadDownloads(),
            read<typeof progress>('progress', {}),
            read<string[]>('bookmarks', []),
            read<Novel[]>('catalog', []),
            read<Record<string, LibraryEntry>>('libraryEntries', {}),
            read<ChapterNotes>('chapterNotes', {}),
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
        setSettings({
          ...defaults,
          ...opts,
          ...(opts.background === '#111820' ? presets.night : {}),
        });
        setProgress(prog);
        setBookmarks(marks);
        setLibraryEntries(entries);
        setNotes(savedNotes);
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
  const cancelCatalogRequest = useEffectEvent(() => {
    catalogRequest.current++;
  });
  const refreshFeed = useEffectEvent(() => void loadFeed());
  const readingGenres = [...new Set(library.flatMap((novel) => novel.genres))]
    .slice(0, 8)
    .join(',');
  const communityNovelId = detail?.novel.id;
  useEffect(() => {
    if (ready) refreshFeed();
  }, [ready, readingGenres]);
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
    return () => {
      clearTimeout(timer);
      cancelCatalogRequest();
    };
  }, [ready, catalogKey]);
  useEffect(() => {
    if (!ready) return;
    const novelId = params.novel;
    if (!novelId) {
      setDetail(null);
      setChapter(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const d =
          detail?.novel.id === novelId ? detail : await loadNovelDetail(novelId, tab === 'Downloads');
        if (!active) return;
        setDetail(d);
        if (params.chapter && chapter?.id !== params.chapter) {
          const c =
            (await localChapter(params.chapter)) ||
            (await fetchChapterOnDemand(d.novel.id, params.chapter, () => !active));
          if (active) {
            offset.current =
              progress[c.novelId]?.chapterId === c.id ? progress[c.novelId].offset : 0;
            lastPercent.current = 0;
            setReadingPercent(0);
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
  const indexNovelId = detail?.novel.id;
  const waitingForIndex = Boolean(detail?.chapterIndexPending && !detail.job);
  const indexing = detail?.job?.status === 'queued' || detail?.job?.status === 'running';
  useEffect(() => {
    if (!indexNovelId || (!waitingForIndex && !indexing)) return;
    const timer = setInterval(
      () => void refreshDetail(indexNovelId),
      waitingForIndex ? 8000 : 2500,
    );
    return () => clearInterval(timer);
  }, [indexNovelId, waitingForIndex, indexing]);
  const preloadedNovel = useRef<string | undefined>(undefined);
  const preloadBatch = useEffectEvent(() => {
    if (!detail) {
      preloadedNovel.current = undefined;
      return;
    }
    const { novel, chapters } = detail;
    if (
      preloadedNovel.current === novel.id ||
      tab === 'Downloads' ||
      !chapters.length ||
      novel.source === 'demo' ||
      indexing
    )
      return;
    preloadedNovel.current = novel.id;
    const position = progress[novel.id];
    const openedAt = Math.max(
      0,
      chapters.findIndex((item) => item.id === (params.chapter || position?.chapterId)),
    );
    const index = Math.min(
      chapters.length - 1,
      openedAt + Number(!params.chapter && Boolean(position?.completed)),
    );
    const start = Math.floor(index / chapterBatchSize) * chapterBatchSize;
    const candidate = [chapters[index], ...chapters.slice(start, start + chapterBatchSize)].find(
      (item) => !item.locked && !item.downloaded,
    );
    if (candidate) void requestChapterBatch(novel.id, candidate.id, true).catch(() => {});
  });
  const indexedChapterCount = detail?.chapters.length ?? 0;
  useEffect(() => {
    preloadBatch();
  }, [indexNovelId, indexedChapterCount, indexing, tab]);
  const onHardwareBack = useEffectEvent(() => {
    if (showSettings) {
      setShowSettings(false);
      return true;
    }
    if (chapter) {
      if (readerControls) {
        setReaderControls(false);
        return true;
      }
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
    const request = ++catalogRequest.current;
    setCatalogBusy(true);
    setCatalogError('');
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        genre,
        sort,
        page: String(next),
        completed: String(completed),
        reddit: String(redditOnly),
        source: webnovelOnly ? 'webnovel' : '',
      });
      const data = await api<{ items: Novel[]; total: number; hasMore: boolean }>(
        `/novels?${params}`,
      );
      if (catalogRequest.current !== request) return;
      setNovels((old) => deduplicateNovels(next === 1 ? data.items : [...old, ...data.items]));
      setLoadedCatalog(catalogKey);
      setPage(next);
      setTotal(data.total);
      setHasMore(data.hasMore);
      if (next === 1 && homeCatalog) void write('catalog', data.items).catch(() => {});
    } catch (e) {
      if (catalogRequest.current === request) setCatalogError(message(e));
    } finally {
      if (catalogRequest.current === request) setCatalogBusy(false);
    }
  }
  async function loadGenres() {
    try {
      const available = await api<string[]>('/genres');
      setGenres(available);
      await write('genres', available);
    } catch {
      setGenres(await read<string[]>('genres', []));
    }
  }
  async function loadFeed() {
    void loadGenres();
    try {
      const data = await api<DiscoveryFeed>(
        `/discover?genres=${encodeURIComponent(readingGenres)}`,
      );
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
  async function openNovel(n: Novel, resume = false) {
    setRetryChapter(null);
    setDetailTab('Chapters');
    setRating({ average: null, count: 0, userRating: null });
    setDiscussions([]);
    const previous = library.find(
      (book) => normalizeNovelTitle(book.title) === normalizeNovelTitle(n.title),
    );
    if (
      previous &&
      (!webnovelOnly || tab !== 'Discover') &&
      (downloads[previous.id]?.length || progress[previous.id])
    )
      n = previous;
    setChapterQuery('');
    setChapterLimit(60);
    setError('');
    setBusy(true);
    setChapter(null);
    try {
      const d = await loadNovelDetail(n.id, tab === 'Downloads');
      setDetail(d);
      if (readerId)
        void api('/activity', 'POST', { novelId: d.novel.id, readerId, action: 'open' }).catch(
          () => {},
        );
      router.setParams({ novel: n.id, chapter: undefined });
      if (
        !previous ||
        previous.id === d.novel.id ||
        (!downloads[previous.id]?.length && !progress[previous.id])
      )
        await keepNovel(d.novel);
      if (resume) {
        const next = resumeChapter(d.chapters, progress[d.novel.id]);
        if (next) await openChapter(next);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function addWebnovel() {
    const url = webnovelLink.trim();
    if (!/^https:\/\/(?:www\.)?webnovel\.com\/book\/(?:[^/?#]+_)?\d+\/?(?:[?#].*)?$/i.test(url)) {
      setCatalogError('Paste a Webnovel book page link.');
      return;
    }
    setAddingBook(true);
    setCatalogError('');
    try {
      const { novel } = await api<{ novel: Novel; job: ImportJob }>('/imports', 'POST', { url });
      setWebnovelLink('');
      void loadNovels(1);
      await openNovel(novel);
    } catch (error) {
      setCatalogError(message(error, 'Couldn’t add this Webnovel book.'));
    } finally {
      setAddingBook(false);
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
    if (c.locked) {
      try {
        await Linking.openURL(c.url);
      } catch {
        setError('Couldn’t open the locked chapter on Webnovel.');
      }
      return;
    }
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
        local ||
        (await fetchChapterOnDemand(c.novelId, c.id, () => request !== chapterRequest.current));
      if (request !== chapterRequest.current) return;
      const position = progress[c.novelId];
      offset.current = position?.chapterId === c.id ? position.offset : 0;
      lastPercent.current = 0;
      setReadingPercent(0);
      setChapter(value);
      rememberPosition(c, offset.current);
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
  function rememberPosition(chapter: Chapter, y: number, completed = false) {
    const updatedAt = Date.now();
    setProgress((current) => {
      const previous = current[chapter.novelId];
      const next = {
        ...current,
        [chapter.novelId]: {
          chapterId: chapter.id,
          title: chapter.title,
          offset: y,
          updatedAt,
          completed: completed || (previous?.chapterId === chapter.id && previous.completed),
        },
      };
      void write('progress', next).catch(() => {});
      return next;
    });
  }
  function saveProgress() {
    if (chapter) rememberPosition(chapter, offset.current, lastPercent.current >= 98);
  }
  function updateLibraryEntry(novel: Novel, entry: LibraryEntry) {
    const next = { ...libraryEntries, [libraryKey(novel)]: entry };
    setLibraryEntries(next);
    void write('libraryEntries', next).catch((error) => setError(message(error)));
  }
  function saveNote(id: string, value: string) {
    const next = { ...notes };
    if (value.trim()) next[id] = value.trim();
    else delete next[id];
    setNotes(next);
    void write('chapterNotes', next).catch((error) => setError(message(error)));
  }
  function closeChapter() {
    saveProgress();
    setReaderControls(false);
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
    const index = availableChapters.findIndex((item) => item.id === chapter.id);
    const previous = index > 0 ? availableChapters[index - 1] : undefined;
    const next = index >= 0 ? availableChapters[index + 1] : undefined;
    return (
      <ChapterReader
        key={chapter.id}
        chapter={chapter}
        novel={detail?.novel.title || ''}
        settings={settings}
        textStyle={readerText}
        offsetRef={offset}
        percent={readingPercent}
        controls={readerControls}
        loading={!!chapterLoading}
        bookmarked={bookmarks.includes(chapter.id)}
        saved={savedIds.includes(chapter.id)}
        downloadDisabled={!!queueProgress || !!removingNovelId}
        note={notes[chapter.id] || ''}
        onSaveNote={(value) => saveNote(chapter.id, value)}
        onControls={setReaderControls}
        onBack={closeChapter}
        onContents={() => {
          setReaderControls(false);
          setChapterPicker(true);
        }}
        onSettings={() => setShowSettings(true)}
        onTheme={() => {
          const theme = settings.theme === 'night' ? 'paper' : 'night';
          changeSettings({ theme, ...presets[theme] });
        }}
        onBookmark={() => {
          const next = bookmarks.includes(chapter.id)
            ? bookmarks.filter((id) => id !== chapter.id)
            : [...bookmarks, chapter.id];
          setBookmarks(next);
          void write('bookmarks', next).catch((e) => setError(message(e)));
        }}
        onDownload={() => void downloadChapters([chapter])}
        onPrevious={previous && (() => void openChapter(previous))}
        onNext={next && (() => void openChapter(next))}
        onProgress={(percent, y) => {
          offset.current = y;
          lastPercent.current = percent;
          setReadingPercent(percent);
        }}
        onSavePosition={saveProgress}
        feedback={
          <>
            {!!error && (
              <View style={s.readerActions}>
                <Text style={[s.error, { flex: 1 }]}>{error}</Text>
                {retryChapter && (
                  <Button
                    label="Try again"
                    secondary
                    onPress={() => void openChapter(retryChapter)}
                  />
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
          </>
        }
      >
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
          transparent
          onRequestClose={() => setShowSettings(false)}
        >
          <View style={s.readerSheetBackdrop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close display settings"
              style={{ flex: 1 }}
              onPress={() => setShowSettings(false)}
            />
            <SafeAreaView edges={['bottom', 'left', 'right']} style={s.readerSheet}>
              <View style={s.readerSheetHandle} />
              <ScrollView contentContainerStyle={s.content}>
                <Button label="Done" onPress={() => setShowSettings(false)} />
                {settingsPanel()}
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>
      </ChapterReader>
    );
  }
  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="light" />
      {rangePicker && !!detail?.chapters.length && (
        <DownloadRange
          chapters={detail.chapters.filter((item) => !item.locked)}
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
                  const chosen = resumeChapter(availableChapters, progress[detail.novel.id]);
                  if (chosen) void openChapter(chosen);
                }}
              />
              {tab !== 'Downloads' && (
                <NovelAction
                  icon="download-outline"
                  label="Download range"
                  disabled={
                    !detail.chapters.some((item) => !item.locked) ||
                    !!queueProgress ||
                    !!removingNovelId
                  }
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
                  ['Characters', 'people-outline'],
                  ['Community', 'chatbubbles-outline'],
                  ['Notes', 'document-text-outline'],
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
            {detailTab === 'Notes' && (
              <View style={s.panel}>
                <Text style={s.heading}>Notes and bookmarks</Text>
                {detail.chapters
                  .filter((item) => notes[item.id] || bookmarks.includes(item.id))
                  .map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => void openChapter(item)}
                    >
                      <Text style={s.link}>{item.title}</Text>
                      <Text style={s.body}>{notes[item.id] || 'Bookmarked chapter'}</Text>
                    </Pressable>
                  ))}
                {!detail.chapters.some((item) => notes[item.id] || bookmarks.includes(item.id)) && (
                  <Text style={s.body}>Add a note or bookmark while reading to find it here.</Text>
                )}
              </View>
            )}
            {detailTab === 'About' && (
              <>
                <LibraryActions
                  entry={libraryEntries[libraryKey(detail.novel)] || {}}
                  inferredShelf={position ? 'Reading' : 'Want to read'}
                  onChange={(entry) => updateLibraryEntry(detail.novel, entry)}
                />
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
              </>
            )}
            {detailTab === 'Characters' && (
              <Characters
                key={detail.novel.id}
                title={detail.novel.title}
                readThrough={readThrough}
              />
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
                {waitingForIndex && tab !== 'Downloads' && (
                  <View style={s.panel}>
                    <Text style={s.body}>Waiting for background chapter indexing.</Text>
                  </View>
                )}
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
                        accessibilityLabel={
                          chapter.locked
                            ? `Open ${chapter.title} on Webnovel`
                            : `Read ${chapter.title}`
                        }
                        disabled={!!chapterLoading}
                        onPress={() => void openChapter(chapter)}
                        style={s.chapterLink}
                      >
                        <Text style={s.chapterNumber}>{chapter.number ?? chapter.ordinal}</Text>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={s.body} numberOfLines={2}>
                            {chapter.title}
                          </Text>
                          {chapter.locked ? (
                            <Text style={s.small}>Read on Webnovel</Text>
                          ) : (
                            current && <Text style={s.small}>Last read</Text>
                          )}
                        </View>
                        {marked && <Ionicons name="bookmark" size={16} color="#60b5ff" />}
                      </Pressable>
                      {chapter.locked ? (
                        <Ionicons name="lock-closed-outline" size={17} color="#60b5ff" />
                      ) : saved ? (
                        <View accessibilityLabel="Available offline" style={s.detailIconButton}>
                          <Ionicons name="checkmark-circle" size={20} color="#60b5ff" />
                        </View>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Download ${chapter.title}`}
                          style={s.detailIconButton}
                          disabled={!!queueProgress || !!removingNovelId}
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
                <FilterChip label="All genres" selected={!genre} onPress={() => setGenre('')} />
                {genres.map((item) => (
                  <FilterChip
                    key={item}
                    label={item}
                    selected={genre === item}
                    onPress={() => setGenre(genre === item ? '' : item)}
                  />
                ))}
              </View>
            </ScrollView>
            <View style={[s.row, { gap: 8, marginBottom: 14 }]}>
              <FilterChip
                label="Completed"
                selected={completed}
                onPress={() => setCompleted(!completed)}
              />
              <FilterChip
                label="Reddit picks"
                selected={redditOnly}
                onPress={() => setRedditOnly(!redditOnly)}
              />
              <FilterChip
                label="Webnovel"
                selected={webnovelOnly}
                onPress={() => setWebnovelOnly(!webnovelOnly)}
              />
            </View>
            <View style={[s.row, { gap: 8, marginBottom: 20 }]}>
              <Text style={s.small}>Sort by</Text>
              {sortOptions.map(([value, label]) => (
                <FilterChip
                  key={value}
                  label={label}
                  selected={sort === value}
                  onPress={() => setSort(value)}
                />
              ))}
            </View>
            {webnovelOnly && (
              <View style={s.panel}>
                <TextInput
                  value={webnovelLink}
                  onChangeText={setWebnovelLink}
                  placeholder="Paste a Webnovel book link"
                  placeholderTextColor="#777e89"
                  accessibilityLabel="Webnovel book link"
                  autoCapitalize="none"
                  keyboardType="url"
                  style={s.input}
                />
                <Button
                  label={addingBook ? 'Adding book…' : 'Add Webnovel book'}
                  secondary
                  disabled={addingBook || !webnovelLink.trim()}
                  onPress={() => void addWebnovel()}
                />
              </View>
            )}
            {redditOnly && !query.trim() && !genre && !completed && !webnovelOnly && (
              <DiscussionPanel
                threads={feed.redditThreads || []}
                title="Reddit recommendation threads"
              />
            )}
            {homeCatalog && featured && (
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
            {homeCatalog && (
              <DiscoveryShelves
                feed={feed}
                personalized={!!readingGenres}
                onOpen={(n) => void openNovel(n)}
                renderCover={(n) => <Cover novel={n} />}
              />
            )}
            <View
              style={[s.row, { justifyContent: 'space-between', marginTop: 4, marginBottom: 12 }]}
            >
              <Text style={s.heading}>
                {query.trim() ? 'Search results' : genre || 'Browse novels'}
              </Text>
              <Pressable
                accessibilityLabel="Refresh novels"
                onPress={() => {
                  void loadNovels(1);
                  void loadFeed();
                }}
              >
                <Ionicons name="refresh-outline" size={18} color="#168bff" />
              </Pressable>
            </View>

            {!!catalogError && <Text style={s.body}>{catalogError}</Text>}
            {catalogBusy && <ActivityIndicator color="#168bff" style={{ margin: 10 }} />}
            {loadedCatalog === catalogKey && (
              <>
                <Text style={[s.small, { marginBottom: 14 }]}>
                  {total} {total === 1 ? 'novel' : 'novels'}
                </Text>
                {novels.map((n) => {
                  const count = Math.max(n.chapterCount, n.reportedChapterCount ?? 0);
                  const metadata = [
                    n.genres[0],
                    n.status === 'completed'
                      ? 'Completed'
                      : n.status === 'ongoing'
                        ? 'Ongoing'
                        : '',
                    count ? `${count.toLocaleString()} chapters` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <Pressable
                      key={n.id}
                      accessibilityRole="button"
                      style={s.libraryRow}
                      onPress={() => void openNovel(n)}
                    >
                      <View style={{ width: 56 }}>
                        <Cover novel={n} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.bookTitle} numberOfLines={2}>
                          {n.title}
                        </Text>
                        {!!metadata && <Text style={s.small}>{metadata}</Text>}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#168bff" />
                    </Pressable>
                  );
                })}
                {!novels.length && !catalogBusy && !catalogError && (
                  <Text style={s.muted}>No novels match these filters.</Text>
                )}
                {hasMore && (
                  <Button
                    label="Load more novels"
                    secondary
                    disabled={catalogBusy}
                    onPress={() => void loadNovels(page + 1)}
                  />
                )}
              </>
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
          <LibraryBrowser
            novels={library}
            entries={libraryEntries}
            progress={progress}
            downloads={downloads}
            onOpen={(novel) => void openNovel(novel)}
            onResume={(novel) => void openNovel(novel, true)}
            cover={(novel) => <Cover novel={novel} />}
          />
        ) : tab === 'Downloads' ? (
          <>
            <Text style={s.section}>TAKE YOUR STORIES WITH YOU</Text>
            <Text style={s.hero}>Offline shelf.</Text>
            <Text style={s.muted}>
              {Object.values(downloads).reduce((n, ids) => n + ids.length, 0)} chapters saved on
              this device
            </Text>
            {queueProgress && (
              <View style={s.panel}>
                <Text style={s.heading}>{remainingDownload?.title}</Text>
                <Text style={s.gold}>{queueProgress}</Text>
                <Button label="Pause download" onPress={pauseDownloads} />
              </View>
            )}
            {!queueProgress && remainingDownload && (
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
                      label={removingNovelId === n.id ? 'Removing downloads…' : 'Remove downloads'}
                      secondary
                      disabled={!!removingNovelId}
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
        <Pressable style={s.continueDock} onPress={() => void openNovel(continuing, true)}>
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
