"use client";
import { useEffect, useState } from "react";

const navKey = "fieldwork-nav-collapsed";

// Expanded by default; the choice is remembered per browser.
export function useNavPreference() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(navKey) === "1");
    } catch {
      /* The expanded navigation is the default. */
    }
  }, []);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(navKey, next ? "1" : "0");
    } catch {
      /* Preference only lasts for this page view. */
    }
  }
  return { collapsed, toggle };
}
