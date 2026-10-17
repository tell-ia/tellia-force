import { Fragment } from "react";
import { font, v } from "../theme/tokens";
import { useDemoDate } from "./DateContext";
import { isTabRoute, useRoute } from "./router";
import { TabBar } from "../components/ui/TabBar";
import { TodayScreen } from "../features/today/TodayScreen";
import { ChatScreen } from "../features/chat/ChatScreen";
import { LogScreen } from "../features/log/LogScreen";
import { AdminScreen } from "../features/admin/AdminScreen";
import { ParcelScreen } from "../features/parcel/ParcelScreen";
import { GalleryScreen } from "../features/gallery/GalleryScreen";

export function AppShell() {
  const route = useRoute();
  const { today } = useDemoDate();

  let content;
  switch (route.name) {
    case "chat":
      content = <ChatScreen />;
      break;
    case "log":
      content = <LogScreen fieldId={route.params.id ? Number(route.params.id) : undefined} />;
      break;
    case "admin":
      content = <AdminScreen />;
      break;
    case "gallery":
      content = <GalleryScreen />;
      break;
    case "parcel":
      content = <ParcelScreen parcelId={Number(route.params.id)} anchor={route.anchor} />;
      break;
    default:
      content = <TodayScreen />;
  }

  return (
    <div style={{ height: "100dvh", display: "flex", justifyContent: "center", background: v("bg") }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 430,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: v("bg"),
          color: v("ink"),
          fontFamily: font.body,
          fontSize: 15,
          lineHeight: 1.45,
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        {/* A new demo date remounts the screen: every screen reloads for the new day. */}
        <Fragment key={today}>{content}</Fragment>
        {isTabRoute(route.name) && <TabBar active={route.name} />}
      </div>
    </div>
  );
}
