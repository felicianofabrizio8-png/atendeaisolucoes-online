import { toast, type ExternalToast } from "sonner";
import { Check, AlertTriangle, Info } from "lucide-react";
import { MarketingArtwork } from "./MarketingArtwork";

function options(tone: "success" | "error" | "info", overrides?: ExternalToast): ExternalToast {
  const Icon = tone === "success" ? Check : tone === "error" ? AlertTriangle : Info;
  return {
    className: `lume-toast lume-toast-${tone}`,
    icon: (
      <span className="lume-toast-icon">
        <MarketingArtwork kind={tone === "success" ? "signal" : "prism"} />
        <Icon size={14} />
      </span>
    ),
    ...overrides,
  };
}

/** Same messages and lifetimes as Sonner; only the marketing feedback presentation changes. */
export const lumeToast = {
  success: (message: Parameters<typeof toast.success>[0], opts?: ExternalToast) =>
    toast.success(message, options("success", opts)),
  error: (message: Parameters<typeof toast.error>[0], opts?: ExternalToast) =>
    toast.error(message, options("error", opts)),
  info: (message: Parameters<typeof toast.info>[0], opts?: ExternalToast) =>
    toast.info(message, options("info", opts)),
};
