import { Fragment, Suspense, lazy, useEffect } from "react";
import { font, v } from "../theme/tokens";
import { useDemoDate } from "./DateContext";
import { isTabRoute, useRoute } from "./router";
import { TabBar } from "../components/ui/TabBar";
import { TodayScreen } from "../features/today/TodayScreen";
import { LogScreen } from "../features/log/LogScreen";
import { ParcelScreen } from "../features/parcel/ParcelScreen";
import { FarmPlanScreen } from "../features/plan/FarmPlanScreen";
import { EquipmentScreen } from "../features/plan/EquipmentScreen";
import { FieldsScreen } from "../features/plan/FieldsScreen";
import { Loader } from "../components/ui/Loader";

// Off the first-paint bundle: the chat carries the AI SDK, Admin and Gallery are rarely opened.
// The chat tab is warmed once the app is idle, so opening it does not wait.
const loadChat = () => import("../features/chat/ChatScreen");
const ChatScreen = lazy(() => loadChat().then((m) => ({ default: m.ChatScreen })));
const AdminScreen = lazy(() =>
  import("../features/admin/AdminScreen").then((m) => ({ default: m.AdminScreen })),
);
const GalleryScreen = lazy(() =>
  import("../features/gallery/GalleryScreen").then((m) => ({ default: m.GalleryScreen })),
);

export function AppShell() {
  const route = useRoute();
  const { today, ready } = useDemoDate();
  useEffect(() => {
    const warm = setTimeout(() => void loadChat(), 2000);
    return () => clearTimeout(warm);
  }, []);

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
    case "plan":
      content = <FarmPlanScreen />;
      break;
    case "equipment":
      content = <EquipmentScreen />;
      break;
    case "fields":
      content = <FieldsScreen />;
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
        <Suspense fallback={<Loader />}>
          {ready ? <Fragment key={today}>{content}</Fragment> : <Loader />}
        </Suspense>
        {isTabRoute(route.name) && <TabBar active={route.name} />}
      </div>
    </div>
  );
}
