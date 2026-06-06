declare module "opus-recorder" {
  interface OpusRecorderOptions {
    encoderPath?: string;
    encoderApplication?: number;
    encoderSampleRate?: number;
    encoderFrameSize?: number;
    numberOfChannels?: number;
    streamPages?: boolean;
    monitorGain?: number;
    recordingGain?: number;
    [key: string]: unknown;
  }
  class OpusRecorder {
    constructor(options?: OpusRecorderOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    close(): void;
    ondataavailable?: (data: ArrayBuffer | Uint8Array | Blob) => void;
    onstop?: () => void;
    onstart?: () => void;
    onpause?: () => void;
    onresume?: () => void;
  }
  export default OpusRecorder;
}

declare module "opus-recorder/dist/encoderWorker.min.js?url" {
  const url: string;
  export default url;
}
