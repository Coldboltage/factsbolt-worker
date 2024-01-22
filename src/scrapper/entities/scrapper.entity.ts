export enum ScrapperStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export interface Scrapper {
  id: string;
  status: ScrapperStatus;
}
