export async function playWithSound(video: Pick<HTMLVideoElement, 'muted' | 'volume' | 'play'>): Promise<void> {
  video.muted = false;
  if (video.volume === 0) video.volume = 1;
  await video.play();
}
