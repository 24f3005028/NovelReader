import { useEffect, useState } from 'react';
import {
  Image,
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
import { normalizeNovelTitle } from '@novelreader/shared';
import { charactersFor, type CharacterArt } from '../characters';
import { read, write } from '../storage';
import { palette, s } from '../theme';
import { NovelAction } from './NovelHeader';

type PersonalCharacter = {
  name: string;
  description: string;
  chapter: number;
  image: string;
  imageChapter: number;
};
type CharacterSettings = { through: number | null; personal: PersonalCharacter[] };
const defaults: CharacterSettings = { through: null, personal: [] };
const blank = { name: '', description: '', chapter: '1', image: '', imageChapter: '1' };

function Portrait({ art, onOpen }: { art: CharacterArt; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.artCard}>
      {failed ? (
        <View style={[styles.portrait, styles.unavailable]}>
          <Ionicons name="image-outline" size={24} color={palette.muted} />
          <Text style={s.small}>Artwork unavailable</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Enlarge ${art.label}`}
          onPress={onOpen}
        >
          <Image
            source={art.image}
            style={styles.portrait}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        </Pressable>
      )}
      <View style={styles.caption}>
        <Text style={s.body}>{art.label}</Text>
        <Text style={s.small}>{art.credit}</Text>
      </View>
    </View>
  );
}

export function Characters({ title, readThrough }: { title: string; readThrough: number }) {
  const storageKey = `characters:${normalizeNovelTitle(title)}`;
  const [settings, setSettings] = useState<CharacterSettings | null>(null);
  const [limit, setLimit] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [selected, setSelected] = useState<CharacterArt | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const through = settings?.through ?? readThrough;

  useEffect(() => {
    let active = true;
    void read(storageKey, defaults)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {
        if (active)
          setError('Couldn’t load your character settings. Reopen this tab to try again.');
      });
    return () => {
      active = false;
    };
  }, [storageKey]);

  async function save(next: CharacterSettings) {
    setSaving(true);
    setError('');
    try {
      await write(storageKey, next);
      setSettings(next);
      return true;
    } catch {
      setError('Couldn’t save the character settings. Please try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveCharacter() {
    if (!settings || saving) return;
    const name = draft.name.trim();
    const chapter = Number(draft.chapter);
    const image = draft.image.trim();
    const imageChapter = image ? Number(draft.imageChapter) : chapter;
    if (
      !name ||
      !/^\d+$/.test(draft.chapter) ||
      chapter < 1 ||
      (image && (!/^\d+$/.test(draft.imageChapter) || imageChapter < chapter))
    ) {
      setError(
        'Enter a name and a valid chapter. Set the artwork chapter at or after the character’s introduction.',
      );
      return;
    }
    if (image && !/^https:\/\/[^\s/]+\/[^\s]+$/i.test(image)) {
      setError('Use a direct HTTPS image address for the portrait.');
      return;
    }
    const personal = [
      ...settings.personal,
      { name, description: draft.description.trim(), chapter, image, imageChapter },
    ];
    if (await save({ ...settings, personal })) {
      setDraft(blank);
      setEditing(false);
    }
  }

  if (!settings) return <Text style={s.muted}>{error || 'Loading characters…'}</Text>;
  const cast = [
    ...charactersFor(title),
    ...settings.personal.map((character) => ({
      ...character,
      art: character.image
        ? [
            {
              chapter: character.imageChapter,
              label: 'Your portrait',
              credit: 'Personal artwork',
              image: { uri: character.image },
            },
          ]
        : [],
    })),
  ];
  const visible = cast.filter((character) => character.chapter <= through);
  const locked = cast.length - visible.length;
  const validLimit = /^\d+$/.test(limit) && Number(limit) <= 100000;

  return (
    <View style={styles.section}>
      <View style={s.panel}>
        <View style={s.row}>
          <Ionicons name="shield-checkmark-outline" size={22} color="#60b5ff" />
          <Text style={s.heading}>Spoiler guard</Text>
        </View>
        <Text style={s.body}>
          {through > 0
            ? `Showing characters and artwork through chapter ${through}.`
            : 'Character names and artwork are hidden until you finish a chapter.'}
        </Text>
        <View style={[s.row, styles.controls]}>
          <TextInput
            accessibilityLabel="Last completed chapter"
            style={[s.input, styles.chapterInput]}
            keyboardType="number-pad"
            maxLength={6}
            value={limit}
            placeholder={String(through)}
            placeholderTextColor={palette.muted}
            onChangeText={setLimit}
          />
          <NovelAction
            label="Set chapter"
            icon="checkmark-outline"
            disabled={saving || !validLimit}
            onPress={() => {
              void save({ ...settings, through: Number(limit) }).then((ok) => {
                if (ok) setLimit('');
              });
            }}
          />
        </View>
        {settings.through !== null && (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void save({ ...settings, through: null })}
          >
            <Text style={s.link}>Follow reading progress</Text>
          </Pressable>
        )}
      </View>
      {visible.map((character, index) => {
        const portraits = character.art.filter((art) => art.chapter <= through);
        return (
          <View style={s.panel} key={`${character.name}:${index}`}>
            <View style={s.row}>
              <Ionicons name="person-circle-outline" size={25} color="#60b5ff" />
              <Text style={s.heading}>{character.name}</Text>
            </View>
            {!!character.description && <Text style={s.body}>{character.description}</Text>}
            {portraits.map((art) => (
              <Portrait art={art} key={art.label} onOpen={() => setSelected(art)} />
            ))}
            {portraits.length < character.art.length && (
              <View style={s.row}>
                <Ionicons name="lock-closed-outline" size={16} color={palette.muted} />
                <Text style={s.small}>Later artwork hidden</Text>
              </View>
            )}
          </View>
        );
      })}
      {!!locked && (
        <View style={s.panel}>
          <View style={s.row}>
            <Ionicons name="lock-closed-outline" size={19} color={palette.muted} />
            <Text style={s.body}>
              {locked === 1 ? '1 character hidden' : `${locked} characters hidden`}
            </Text>
          </View>
          <Text style={s.small}>Their names and portraits will appear as you read further.</Text>
        </View>
      )}
      {!cast.length && (
        <Text style={s.muted}>
          This novel doesn’t have a curated cast yet. You can add your own characters below.
        </Text>
      )}
      {!editing && (
        <NovelAction
          label="Add a character"
          icon="person-add-outline"
          onPress={() => {
            setError('');
            setEditing(true);
          }}
        />
      )}
      {editing && (
        <View style={s.panel}>
          <Text style={s.heading}>New character</Text>
          {(
            [
              ['name', 'Name', 80],
              ['description', 'Notes', 500],
              ['chapter', 'Introduced in chapter', 6],
              ['image', 'Direct image address (optional)', 700],
              ['imageChapter', 'Show portrait after chapter', 6],
            ] as const
          ).map(([field, label, length]) => (
            <View key={field}>
              <Text style={s.small}>{label}</Text>
              <TextInput
                style={s.input}
                accessibilityLabel={label}
                value={draft[field]}
                maxLength={length}
                keyboardType={
                  field === 'image' ? 'url' : field.endsWith('hapter') ? 'number-pad' : 'default'
                }
                autoCapitalize={field === 'image' ? 'none' : 'sentences'}
                onChangeText={(value) => setDraft({ ...draft, [field]: value })}
              />
            </View>
          ))}
          <View style={s.row}>
            <NovelAction
              primary
              label="Save character"
              icon="checkmark-outline"
              disabled={saving}
              onPress={() => void saveCharacter()}
            />
            <NovelAction
              label="Cancel"
              icon="close-outline"
              disabled={saving}
              onPress={() => {
                setEditing(false);
                setError('');
              }}
            />
          </View>
        </View>
      )}
      {!!error && <Text style={s.error}>{error}</Text>}
      {selected && selected.chapter <= through && (
        <Modal animationType="fade" onRequestClose={() => setSelected(null)}>
          <SafeAreaView style={s.container}>
            <ScrollView contentContainerStyle={s.content}>
              <NovelAction
                label="Close portrait"
                icon="close-outline"
                onPress={() => setSelected(null)}
              />
              <Image source={selected.image} resizeMode="contain" style={styles.fullPortrait} />
              <Text style={s.heading}>{selected.label}</Text>
              <Text style={s.muted}>{selected.credit}</Text>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  controls: { alignItems: 'center' },
  chapterInput: { minWidth: 75, marginBottom: 0, textAlign: 'center' },
  artCard: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#101d2d' },
  portrait: { width: '100%', height: 290, backgroundColor: '#101d2d' },
  unavailable: { height: 120, alignItems: 'center', justifyContent: 'center', gap: 6 },
  caption: { padding: 12, gap: 4 },
  fullPortrait: { width: '100%', height: 480, marginVertical: 15 },
});
