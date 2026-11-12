// Shared by the recorder and the server. Base64 adds a third, so 3 MB of audio
// is about 4 MB on the wire: under Vercel's 4.5 MB request-body limit.
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const MAX_AUDIO_BODY_BYTES = 4_400_000;
export const MAX_RECORDING_SECONDS = 120;
