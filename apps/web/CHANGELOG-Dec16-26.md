# Changelog: December 16-26, 2025

## Highlights

### Phantom SDK integration

We migrated from Solana wallet adapter to the official Phantom SDK, providing a more streamlined wallet experience:

- Complete wallet SDK migration from `@solana/wallet-adapter-*` to `@phantom/react-sdk`. (`dc34d72`)

- Phantom ConnectButton for wallet management with built-in disconnect modal. (`cb77eb9`)

- OAuth providers (Google, Apple) restored for alternative authentication flows. (`a4bc1a7`)

- Smart auth prompting: wallet modal opens on first keystroke for seamless mobile deeplink flows. (`7a7b643`)

This matters because Phantom SDK provides a unified, mobile-friendly wallet experience with OAuth fallbacks, reducing friction for users connecting wallets especially on mobile devices.

### Chat UI redesign (Figma alignment)

Major visual overhaul of the chat experience to match Figma designs:

- Chat input: glass background (`rgba(38,38,38,0.7)`), 48px blur, 32px radius, multiline support with 368px max height, and three-state submit button (disabled/enabled/stop). (`daf6e04`)

- User message bubbles: subtle white background (`rgba(255,255,255,0.12)`), asymmetric border-radius, right-aligned footer actions (copy, more). (`e1cdbaf`)

- Assistant messages: full-width plain markdown (no bubble), footer actions (copy, refresh, more) on completion, gradient shimmer "Thinking" indicator. (`7de89e0`, `e1cdbaf`)

- LLM markdown styling: code blocks with semi-transparent black background, 16px radius, language label header with copy button, Geist Mono fonts. Tables with minimal clean styling and header separators. (`7fa44a3`)

- Table styles: 14px Geist font, 500-weight headers, 36px row height, transparent backgrounds. (`9c6ef43`)

This matters because the chat interface now matches the design spec with proper typography, spacing, and visual hierarchy, providing a polished conversational experience.

### Animated sidebar & layout

New sidebar system with smooth animations and improved wallet placement:

- CSS-animated sidebar: 0.3s opacity and translateX transitions for open/close, pointer-events disabled when hidden. (`3afdeaa`)

- Chat layout: messages top-aligned, sidebar pushes chat content (not overlays), conversation title displayed in sidebar with glass highlight. (`6986f22`)

- Wallet button placement: header when not connected, sidebar when in chat mode and connected. (`0202d8f`)

- Multiple animation fixes for landing-to-chat transitions. (`b4e5bbd`, `dc27199`, `e3960a0`)

This matters because smooth animations and predictable layouts reduce visual jank and cognitive load during navigation and mode transitions.

### Roadmap & landing page polish

Visual improvements to the landing page and roadmap section:

- Roadmap cards: glassmorphism styling (`rgba(38,38,38,0.5)`), blur, borders, and animated red dot indicator on active card. (`1196f4f`)

- Sticky input: chat input moves to bottom when hero is scrolled past, stays above footer. (`4edffdf`)

- Mobile roadmap navigation: chevron arrows inside carousel fade overlays. (`4edffdf`)

- Subtle parallax effect on landing input (15% scroll offset). (`b55772e`)

- Askloyal logo placed above hero input for branding. (`3e424b4`)

- Hero cleanup: removed background image and inline logo. (`0c3e386`)

This matters because these changes modernize the landing page visuals, improve mobile navigation, and keep the input accessible during scrolling.

---

## Security & performance

- **Security patch**: Upgraded Next.js 15.4.6→15.4.10 and React 19.1.0→19.1.2 to address CVE-2025-66478 and related vulnerabilities. (`d571936`)

- **Performance**: Unmount desktop nav in chat mode to eliminate expensive backdrop-filter blur from the DOM. (`3895820`)

---

## Fixes & reliability improvements

- Fix landing-to-chat transition: use `marginLeft` instead of animating `left` to prevent elements flying from the left. (`dc27199`, `b4e5bbd`)

- Fix sidebar animation syntax error from refactor. (`e3960a0`)

- Constrain chat input width (768px) and fix bottom positioning with proper padding. (`5d3f981`)

- Wrap nav items in group to remove unintended gaps between buttons. (`1d11d5c`)

- Center landing input with 0.5s animation transition. (`9c6ef43`)

- Simplify wallet disconnect: auto-open Phantom modal via useEffect when disconnected in chat mode. (`9c6ef43`)

---

## What this means for users

- **Wallet flows are streamlined**: Phantom SDK handles wallet management with OAuth fallbacks, and auth prompts appear immediately on mobile for seamless deeplink flows.

- **Chat looks polished**: Messages, inputs, code blocks, and tables now match the Figma design system with proper typography, spacing, and interactions.

- **Navigation is smoother**: Sidebar opens/closes with animations, transitions between landing and chat are instant without visual glitches.

- **Mobile UX improved**: Sticky input stays accessible, roadmap has navigation arrows, and wallet connection works reliably on mobile browsers.

---

## Where to look

- **Phantom SDK integration**: `src/components/solana/phantom-provider.tsx`, header/page updates. (`dc34d72`, `cb77eb9`, `7a7b643`)

- **Chat UI redesign**: Input, message, and markdown component styling. (`daf6e04`, `e1cdbaf`, `7de89e0`, `7fa44a3`)

- **Sidebar animation**: Sidebar transitions and layout push behavior. (`3afdeaa`, `6986f22`, `0202d8f`)

- **Roadmap/landing**: Roadmap card styling, sticky input, parallax. (`1196f4f`, `4edffdf`, `b55772e`)

- **Security**: Next.js/React upgrades. (`d571936`)
