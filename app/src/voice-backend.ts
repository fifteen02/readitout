export type VoiceDevice = 'webgpu' | 'wasm';

/** Probe an adapter, not just the presence of the WebGPU API. */
export async function voiceDevice(gpu?: { requestAdapter(): Promise<unknown> }): Promise<VoiceDevice> {
  try { return gpu && await gpu.requestAdapter() ? 'webgpu' : 'wasm'; }
  catch { return 'wasm'; }
}

/** Retry once on CPU and keep it for this worker's lifetime after a GPU failure. */
export function voiceBackend<T>(options: {
  device: () => Promise<VoiceDevice>;
  load: (device: VoiceDevice) => Promise<T>;
  dispose: (model: T) => Promise<void>;
  fallback: () => void;
  selected?: (device: VoiceDevice) => void;
}) {
  let device: VoiceDevice | undefined;
  let model: T | undefined;
  return async <R>(run: (model: T) => Promise<R>): Promise<R> => {
    device ??= await options.device();
    try {
      model ??= await options.load(device);
      const result = await run(model);
      options.selected?.(device);
      return result;
    } catch (error) {
      if (device !== 'webgpu') throw error;
      device = 'wasm';
      if (model) await options.dispose(model).catch(() => {});
      model = undefined;
      options.fallback();
      model = await options.load(device);
      const result = await run(model);
      options.selected?.(device);
      return result;
    }
  };
}
