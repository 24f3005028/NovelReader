import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChapterContent, NovelDetail } from '@novelreader/shared';
import { getChapter, putChapter } from './chapter-cache';
export async function read<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
}
export async function write(key: string, value: unknown) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}
export const localChapter = getChapter;
export async function saveChapter(chapter: ChapterContent) {
  await putChapter(chapter);
}
export async function saveDetail(detail: NovelDetail) {
  await write(`novel:${detail.novel.id}`, detail);
}
export interface ReaderSettings {
  size: number;
  lineHeight: number;
  theme: 'night' | 'paper' | 'sepia';
  font: 'serif' | 'sans';
  align: 'left' | 'justify';
  background: string;
  text: string;
}
export const presets = {
  night: { background: '#05070b', text: '#dce7f7' },
  paper: { background: '#faf8f3', text: '#292b30' },
  sepia: { background: '#eee1c7', text: '#4d3e30' },
};
export const defaults: ReaderSettings = {
  size: 19,
  lineHeight: 1.8,
  theme: 'night',
  font: 'serif',
  align: 'left',
  ...presets.night,
};
