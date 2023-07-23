export class Job {}

export interface AudioInformation {
  url: string;
  filename: string;
  folder: string;
  quality: string;
}

export interface VideoJob {
  id?: string;
  name?: string;
  link: string;
  website?: string;
}

export interface AudioJob {
  id?: string;
  processed: boolean;
  transcription?: TranscriptionJob;
}

export interface TranscriptionJob {
  id?: string;
  assembleyId: string;
  link: string;
  text: string;
}

export interface FullJob {
  video: VideoJob;
  transcription: TranscriptionJob;
  chatgpt: ChatGPT;
}

export interface CompletedVideoJob {
  video: VideoJob;
  audio: AudioInformation;
}

export interface ChatGPT {
  id: string;
  created: number;
  content: string;
}
