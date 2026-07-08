import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  variant?: "icon" | "lockup";
  className?: string;
  responsive?: boolean;
  dark?: boolean;
}

export default function Logo({ variant, className, responsive = true, dark }: LogoProps) {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Handle theme detection
  useEffect(() => {
    setMounted(true);
    const checkDark = () => {
      const isDarkMode =
        dark !== undefined
          ? dark
          : document.documentElement.classList.contains("dark") ||
            window.matchMedia("(prefers-color-scheme: dark)").matches;
      setIsDark(isDarkMode);
    };
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkDark();
    checkMobile();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", checkDark);
    window.addEventListener("resize", checkMobile);
    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", checkDark);
      window.removeEventListener("resize", checkMobile);
    };
  }, [dark]);

  // Determine which variant to show
  const showIcon = variant === "icon" || (responsive && mounted && isMobile);
  const showLockup = variant === "lockup" || !showIcon;

  let logoSrc: string;
  if (showIcon) {
    logoSrc = "/branding/svg/steward-mark.svg";
  } else {
    logoSrc = mounted && isDark
      ? "/branding/svg/steward-lockup-horizontal-dark.svg"
      : "/branding/svg/steward-lockup-horizontal.svg";
  }

  if (!mounted) {
    return (
      <img
        src="/branding/svg/steward-lockup-horizontal.svg"
        alt="Steward · Register"
        className={cn("h-auto", className)}
        style={{ width: showIcon ? "48px" : "200px" }}
      />
    );
  }

  return (
    <img
      src={logoSrc}
      alt="Steward · Register"
      className={cn("h-auto", className)}
      style={{
        width: showIcon ? "48px" : responsive ? "200px" : "auto",
        maxWidth: "100%",
      }}
    />
  );
}

export function LogoIcon({ className }: { className?: string }) {
  return (
    <img
      src="/branding/svg/steward-mark.svg"
      alt="Steward · Register"
      className={cn("h-auto w-12", className)}
    />
  );
}

export function LogoLockup({ className, dark = false }: { className?: string; dark?: boolean }) {
  const logoSrc = dark
    ? "/branding/svg/steward-lockup-horizontal-dark.svg"
    : "/branding/svg/steward-lockup-horizontal.svg";
  return (
    <img
      src={logoSrc}
      alt="Steward · Register"
      className={cn("h-auto", className)}
      style={{ width: "200px", maxWidth: "100%" }}
    />
  );
}

