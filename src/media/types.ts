export interface MediaOutput {
  name: string;
  start(): void;
  pushFrame(rgbaBuffer: Buffer, width: number, height: number, fps: number): void;
  stop(): void;
  readonly isRunning: boolean;
}
