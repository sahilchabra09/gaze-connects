export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1, bitsPerSample = 16) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  function writeString(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, pcm.byteLength, true);

  const output = new Uint8Array(44 + pcm.byteLength);
  output.set(new Uint8Array(header), 0);
  output.set(pcm, 44);
  return output;
}

export function createTonePcm(sampleRate: number, durationMs: number, frequencyHz = 440) {
  const samples = Math.floor(sampleRate * (durationMs / 1000));
  const pcm = new Uint8Array(samples * 2);
  const view = new DataView(pcm.buffer);

  for (let index = 0; index < samples; index += 1) {
    const amplitude = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
    const sample = Math.max(-1, Math.min(1, amplitude)) * 0.25 * 32767;
    view.setInt16(index * 2, sample, true);
  }

  return pcm;
}

export function concatChunks(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}
