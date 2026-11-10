import type { ImageSourcePropType } from 'react-native';
import { normalizeNovelTitle } from '@novelreader/shared';

export type CharacterArt = {
  chapter: number;
  label: string;
  credit: string;
  image: ImageSourcePropType;
};

export type Character = {
  name: string;
  description: string;
  chapter: number;
  art: CharacterArt[];
};

// Each image is reviewed separately from its source page, which may contain spoilers.
const cast: Record<string, Character[]> = {
  'renegade immortal': [
    {
      name: 'Wang Lin',
      chapter: 1,
      description: 'A young villager who wants to walk the path of immortality.',
      art: [
        {
          chapter: 1,
          label: 'Early look',
          credit: 'Original interpretation',
          image: require('../assets/characters/wang-lin.webp'),
        },
        {
          chapter: 288,
          label: 'Later look',
          credit: 'Fan wallpaper · Bilibili',
          image: {
            uri: 'https://i0.hdslb.com/bfs/new_dyn/85ed532a205cfc16ecf3ac0af8011da828657233.jpg@1192w',
          },
        },
      ],
    },
    {
      name: 'Li Muwan',
      chapter: 130,
      description: 'A cultivator from the Luo He Sect.',
      art: [
        {
          chapter: 130,
          label: 'Red robes',
          credit: 'Fan illustration · Guoman Bizhi',
          image: { uri: 'https://img.guomanbizhi.com/xianni/limuwan-amut4oco9s.jpg' },
        },
      ],
    },
  ],
  'lord of the mysteries': [
    {
      name: 'Klein Moretti',
      chapter: 1,
      description: 'A history graduate in the city of Tingen.',
      art: [
        {
          chapter: 1,
          label: 'Early Tingen look',
          credit: 'Illustration · Duitang',
          image: {
            uri: 'https://c-ssl.dtstatic.com/uploads/blog/202201/12/20220112225517_d51c1.thumb.1000_0.jpeg',
          },
        },
      ],
    },
    {
      name: 'Audrey Hall',
      chapter: 5,
      description: 'A young noblewoman from Backlund with a curiosity about the extraordinary.',
      art: [
        {
          chapter: 5,
          label: 'Backlund look',
          credit: 'Promotional art · LOTM World',
          image: { uri: 'https://pbs.twimg.com/media/GrPZSxSXgAArP_R.jpg' },
        },
      ],
    },
  ],
  'reverend insanity': [
    {
      name: 'Fang Yuan',
      chapter: 1,
      description: 'A resourceful Gu Master with his own ambitions.',
      art: [
        {
          chapter: 1,
          label: 'Gu Master portrait',
          credit: 'Illustration · Gu Daoist Master Wiki',
          image: {
            uri: 'https://static.wikia.nocookie.net/gu-daoist-master/images/c/c8/DaoistGu4.png/revision/latest?cb=20190208202702',
          },
        },
      ],
    },
    { name: 'Fang Zheng', chapter: 2, description: 'Fang Yuan’s younger twin brother.', art: [] },
  ],
};

export function charactersFor(title: string) {
  const key = normalizeNovelTitle(title);
  if (key === 'xian ni') return cast['renegade immortal'];
  if (key === 'lord of mysteries') return cast['lord of the mysteries'];
  return cast[key] || [];
}
