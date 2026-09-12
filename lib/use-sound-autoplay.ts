'use client';
import { useEffect, useState, type RefObject } from 'react';
import { playWithSound } from './sound-playback';
export function useSoundAutoplay(ref: RefObject<HTMLVideoElement | null>, sceneId: string | undefined, enabled: boolean) {
  const [blockedScene, setBlockedScene] = useState('');
  useEffect(() => {
    const video = ref.current;
    if (!video || !enabled || !sceneId) return;
    let cancelled = false;
    const playing = () => { if (!cancelled) setBlockedScene(''); };
    video.addEventListener('playing', playing);
    void playWithSound(video).catch(error => {
      if (!cancelled && error?.name !== 'AbortError') setBlockedScene(sceneId);
    });
    return () => { cancelled = true; video.removeEventListener('playing', playing); };
  }, [ref,sceneId,enabled]);
  function play() {
    const video = ref.current;
    if (!video || !sceneId) return;
    // Called directly from a click so a browser can use the user's playback permission.
    void playWithSound(video).then(() => setBlockedScene('')).catch(() => setBlockedScene(sceneId));
  }
  return {blocked: enabled && blockedScene === sceneId, play};
}
