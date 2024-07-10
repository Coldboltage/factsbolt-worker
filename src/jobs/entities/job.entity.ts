import { AmendedSpeech, JobStatus } from '../../utils/utils.types';

export class Job {}

export interface AudioInformation {
  url: string;
  filename: string;
  folder: string;
  quality?: string;
  resolution?: number
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
  utterance: AmendedSpeech[];
}
export interface FullJob {
  video: VideoJob;
  transcription: TranscriptionJob;
  chatgpt: ChatGPT;
  status: JobStatus;
}

export interface CompletedVideoJob {
  video: VideoJob;
  audio: AudioInformation;
}

export interface ChatGPT {
  id: string;
  created: number;
  content: Content;
  plainText: string;
}

export interface Content {
  role: string;
  content: string;
}

export interface Speech {
  confidence: number;
  end: number;
  speaker: string;
  text: string;
  words: Words[];
}

export interface Words {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker: string;
}

export interface Job {
  title?: string;
  transcriptionJob?: TranscriptionJob;
  text?: string;
}
