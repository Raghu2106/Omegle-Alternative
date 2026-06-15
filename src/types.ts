export interface Message {
  id: string;
  sender: "you" | "stranger" | "system";
  text: string;
  timestamp: Date;
}

export type AppState = "landing" | "searching" | "paired" | "idle";

export interface PairingInfo {
  peerId: string;
  initiator: boolean;
  commonInterests: string[];
}

export interface UserPreferences {
  interests: string[];
  mode: "text" | "voice" | "video";
}
