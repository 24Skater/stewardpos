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

  // Determine which logo file to use based on variant and theme
  let logoSrc: string;
  if (showIcon) {
    // Icon variant - use full color icon
    logoSrc = "/branding/svg/stewardpos-icon.svg";
  } else {
    // Lockup variant - use light or dark based on theme
    if (mounted && isDark) {
      logoSrc = "/branding/svg/stewardpos-logo-lockup-dark.svg";
    } else {
      logoSrc = "/branding/svg/stewardpos-logo-lockup.svg";
    }
  }

  if (!mounted) {
    // SSR fallback - show light lockup
    return (
      <img
        src="/branding/svg/stewardpos-logo-lockup.svg"
        alt="StewardPOS"
        className={cn("h-auto", className)}
        style={{ width: showIcon ? "48px" : "200px" }}
      />
    );
  }

  return (
    <img
      src={logoSrc}
      alt="StewardPOS"
      className={cn("h-auto", className)}
      style={{
        width: showIcon ? "48px" : responsive ? "200px" : "auto",
        maxWidth: "100%",
      }}
    />
  );
}

// Export a simpler version for explicit use cases
export function LogoIcon({ className }: { className?: string }) {
  return (
    <img
      src="/branding/svg/stewardpos-icon.svg"
      alt="StewardPOS"
      className={cn("h-auto w-12", className)}
    />
  );
}

export function LogoLockup({ className, dark = false }: { className?: string; dark?: boolean }) {
  const logoSrc = dark
    ? "/branding/svg/stewardpos-logo-lockup-dark.svg"
    : "/branding/svg/stewardpos-logo-lockup.svg";
  return (
    <img
      src={logoSrc}
      alt="StewardPOS"
      className={cn("h-auto", className)}
      style={{ width: "200px", maxWidth: "100%" }}
    />
  );
}

