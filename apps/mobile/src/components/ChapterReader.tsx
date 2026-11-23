import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import type { ChapterContent } from '@novelreader/shared';
import type { ReaderSettings } from '../storage';

type Icon = ComponentProps<typeof Ionicons>['name'];

function ReaderAction({
  icon,
  label,
  color,
  caption,
  disabled,
  selected,
  onPress,
}: {
  icon: Icon;
  label: string;
  color: string;
  caption?: string;
  disabled?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, (disabled || pressed) && styles.dimmed]}
    >
      <Ionicons name={icon} color={color} size={23} />
      {caption && <Text style={[styles.caption, { color }]}>{caption}</Text>}
    </Pressable>
  );
}

export function ChapterReader({
  chapter,
  novel,
  settings,
  textStyle,
  offsetRef,
  percent,
  controls,
  loading,
  bookmarked,
  saved,
  downloadDisabled,
  note,
  onSaveNote,
  onControls,
  onBack,
  onContents,
  onSettings,
  onTheme,
  onBookmark,
  onDownload,
  onPrevious,
  onNext,
  onProgress,
  onSavePosition,
  feedback,
  children,
}: {
  chapter: ChapterContent;
  novel: string;
  settings: ReaderSettings;
  textStyle: TextStyle;
  offsetRef: RefObject<number>;
  percent: number;
  controls: boolean;
  loading: boolean;
  bookmarked: boolean;
  saved: boolean;
  downloadDisabled: boolean;
  note: string;
  onSaveNote: (text: string) => void;
  onControls: (show: boolean) => void;
  onBack: () => void;
  onContents: () => void;
  onSettings: () => void;
  onTheme: () => void;
  onBookmark: () => void;
  onDownload: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onProgress: (percent: number, offset: number) => void;
  onSavePosition: () => void;
  feedback?: ReactNode;
  children?: ReactNode;
}) {
  const { background, text } = settings;
  const accent = settings.theme === 'night' ? '#65baff' : '#215e96';
  const border = { borderColor: `${text}24`, backgroundColor: background };
  const chapterNumber = chapter.number ?? chapter.ordinal;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const tap = useRef<{ x: number; y: number; time: number } | null>(null);
  const extent = useRef({ content: 0, viewport: 0 });
  const trackWidth = useRef(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [match, setMatch] = useState(0);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [scrollSpeed, setScrollSpeed] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const speechRun = useRef(0);
  const paragraphs = useRef<number[]>([]);
  const words = useMemo(
    () =>
      chapter.paragraphs.reduce(
        (total, paragraph) => total + paragraph.trim().split(/\s+/).length,
        0,
      ),
    [chapter.paragraphs],
  );
  const minutes = Math.ceil((words / 220) * Math.max(0, 1 - percent / 100));
  const search = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      search
        ? chapter.paragraphs.flatMap((paragraph, index) =>
            paragraph.toLowerCase().includes(search) ? [index] : [],
          )
        : [],
    [chapter.paragraphs, search],
  );
  const activeMatch = matches[match];

  const stopSpeech = useEffectEvent(() => {
    speechRun.current++;
    void Speech.stop().catch(() => {});
  });
  useEffect(() => () => stopSpeech(), []);
  const autoScroll = useEffectEvent(() => {
    if (AppState.currentState !== 'active' || !scroll.current) return;
    const end = extent.current.content - extent.current.viewport;
    if (end <= 0 || offsetRef.current >= end - 1) {
      setScrollSpeed(0);
      onSavePosition();
      return;
    }
    const y = Math.min(end, offsetRef.current + scrollSpeed * 4);
    scroll.current.scrollTo({ y, animated: false });
    onProgress(Math.round((100 * y) / end), y);
  });
  useEffect(() => {
    if (!scrollSpeed || loading || editingNote || finding) return;
    const timer = setInterval(autoScroll, 100);
    return () => clearInterval(timer);
  }, [scrollSpeed, loading, editingNote, finding]);

  function jumpToMatch(index: number) {
    const y = paragraphs.current[index];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 18), animated: true });
  }
  function moveMatch(delta: number) {
    if (!matches.length) return;
    const next = (match + delta + matches.length) % matches.length;
    setMatch(next);
    jumpToMatch(matches[next]);
  }
  function toggleSpeech() {
    const id = ++speechRun.current;
    setSpeechError('');
    if (speaking) {
      setSpeaking(false);
      void Speech.stop().catch(() => {});
      return;
    }
    const first = Math.max(
      0,
      paragraphs.current.findLastIndex((y) => y <= offsetRef.current),
    );
    const limit = Math.min(180, Speech.maxSpeechInputLength) || 180;
    const chunks = chapter.paragraphs
      .slice(first)
      .flatMap(
        (text) =>
          text.match(new RegExp(`[\\s\\S]{1,${limit}}(?:\\s|$)|[\\s\\S]{1,${limit}}`, 'gu')) || [],
      );
    function speak(index: number) {
      if (speechRun.current !== id) return;
      const value = chunks[index];
      if (!value) {
        setSpeaking(false);
        return;
      }
      const failed = () => {
        if (speechRun.current !== id) return;
        setSpeaking(false);
        setSpeechError('Read aloud is unavailable on this device.');
      };
      try {
        Speech.speak(value, { onDone: () => speak(index + 1), onError: failed });
      } catch {
        failed();
      }
    }
    setSpeaking(true);
    speak(0);
  }

  function beginTap(event: GestureResponderEvent) {
    const { touches, pageX, pageY } = event.nativeEvent;
    tap.current = touches.length === 1 ? { x: pageX, y: pageY, time: Date.now() } : null;
  }
  function moveTap(event: GestureResponderEvent) {
    const start = tap.current;
    if (
      start &&
      (event.nativeEvent.touches.length !== 1 ||
        Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) > 12)
    )
      tap.current = null;
  }
  function endTap(event: GestureResponderEvent) {
    const start = tap.current;
    tap.current = null;
    if (
      start &&
      Date.now() - start.time < 300 &&
      Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) <= 12
    )
      onControls(!controls);
  }
  function seek(value: number) {
    const length = Math.max(0, extent.current.content - extent.current.viewport);
    const clamped = Math.max(0, Math.min(100, value));
    if (!length) return;
    const y = length * (clamped / 100);
    scroll.current?.scrollTo({ y, animated: false });
    onProgress(Math.round(clamped), y);
  }
  const sliderValue = (event: GestureResponderEvent) =>
    Math.max(
      0,
      Math.min(100, (100 * event.nativeEvent.locationX) / Math.max(1, trackWidth.current)),
    );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: background }]}>
      <StatusBar style={settings.theme === 'night' ? 'light' : 'dark'} />
      <View style={styles.topLine}>
        <ReaderAction icon="chevron-back" label="Back to chapters" color={text} onPress={onBack} />
        <Text numberOfLines={1} style={[styles.runningTitle, { color: text }]}>
          {novel || `Chapter ${chapterNumber}`}
        </Text>
        <ReaderAction
          icon="chevron-forward"
          label="Next chapter"
          color={text}
          disabled={!onNext || loading}
          onPress={() => onNext?.()}
        />
      </View>
      {finding && (
        <View style={[styles.findBar, border]}>
          <TextInput
            style={[styles.findInput, { color: text }]}
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setMatch(0);
            }}
            autoFocus
            accessibilityLabel="Find in chapter"
            placeholder="Find in chapter"
            placeholderTextColor={text}
            returnKeyType="search"
            onSubmitEditing={() => matches.length && jumpToMatch(matches[match])}
          />
          {search && (
            <Text style={{ color: text }}>
              {matches.length ? `${match + 1}/${matches.length}` : '0 matches'}
            </Text>
          )}
          <ReaderAction
            icon="chevron-up"
            label="Previous match"
            color={text}
            disabled={!matches.length}
            onPress={() => moveMatch(-1)}
          />
          <ReaderAction
            icon="chevron-down"
            label="Next match"
            color={text}
            disabled={!matches.length}
            onPress={() => moveMatch(1)}
          />
          <ReaderAction
            icon="close"
            label="Close chapter search"
            color={text}
            onPress={() => {
              setFinding(false);
              setQuery('');
            }}
          />
        </View>
      )}
      <View style={styles.viewport}>
        <ScrollView
          key={chapter.id}
          ref={scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.reading}
          onTouchStart={beginTap}
          onTouchMove={moveTap}
          onTouchEnd={endTap}
          onTouchCancel={() => {
            tap.current = null;
          }}
          onLayout={(e) => {
            extent.current.viewport = e.nativeEvent.layout.height;
          }}
          onContentSizeChange={(_, height) => {
            extent.current.content = height;
            scroll.current?.scrollTo({ y: offsetRef.current, animated: false });
          }}
          onScroll={(event) => {
            tap.current = null;
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const length = Math.max(0, contentSize.height - layoutMeasurement.height);
            const y = Math.max(0, contentOffset.y);
            onProgress(length ? Math.min(100, Math.round((100 * y) / length)) : 100, y);
          }}
          scrollEventThrottle={100}
          onScrollEndDrag={onSavePosition}
          onScrollBeginDrag={() => setScrollSpeed(0)}
          onMomentumScrollEnd={onSavePosition}
        >
          <Text
            accessibilityRole="header"
            style={[
              textStyle,
              styles.chapterTitle,
              {
                fontSize: settings.size + 8,
                lineHeight: (settings.size + 8) * 1.35,
              },
            ]}
          >
            {chapter.title}
          </Text>
          {chapter.paragraphs.map((paragraph, index) => (
            <Text
              selectable
              key={index}
              onLayout={(event) => {
                paragraphs.current[index] = event.nativeEvent.layout.y;
              }}
              style={[
                textStyle,
                { marginBottom: settings.size },
                activeMatch === index && { backgroundColor: `${accent}2e` },
              ]}
            >
              {paragraph}
            </Text>
          ))}
          <View style={[styles.chapterEnd, { borderColor: `${text}24` }]}>
            <Text style={[styles.endLabel, { color: text }]}>
              {loading ? 'Loading chapter…' : 'End of chapter'}
            </Text>
            <View style={styles.endActions}>
              <ReaderAction
                icon="chevron-back"
                label="Previous chapter"
                caption="Previous"
                color={text}
                disabled={!onPrevious || loading}
                onPress={() => onPrevious?.()}
              />
              <ReaderAction
                icon="list-outline"
                label="Table of contents"
                caption="Contents"
                color={text}
                onPress={onContents}
              />
              <ReaderAction
                icon="chevron-forward"
                label="Next chapter"
                caption="Next chapter"
                color={accent}
                disabled={!onNext || loading}
                onPress={() => onNext?.()}
              />
            </View>
          </View>
        </ScrollView>
        {controls && (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View style={[styles.topTools, border]}>
              <ReaderAction
                icon="list-outline"
                label="Open chapter list"
                color={accent}
                onPress={onContents}
              />
              <Text numberOfLines={1} style={[styles.toolTitle, { color: text }]}>
                {chapter.title}
              </Text>
              <ReaderAction
                icon={bookmarked ? 'bookmark' : 'bookmark-outline'}
                label={bookmarked ? 'Remove bookmark' : 'Bookmark chapter'}
                color={bookmarked ? accent : text}
                selected={bookmarked}
                onPress={onBookmark}
              />
              <ReaderAction
                icon={saved ? 'checkmark-circle-outline' : 'download-outline'}
                label={saved ? 'Saved offline' : 'Save current chapter offline'}
                color={saved ? accent : text}
                disabled={downloadDisabled || saved}
                onPress={onDownload}
              />
            </View>
            <View style={[styles.dock, border]}>
              <View style={styles.seekRow}>
                <ReaderAction
                  icon="chevron-back"
                  label="Previous chapter"
                  color={text}
                  disabled={!onPrevious || loading}
                  onPress={() => onPrevious?.()}
                />
                <View
                  style={styles.seekTarget}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Position in chapter"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(scrubbing ?? percent) }}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={(event) => {
                    seek(percent + (event.nativeEvent.actionName === 'increment' ? 5 : -5));
                    onSavePosition();
                  }}
                  onLayout={(e) => {
                    trackWidth.current = e.nativeEvent.layout.width;
                  }}
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={(e) => setScrubbing(sliderValue(e))}
                  onResponderMove={(e) => setScrubbing(sliderValue(e))}
                  onResponderRelease={(e) => {
                    seek(sliderValue(e));
                    setScrubbing(null);
                    onSavePosition();
                  }}
                  onResponderTerminate={() => setScrubbing(null)}
                >
                  <View
                    pointerEvents="none"
                    style={[styles.seekTrack, { backgroundColor: `${text}30` }]}
                  >
                    <View
                      style={[
                        styles.seekFill,
                        { width: `${scrubbing ?? percent}%`, backgroundColor: accent },
                      ]}
                    />
                    <View
                      style={[
                        styles.seekThumb,
                        { left: `${scrubbing ?? percent}%`, backgroundColor: accent },
                      ]}
                    />
                  </View>
                </View>
                <ReaderAction
                  icon="chevron-forward"
                  label="Next chapter"
                  color={text}
                  disabled={!onNext || loading}
                  onPress={() => onNext?.()}
                />
              </View>
              <View style={styles.dockActions}>
                <ReaderAction
                  icon="list-outline"
                  label="Table of contents"
                  caption="Contents"
                  color={text}
                  onPress={onContents}
                />
                <ReaderAction
                  icon="text-outline"
                  label="Reading settings"
                  caption="Display"
                  color={text}
                  onPress={onSettings}
                />
                <ReaderAction
                  icon={settings.theme === 'night' ? 'sunny-outline' : 'moon-outline'}
                  label={
                    settings.theme === 'night' ? 'Switch to paper theme' : 'Switch to night theme'
                  }
                  caption={settings.theme === 'night' ? 'Paper' : 'Night'}
                  color={text}
                  onPress={onTheme}
                />
              </View>
              <View style={styles.dockActions}>
                <ReaderAction
                  icon="search-outline"
                  label="Find in chapter"
                  caption="Find"
                  color={text}
                  onPress={() => {
                    onControls(false);
                    setFinding(true);
                  }}
                />
                <ReaderAction
                  icon="document-text-outline"
                  label="Edit chapter note"
                  caption="Note"
                  color={note ? accent : text}
                  onPress={() => {
                    setNoteDraft(note);
                    setEditingNote(true);
                  }}
                />
                <ReaderAction
                  icon={speaking ? 'stop-circle-outline' : 'volume-high-outline'}
                  label={speaking ? 'Stop read aloud' : 'Read aloud'}
                  caption={speaking ? 'Stop audio' : 'Read aloud'}
                  color={speaking ? accent : text}
                  onPress={toggleSpeech}
                />
                <ReaderAction
                  icon={scrollSpeed ? 'pause-outline' : 'play-outline'}
                  label="Change auto-scroll speed"
                  caption={['Scroll', 'Slow', 'Medium', 'Fast'][scrollSpeed]}
                  color={scrollSpeed ? accent : text}
                  onPress={() => {
                    setScrollSpeed((scrollSpeed + 1) % 4);
                    onSavePosition();
                  }}
                />
              </View>
            </View>
          </View>
        )}
      </View>
      {feedback}
      {!!speechError && <Text style={[styles.endLabel, { color: text }]}>{speechError}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={controls ? 'Hide reading controls' : 'Show reading controls'}
        onPress={() => onControls(!controls)}
        style={styles.footer}
      >
        <Text style={[styles.footerText, { color: text }]}>
          {loading ? 'Loading chapter…' : `Chapter ${chapterNumber}`}
        </Text>
        <Ionicons name={controls ? 'chevron-down' : 'ellipsis-horizontal'} size={18} color={text} />
        <Text style={[styles.footerText, { color: text, textAlign: 'right' }]}>
          {Math.round(scrubbing ?? percent)}%{minutes > 0 ? ` · ${minutes} min` : ''}
        </Text>
      </Pressable>
      {children}
      {editingNote && (
        <Modal animationType="slide" onRequestClose={() => setEditingNote(false)}>
          <SafeAreaView style={[styles.noteSheet, { backgroundColor: background }]}>
            <View style={styles.findBar}>
              <Text style={[styles.toolTitle, { color: text }]}>Chapter note</Text>
              <ReaderAction
                icon="checkmark"
                label="Save note"
                color={accent}
                onPress={() => {
                  onSaveNote(noteDraft);
                  setEditingNote(false);
                }}
              />
              <ReaderAction
                icon="close"
                label="Cancel note edit"
                color={text}
                onPress={() => setEditingNote(false)}
              />
            </View>
            <TextInput
              autoFocus
              multiline
              textAlignVertical="top"
              accessibilityLabel="Private chapter note"
              placeholder="Write a private note…"
              placeholderTextColor={text}
              style={[styles.noteInput, { color: text, borderColor: `${text}24` }]}
              maxLength={4000}
              value={noteDraft}
              onChangeText={setNoteDraft}
            />
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topLine: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  runningTitle: { flex: 1, fontSize: 12, opacity: 0.58, textAlign: 'center', letterSpacing: 0.3 },
  viewport: { flex: 1 },
  reading: {
    paddingHorizontal: 23,
    paddingTop: 22,
    paddingBottom: 35,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  chapterTitle: { fontWeight: '800', marginBottom: 26, textAlign: 'left' },
  chapterEnd: { borderTopWidth: 1, marginTop: 10, paddingTop: 22 },
  endLabel: { textAlign: 'center', fontSize: 12, opacity: 0.58, marginBottom: 10 },
  endActions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  caption: { fontSize: 11, fontWeight: '600' },
  dimmed: { opacity: 0.32 },
  topTools: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomWidth: 1,
  },
  toolTitle: { flex: 1, marginHorizontal: 10, fontWeight: '700', fontSize: 14 },
  dock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
  },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  seekTarget: { flex: 1, minHeight: 34, justifyContent: 'center' },
  seekTrack: { height: 4, borderRadius: 2 },
  seekFill: { height: 4, borderRadius: 2 },
  seekThumb: {
    position: 'absolute',
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
  dockActions: { flexDirection: 'row', justifyContent: 'space-around' },
  footer: {
    minHeight: 36,
    paddingHorizontal: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 11, opacity: 0.62, minWidth: 68 },
  findBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  findInput: { flex: 1, minWidth: 64, paddingVertical: 10 },
  noteSheet: { flex: 1, paddingHorizontal: 18 },
  noteInput: { minHeight: 180, padding: 15, marginTop: 18, borderRadius: 12, borderWidth: 1 },
});
