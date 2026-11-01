import { useEffect, useState } from "react";

// Телефонная раскладка включается на тех же 760px, что и медиазапрос в mobile.css.
export const PHONE_QUERY = "(max-width: 760px)";

const matches = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;

export default function usePhoneLayout() {
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, []);
  return phone;
}
