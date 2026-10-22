/** Minimal PCM s16le WAV helpers — used to lay out dialogue/SFX tracks sample-accurately. */
export interface Pcm {
  sampleRate: number;
  channels: number;
  samples: Int16Array;
}

export function parseWav(buf: Buffer): Pcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    let size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`unsupported WAV bit depth ${bits}`);
      // streamed WAVs may carry 0 / 0xFFFFFFFF as size
      if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      const data = buf.subarray(body, body + size - (size % 2));
      const samples = new Int16Array(data.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
      return { sampleRate, channels, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

export function encodeWav(pcm: Pcm): Buffer {
  const dataBytes = pcm.samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(pcm.channels, 22);
  buf.writeUInt32LE(pcm.sampleRate, 24);
  buf.writeUInt32LE(pcm.sampleRate * pcm.channels * 2, 28);
  buf.writeUInt16LE(pcm.channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.samples.length; i++) buf.writeInt16LE(pcm.samples[i], 44 + i * 2);
  return buf;
}

export const wavDuration = (pcm: Pcm) => pcm.samples.length / pcm.channels / pcm.sampleRate;

/** Mix `clip` (mono, same rate) into `track` starting at `startSec`, with optional gain and fade-out. */
export function mixInto(track: Int16Array, clip: Int16Array, sampleRate: number, startSec: number, maxSec?: number, gain = 1, fadeOutSec = 0) {
  const start = Math.round(startSec * sampleRate);
  const len = Math.min(clip.length, maxSec !== undefined ? Math.round(maxSec * sampleRate) : clip.length, track.length - start);
  const fade = Math.round(fadeOutSec * sampleRate);
  for (let i = 0; i < len; i++) {
    let g = gain;
    if (fade > 0 && i > len - fade) g *= (len - i) / fade;
    const v = track[start + i] + clip[i] * g;
    track[start + i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
}
