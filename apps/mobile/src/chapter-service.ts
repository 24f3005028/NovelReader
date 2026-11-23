import type { ChapterContent, ChapterImportResponse, ImportJob } from '@novelreader/shared';
import { api, ApiError, ReaderError } from './api';
export function requestChapterBatch(novelId: string, chapterId: string, prioritize = false) {
  return api<ChapterImportResponse>(`/novels/${novelId}/chapter-batches`, 'POST', {
    chapterId,
    prioritize,
  });
}
export async function fetchChapterOnDemand(
  novelId: string,
  id: string,
  cancelled: () => boolean = () => false,
): Promise<ChapterContent> {
  try {
    return await api<ChapterContent>(`/chapters/${id}`);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409) throw e;
  }
  if (cancelled()) throw new ReaderError('Chapter request cancelled');
  const result = await requestChapterBatch(novelId, id, true);
  if (result.chapter) return result.chapter;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (cancelled()) throw new ReaderError('Chapter request cancelled');
    const job = await api<ImportJob>(`/jobs/${result.job!.id}`);
    if (job.status === 'completed') return api<ChapterContent>(`/chapters/${id}`);
    if (['failed', 'cancelled'].includes(job.status))
      throw new ReaderError(
        job.status === 'cancelled'
          ? 'Chapter request cancelled.'
          : "This chapter couldn't be loaded. Please try again shortly.",
      );
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new ReaderError('Chapter is still being fetched. Tap it again to check progress.');
}
