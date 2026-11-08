import { Store } from './db.js';
export function seed(store: Store) {
  const stories = [
    [
      'the-last-starkeeper',
      'The Last Starkeeper',
      'Fantasy',
      'Mira Vale',
      'A mapmaker discovers that the stars are going out—and the last light is waiting inside an abandoned observatory.',
    ],
    [
      'a-teahouse-between-worlds',
      'A Teahouse Between Worlds',
      'Slice of life',
      'Ren Aoki',
      'At the end of a quiet alley, a teahouse opens its doors to travellers from every possible world.',
    ],
    [
      'ink-and-thunder',
      'Ink & Thunder',
      'Adventure',
      'Eli Rowan',
      'An apprentice calligrapher learns that every word written during a storm can change the world.',
    ],
  ];
  for (const [id, title, genre, author, description] of stories) {
    if (store.novel(id)) continue;
    store.saveNovel({
      id,
      source: 'demo',
      url: `demo://${id}`,
      title,
      author,
      description,
      cover: '',
      genres: [genre],
      chapterCount: 3,
    });
    for (let i = 1; i <= 3; i++) {
      const chapterId = `${id}-${i}`;
      store.saveChapter({
        id: chapterId,
        novelId: id,
        ordinal: i,
        title: ['The door left open', 'A stranger at dusk', 'Beyond the familiar sky'][i - 1],
        url: `demo://${chapterId}`,
        downloaded: true,
      });
      store.saveBody(chapterId, [
        `Chapter ${i} — ${title}`,
        'The rain stopped just before evening. Along the narrow street, windows filled with amber light, and the city seemed to take one long, quiet breath. Someone had left a door open at the top of the hill.',
        'For as long as she could remember, that door had been locked. She had passed it on her way to the market, on her way home from school, and on the afternoon she decided to leave. Now, with a small bag over her shoulder, she stopped beneath its weathered sign.',
        'Inside, a kettle was singing. There was a table with two chairs, a folded map, and a letter addressed in handwriting she almost recognised. The paper was warm when she picked it up.',
        '“You have arrived earlier than expected,” said a voice from the next room. “That is good. We still have time to choose a different ending.”',
        'She looked back at the street. The familiar houses had disappeared. Beyond the doorway stretched a sea of silver grass, and above it, impossibly close, a sky full of unfamiliar stars.',
        'For a moment she thought of running. Instead, she set her bag beside the empty chair and unfolded the map. There were no roads on it yet. As she watched, a thin line of gold began to trace a path from the place where her hand rested.',
        '“Where does it lead?” she asked. The kettle fell silent. From somewhere beyond the grass came the sound of a bell, clear and bright as a promise.',
        '“That,” said the voice, “depends on what you are willing to find.” She took a breath, stepped toward the door, and let the first unfamiliar light fall across her face.',
        'Original sample fiction written for NovelReader. This short demo chapter is included to test the reader and offline downloads.',
      ]);
    }
  }
}
