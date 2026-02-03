# StewardPOS Brand Guidelines

This document provides comprehensive branding guidelines for StewardPOS, ensuring consistent visual identity across all applications and materials.

---

## 📐 Logo Usage

### Primary Logo (Lockup)

The primary logo combines the icon with the wordmark "StewardPOS" and tagline.

**Files:**
- `stewardpos-logo-lockup.svg` - For light backgrounds
- `stewardpos-logo-lockup-dark.svg` - For dark backgrounds

**Usage:**
- Website headers (desktop)
- Marketing materials
- Documentation headers
- Email signatures

**Clear Space:**
- Minimum clear space equals the height of the icon
- Never place text or graphics within this space

**Minimum Size:**
- Desktop: 200px width minimum
- Mobile: 150px width minimum

### Icon-Only Logo

Use the icon alone when space is limited or the brand is well-established.

**Files:**
- `stewardpos-icon.svg` - Full color (default)
- `stewardpos-icon-mono-black.svg` - Single color, black
- `stewardpos-icon-mono-white.svg` - Single color, white

**Usage:**
- Mobile headers
- Favicons
- App icons
- Social media avatars
- Small UI elements

**Minimum Size:**
- 32px × 32px (favicon/app icon)
- 48px × 48px (mobile header)
- 64px × 64px (desktop sidebar)

### Monochrome Usage

Use monochrome variants when:
- Printing in single color
- Embossing or engraving
- Using on textured backgrounds
- Ensuring maximum contrast

**Selection Guide:**
- Light backgrounds → `stewardpos-icon-mono-black.svg`
- Dark backgrounds → `stewardpos-icon-mono-white.svg`

---

## ✅ Do's and Don'ts

### ✅ DO:
- Use the full-color lockup on light backgrounds
- Use the dark variant on dark backgrounds
- Maintain clear space around the logo
- Scale proportionally (never stretch or distort)
- Use SVG format for web (scalable, crisp)
- Use appropriate variant for context (icon vs lockup)

### ❌ DON'T:
- Rotate or tilt the logo
- Change colors or gradients
- Add effects (shadows, outlines) unless specified
- Place on busy backgrounds without sufficient contrast
- Use icon-only when space allows for full lockup
- Modify the wordmark typography
- Use incorrect color variants for background

---

## 🎨 Color Palette

### Primary Colors

| Color | Name | HEX | Usage |
|-------|------|-----|-------|
| Primary Indigo | `--sp-primary` | `#4B3F8F` | Primary buttons, links, brand elements |
| Blue Accent | `--sp-accent-blue` | `#3B6FD8` | Accents, highlights, interactive elements |
| Gold Accent | `--sp-gold` | `#F5B942` | CTAs, highlights, success states |
| Gold Dark | `--sp-gold-dark` | `#D39A2F` | Gold hover states, pressed states |

### Neutral Colors

| Color | Name | HEX | Usage |
|-------|------|-----|-------|
| Charcoal | `--sp-charcoal` | `#0F1115` | Dark backgrounds, text on light |
| Slate | `--sp-slate` | `#2A2F3A` | Secondary text, borders |
| Light Gray | `--sp-light-gray` | `#E5E7EB` | Backgrounds, borders, dividers |
| White | `--sp-white` | `#FFFFFF` | Light backgrounds, text on dark |

### Color Usage Guidelines

- **Primary Indigo**: Main brand color, use for primary actions and key UI elements
- **Blue Accent**: Supporting color for secondary actions and information
- **Gold**: Use sparingly for emphasis, CTAs, and important highlights
- **Neutrals**: Provide structure and hierarchy in the interface

---

## 📝 Typography

### Font Families

#### Headlines & Brand Text
- **Primary**: Playfair Display
- **Fallback**: Georgia, "Times New Roman", serif
- **Usage**: H1, H2, brand headlines, hero text

#### Body & UI Text
- **Primary**: Inter
- **Fallback**: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
- **Usage**: Body text, UI labels, buttons, navigation

#### Code & Monospace
- **Primary**: JetBrains Mono
- **Fallback**: "Courier New", Courier, monospace
- **Usage**: Code blocks, technical documentation, data display

### Typography Scale

| Element | Font Family | Size | Weight | Line Height |
|---------|-------------|------|--------|-------------|
| H1 | Playfair Display | 3rem (48px) | 700 | 1.2 |
| H2 | Playfair Display | 2.25rem (36px) | 600 | 1.3 |
| H3 | Inter | 1.5rem (24px) | 600 | 1.4 |
| Body | Inter | 1rem (16px) | 400 | 1.5 |
| Small | Inter | 0.875rem (14px) | 400 | 1.5 |
| Code | JetBrains Mono | 0.875rem (14px) | 400 | 1.6 |

### Typography Usage

- **Headlines**: Use Playfair Display for emotional connection and brand recognition
- **Body**: Use Inter for readability and modern feel
- **Code**: Use JetBrains Mono for technical content and data

---

