import { spawn } from 'node:child_process';

/** Publishes the testsrc2 pattern to MediaMTX. Resolves to a stop function once frames flow. */
export function startVideo({ size = '1280x720', rate = 30 } = {}): Promise<() => void> {
  const ffmpeg = spawn('ffmpeg', [
    '-re', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '30',
    '-f', 'rtsp', '-rtsp_transport', 'tcp', 'rtsp://localhost:8554/cam',
  ]);
  return new Promise((resolve, reject) => {
    let output = '';
    ffmpeg.on('error', reject);
    ffmpeg.on('exit', code => reject(new Error(`ffmpeg exited with ${code}:\n${output.slice(-500)}`)));
    ffmpeg.stderr.on('data', chunk => {
      output += chunk;
      if (output.includes('frame=')) resolve(() => ffmpeg.kill());
    });
  });
}
