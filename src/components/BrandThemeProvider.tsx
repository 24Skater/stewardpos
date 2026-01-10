import { useEffect, useState, ReactNode } from 'react';
import { apiClient } from '@/lib/api-client';

interface BrandThemeProviderProps {
  children: ReactNode;
}

// Convert hex color to HSL values
function hexToHSL(hex: string): { h: number; s: number; l: number } | null {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Parse hex values
  let r = 0, g = 0, b = 0;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else {
    return null;
  }

  // Convert to 0-1 range
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Apply brand color to CSS variables
function applyBrandColor(hexColor: string) {
  const hsl = hexToHSL(hexColor);
  if (!hsl) return;

  const root = document.documentElement;
  
  // Primary color
  root.style.setProperty('--primary', `${hsl.h} ${hsl.s}% ${hsl.l}%`);
  
  // Primary glow (lighter version)
  root.style.setProperty('--primary-glow', `${hsl.h} ${Math.min(hsl.s + 18, 100)}% ${Math.min(hsl.l + 18, 85)}%`);
  
  // Ring color (same as primary)
  root.style.setProperty('--ring', `${hsl.h} ${hsl.s}% ${hsl.l}%`);
  
  // Sidebar ring
  root.style.setProperty('--sidebar-ring', `${hsl.h} ${hsl.s}% ${hsl.l}%`);
  
  // Gradients
  root.style.setProperty('--gradient-primary', `linear-gradient(135deg, hsl(${hsl.h} ${hsl.s}% ${hsl.l}%), hsl(${hsl.h} ${Math.min(hsl.s + 18, 100)}% ${Math.min(hsl.l + 18, 85)}%))`);
  
  // Shadow glow
  root.style.setProperty('--shadow-glow', `0 0 30px hsl(${hsl.h} ${Math.min(hsl.s + 18, 100)}% ${Math.min(hsl.l + 18, 85)}% / 0.3)`);

  // Store in localStorage for persistence
  localStorage.setItem('brand_color', hexColor);
}

export default function BrandThemeProvider({ children }: BrandThemeProviderProps) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadBrandColor = async () => {
      try {
        // First, try to apply cached color for instant load
        const cachedColor = localStorage.getItem('brand_color');
        if (cachedColor) {
          applyBrandColor(cachedColor);
        }

        // Then fetch from API
        const response = await apiClient.get<{ success: boolean; data: { brandColor?: string } }>('/api/admin/settings');
        if (response.success && response.data?.brandColor) {
          applyBrandColor(response.data.brandColor);
        }
      } catch (error) {
        // If API fails, keep using cached color or default
        console.warn('Could not load brand color from settings');
      } finally {
        setLoaded(true);
      }
    };

    loadBrandColor();

    // Listen for settings updates
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'brand_color' && e.newValue) {
        applyBrandColor(e.newValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return <>{children}</>;
}

// Export utility to manually trigger brand color update
export function updateBrandColor(hexColor: string) {
  applyBrandColor(hexColor);
  // Trigger storage event for other tabs
  localStorage.setItem('brand_color', hexColor);
}

