export interface MetadataResult {
  title: string;
  keywords: string[];
}

export interface HistoryItem {
  id: string;
  userId: string;
  imageUrl: string;
  title: string;
  keywords: string[];
  createdAt: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: any;
}
