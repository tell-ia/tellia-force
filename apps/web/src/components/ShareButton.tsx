import { Share } from "@capacitor/share";
import { Share2 } from "lucide-react";
import { Button } from "./ui/Button";
import { isNative } from "../lib/native";

/** Native share sheet on Android; falls back to the Web Share API / clipboard. */
export function ShareButton({
  title,
  text,
  url,
  label = "Partager",
}: {
  title?: string;
  text?: string;
  url?: string;
  label?: string;
}) {
  async function share() {
    try {
      if (isNative) {
        await Share.share({ title, text, url, dialogTitle: title });
      } else if (navigator.share) {
        await navigator.share({ title, text, url });
      } else if (url) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // user cancelled — ignore
    }
  }
  return (
    <Button variant="secondary" onClick={share} className="flex items-center justify-center gap-2">
      <Share2 size={18} /> {label}
    </Button>
  );
}
