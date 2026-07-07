export interface StatusItem {
  id: string;
  content_type: "text" | "image" | "video" | "audio";
  content_text: string | null;
  media_url: string | null;
  background_color: string | null;
  posted_at: string;
  viewed_at: string | null;
}

export interface StatusGroup {
  key: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  items: StatusItem[];
  hasUnviewed: boolean;
  latestPostedAt: string;
}

export interface StatusFeed {
  mine: StatusItem[];
  contacts: StatusGroup[];
}
