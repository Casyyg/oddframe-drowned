export type DrownedScene = {
  id: string;
  chapter: string;
  title: string;
  video: string | null;
  poster: string | null;
  duration: number | null;
  captions?: string;
  text: string[];
  dialogue: { speaker: string; line: string }[];
  productionNote?: string;
  ending?: string;
  choices: {
    id: string;
    label: string;
    next: string;
    requiresMuted?: boolean;
  }[];
};
export type DrownedSession = {
  playerName: string | null;
  token?: string;
  storyId: string;
  sceneId: string;
  scene: DrownedScene;
  version: number;
  ready: boolean;
  lineOpen: boolean;
  phone: string;
  ending: string | null;
  clues: string[];
  visited: string[];
  updatedAt: string;
};
export type DrownedStats = {
  generatedAt: string;
  storage: string;
  scope: string;
  sampled: boolean;
  sessions: number;
  completed: number;
  plays: number;
  completedClips: number;
  choices: number;
  switches: number;
  skippedClips: number;
  placeholders: number;
  endings: Record<string, number>;
  media: {
    available: number;
    pending: { id: string; title: string; note: string }[];
  };
  recent: {
    playerName: string | null;
    session: string;
    scene: string;
    ending: string | null;
    lineOpen: boolean;
    phone: string;
    updatedAt: string;
    timeline: {
      number: number;
      at: string;
      sceneId: string;
      type: string;
      label?: string;
      ending?: string;
      value?: boolean;
      position?: number;
    }[];
  }[];
};
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function drownedApi<T = DrownedSession>(
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch('/api/drowned/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      signal: abort.signal,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new RequestError(
        data?.error ?? 'The request failed.',
        response.status,
      );
    return data as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      'Cannot reach the story server. Check the local server and retry.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}
