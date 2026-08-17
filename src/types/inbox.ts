export type InboxItemStatus = 'pending' | 'accepted' | 'dismissed';

export interface RemoteInboxItem {
  id: string;
  url: string;
  title: string;
  excerpt?: string;
  contentHtml?: string;
  tags: string[];
  status: InboxItemStatus;
  createdAt: string;
}

export interface CaptureUrlRequest {
  url: string;
  title?: string;
  tags?: string[];
}

export interface CaptureContentRequest {
  url: string;
  title: string;
  html?: string;
  text?: string;
  tags?: string[];
}