## 🎯 UI Tokens

### Button Styles

#### Primary Button
- **Background**: Primary Indigo (`#4B3F8F`)
- **Text**: White
- **Hover**: Indigo with 90% opacity
- **Focus**: Gold outline (`#F5B942`)
- **Usage**: Main actions, CTAs

#### Secondary Button
- **Background**: Light Gray (`#E5E7EB`)
- **Text**: Charcoal (`#0F1115`)
- **Hover**: Slate (`#2A2F3A`)
- **Usage**: Secondary actions

#### Accent Button (CTA)
- **Background**: Gold (`#F5B942`)
- **Text**: Charcoal (`#0F1115`)
- **Hover**: Gold Dark (`#D39A2F`)
- **Usage**: Special CTAs, highlights

#### Outline Button
- **Border**: Primary Indigo (`#4B3F8F`)
- **Text**: Primary Indigo
- **Background**: Transparent
- **Hover**: Primary Indigo background with white text
- **Usage**: Tertiary actions

### Link Styles

#### Primary Link
- **Color**: Primary Indigo (`#4B3F8F`)
- **Hover**: Blue Accent (`#3B6FD8`)
- **Underline**: On hover
- **Usage**: Standard links

#### Accent Link
- **Color**: Gold (`#F5B942`)
- **Hover**: Gold Dark (`#D39A2F`)
- **Usage**: Important links, CTAs

### Card Styles

#### Default Card
- **Background**: White (light) / Charcoal (dark)
- **Border**: Light Gray (`#E5E7EB`) / Slate (`#2A2F3A`)
- **Shadow**: Subtle elevation
- **Border Radius**: 0.75rem (12px)

#### Accent Card
- **Background**: Light Gray (`#E5E7EB`) with Gold accent border
- **Usage**: Featured content, highlights

---

## 📁 Asset Files

### SVG Files Location
All branding assets are located in `/branding/svg/`

### File List & Usage

| File | Format | Usage | Size |
|------|--------|-------|------|
| `stewardpos-logo-lockup.svg` | SVG | Light backgrounds, desktop headers | 1600×500 |
| `stewardpos-logo-lockup-dark.svg` | SVG | Dark backgrounds, dark mode | 1600×500 |
| `stewardpos-icon.svg` | SVG | General use, full color | 1024×1024 |
| `stewardpos-icon-mono-black.svg` | SVG | Light backgrounds, print | 1024×1024 |
| `stewardpos-icon-mono-white.svg` | SVG | Dark backgrounds, emboss | 1024×1024 |
| `stewardpos-favicon.svg` | SVG | Browser favicon, app icon | 256×256 |

### Usage by Context

#### GitHub README
- Use: `stewardpos-logo-lockup.svg`
- Format: HTML `<img>` tag with width attribute
- Example: `<img src="branding/svg/stewardpos-logo-lockup.svg" width="400" alt="StewardPOS Logo">`

#### Website Header (Desktop)
- Use: `stewardpos-logo-lockup.svg` (light) or `stewardpos-logo-lockup-dark.svg` (dark)
- Implementation: React component with responsive behavior

#### Website Header (Mobile)
- Use: `stewardpos-icon.svg`
- Size: 48px × 48px minimum

#### Favicon
- Use: `stewardpos-favicon.svg`
- Implementation: Reference in `index.html` `<link>` tag
- Fallback: Generate ICO/PNG versions if needed

#### App Icon
- Use: `stewardpos-icon.svg` or `stewardpos-favicon.svg`
- Generate platform-specific sizes (iOS, Android, PWA)

#### Social Media
- Profile: `stewardpos-icon.svg` (square crop)
- Cover: `stewardpos-logo-lockup.svg` (horizontal)

#### Print Materials
- Color: `stewardpos-logo-lockup.svg` or `stewardpos-icon.svg`
- Monochrome: `stewardpos-icon-mono-black.svg`

---

## 🔧 Implementation Notes

### CSS Variables

Brand colors are available as CSS variables in the application:

```css
--sp-primary: #4B3F8F;
--sp-accent-blue: #3B6FD8;
--sp-gold: #F5B942;
--sp-gold-dark: #D39A2F;
--sp-charcoal: #0F1115;
--sp-slate: #2A2F3A;
--sp-light-gray: #E5E7EB;
--sp-white: #FFFFFF;
```

### React Component

A reusable `Logo` component is available at `src/components/Logo.tsx` with:
- Icon and lockup variants
- Responsive behavior (icon on mobile, lockup on desktop)
- Light/dark mode support
- Proper accessibility attributes

### Google Fonts

Typography fonts are loaded via Google Fonts:
- Inter: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap`
- Playfair Display: `https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap`
- JetBrains Mono: `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap`

---

## 📞 Questions?

For questions about brand usage or to request additional assets, please:
- Open an issue on GitHub
- Contact the maintainers
- Refer to this document for guidance

---

**Last Updated**: 2025-01-15  
**Version**: 1.0


