import { useEffect, useState } from "react";
import { onlineManager } from "@tanstack/react-query";
import Icon from "@/components/ui/Icon";

/** A banner while the device is offline; changes made then would fail, so say so up front. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  const [backOnline, setBackOnline] = useState(false);
  useEffect(() => onlineManager.subscribe((isOnline) => {
    setOnline(isOnline);
    if (isOnline) { setBackOnline(true); setTimeout(() => setBackOnline(false), 3000); }
  }), []);
  if (online && !backOnline) return null;
  return (
    <div className={`offline-banner ${online ? "back" : ""}`} role="status">
      <Icon name={online ? "check" : "x"} size={14}/>
      {online ? "Back online. Your data is refreshing." : "You're offline. Changes won't save until your connection is back."}
    </div>
  );
}
