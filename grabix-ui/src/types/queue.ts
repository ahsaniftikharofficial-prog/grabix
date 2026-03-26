export type FileType = "video" | "audio" | "thumbnail" | "subtitle";

export interface QueueItem {
  id: string;
  serverId: string;
  url: string;
  title: string;
  thumbnail: string;
  format: string;
  fileType: FileType;
  status:
    | "queued"
    | "downloading"
    | "processing"
    | "done"
    | "error"
    | "paused"
    | "canceling"
    | "failed"
    | "canceled";
  percent: number;
  speed: string;
  eta: string;
  downloaded: string;
  total: string;
  filePath: string;
  error: string;
}
